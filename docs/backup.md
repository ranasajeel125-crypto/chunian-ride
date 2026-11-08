# Chunian Ride — Backup & Restore

All app data (users, drivers, rides, offers, wallets, transactions, top-up
requests, promo codes, admin accounts, audit log) lives in **one SQLite /
libSQL database**. On the live site that database is Turso (when
`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` are set in Render) or a local file
(`data/chunian-ride.db`) when they are not. **Local-file data does NOT survive
a Render redeploy** — back up before every deploy, and move to Turso for
production.

## 1. Turso backup (live site, once Turso is configured)

From any machine with the Turso CLI logged in:

```bash
# Full SQL dump (schema + data) — run before every deploy:
turso db shell chunian-ride ".dump" > chunian-ride-backup-YYYY-MM-DD.sql

# Or export the raw database file:
turso db shell chunian-ride ".backup chunian-ride-backup-YYYY-MM-DD.db"
```

Keep backups in a private folder (never in the public repo, never in a
shared chat). A dump is typically a few hundred KB at launch scale.

### Restore (Turso)

```bash
# Restore a dump into a NEW database first — never restore over the live
# database blindly:
turso db create chunian-ride-restore
turso db shell chunian-ride-restore < chunian-ride-backup-YYYY-MM-DD.sql

# Check the restored data, then point the app at it (Render dashboard):
# TURSO_DATABASE_URL = libsql://chunian-ride-restore-xxxx.turso.io
# TURSO_AUTH_TOKEN  = token from: turso db tokens create chunian-ride-restore
```

## 2. Local-file backup (development / pre-Turso)

```bash
# The app must be STOPPED first (or the copy may be inconsistent):
cp data/chunian-ride.db chunian-ride-backup-YYYY-MM-DD.db

# Restore:
cp chunian-ride-backup-YYYY-MM-DD.db data/chunian-ride.db
```

## 3. What to back up, and how often

| Data | Where | How often |
|---|---|---|
| Full database | Turso dump (`.dump`) | Before every deploy; weekly at minimum |
| Full database | Local file copy | Before every local schema change |
| Render env vars | Render dashboard → Environment (copy the keys, not the values, into a private note) | Whenever they change |

## 4. Migration safety rules (for developers)

- All schema changes are **additive**: `CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN` in a try/catch, `INSERT OR IGNORE` /
  `INSERT ... WHERE NOT EXISTS` for derived data. `initDb()` is safe to run
  on every boot — it never drops a table or deletes a row.
- Never run `DROP TABLE`, `DELETE FROM <table>` without a `WHERE`, or a
  destructive migration on the live database. Test every migration on a
  scratch copy first (`npm run smoke` uses a scratch DB).
- The `wallets` table is the single source of truth for balances;
  `drivers.wallet_balance` is a mirror kept in sync by `adjustWallet()`.
  `transactions` is the ledger; `wallet_tx` is legacy (migrated once at
  boot, no new writes after Phase 1).

## 5. Disaster recovery checklist

1. Stop the app (Render dashboard → Suspend, or push nothing).
2. Restore the newest backup into a fresh Turso database (see §1).
3. Verify: `turso db shell chunian-ride-restore "SELECT COUNT(*) FROM users;"`
   and `"SELECT COUNT(*) FROM rides;"` — counts must match the backup date.
4. Point Render at the restored database (env vars), redeploy.
5. Check `/api/health` reports `db: "turso"` and the homepage loads.
6. Log in as admin and spot-check one ride, one wallet, one top-up request.
