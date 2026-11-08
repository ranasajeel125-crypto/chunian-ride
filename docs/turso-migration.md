# Chunian Ride — Local SQLite → Turso migration

## Honest status (2026-11-08)

- **The live app still runs on LOCAL SQLite** (`/api/health` → `db:
  "local-sqlite"`, `setup_needed: true`). **No Turso cloud DB exists yet** —
  the owner has not finished his Turso dashboard steps.
- **Do NOT claim Turso is connected.** The launch gate stays CLOSED until
  Turso is connected AND the persistence test passes (see below).
- What exists now: the migration script `scripts/migrate-to-turso.mjs`,
  tested end-to-end against a local `sqld` instance (same libSQL protocol
  Turso uses). Test report: 20/20 checks passed, 2026-11-08 (see §5).

## 1. What the script does

`node scripts/migrate-to-turso.mjs [--source <path>] [--dry-run] [--force]`

- Exports **all 19 tables** from the local SQLite file (`data/chunian-ride.db`
  by default) in dependency order:
  `settings, users, admins, drivers, vehicles, cities, wallets, rides,
  offers, wallet_tx, transactions, ride_messages, ride_status_history,
  topup_requests, complaints, audit_log, promo_codes, sessions, passengers`.
- Recreates the exact schema on the target from the source's own DDL
  (tables + indexes copied from `sqlite_master` — no duplicated schema).
- Imports every row with its **original id** (explicit ids, so all foreign
  keys keep pointing at the right rows). Sessions migrate too, so logged-in
  users stay logged in.
- **Refuses** to import into a target that already has rows, unless
  `--force` is passed (then it deletes the target rows first, in reverse
  dependency order, and re-imports).
- Verifies after import: per-table row counts **and** `max(id)` on the
  target must equal the source. Any mismatch exits non-zero — do not
  switch the app to that target.
- `--dry-run` exports + counts only. No writes at all.
- The auth token is never printed.

## 2. Owner steps (in order — do not skip)

### Step A — Create the Turso database (owner, on his phone/computer)

1. Go to [turso.tech](https://turso.tech) → sign up / log in.
2. Create a database, e.g. name `chunian-ride`, group closest to the users
   (e.g. `sin` Singapore or `bom` Mumbai — whichever Turso offers nearest
   Pakistan).
3. Create an auth token for it (Turso dashboard → database → "Create
   Token", or `turso db tokens create chunian-ride` in the Turso CLI).
4. Copy two values: the database URL (`libsql://chunian-ride-<...>.turso.io`)
   and the token. **Never paste the token in chat** — it goes straight into
   Render env vars (Step C) and into the migration run (Step B).

### Step B — Run the migration ONCE from this machine (assistant)

```bash
cd ~/workspace/chunian-ride

# 1. Dry run first — shows source counts, target state, no writes:
TURSO_DATABASE_URL='libsql://chunian-ride-<...>.turso.io' \
TURSO_AUTH_TOKEN='<token>' \
node scripts/migrate-to-turso.mjs --dry-run

# 2. Real run (refuses if the target already has data):
TURSO_DATABASE_URL='libsql://chunian-ride-<...>.turso.io' \
TURSO_AUTH_TOKEN='<token>' \
node scripts/migrate-to-turso.mjs
```

Expected output ends with:

```
MIGRATE: OK — <N> rows across 19 tables, all counts match.
```

If it refuses ("target already has data") and the target is a genuinely
fresh Turso DB, something is wrong — do NOT `--force` it away without
checking first. `--force` is only for a deliberate clean re-import.

### Step C — Point Render at Turso (owner, Render dashboard)

1. Render → service `chunian-ride` → Environment.
2. Add `TURSO_DATABASE_URL` = the `libsql://...` URL.
3. Add `TURSO_AUTH_TOKEN` = the token.
4. Save — Render redeploys automatically.

### Step D — Verify (assistant) — the launch gate

1. `curl https://chunian-ride.onrender.com/api/health` must show
   `"db": "turso"` (not `"local-sqlite"`).
2. Admin dashboard Overview must show the same user / ride / wallet
   counts as before the switch.
3. Persistence test: create a test record (or just confirm an existing
   ride + wallet balance), restart/redeploy the Render service, and confirm
   the record is still there. Local SQLite data did NOT survive redeploys;
   Turso data must.
4. Only when 1–3 pass is the launch gate open.

## 3. Rollback

- If anything is wrong after the switch, remove the two env vars in
  Render and redeploy: the app falls back to local SQLite. Note the local
  file on Render is ephemeral and may be an older copy — the Turso DB
  remains the source of truth once migrated; do not run the migration a
  second time into the same Turso DB without `--force` (it will refuse,
  which is the safe behaviour).
- The local file `data/chunian-ride.db` on this machine is NOT deleted by
  the migration. Keep it as a backup until the Turso switch is verified.

## 4. Getting `sqld` for local testing

`sqld` is the open-source libSQL server (same protocol Turso speaks).
Download the `libsql-server` release for your OS from
<https://github.com/tursodatabase/libsql/releases> (tested with
`libsql-server-v0.24.32`, `libsql-server-x86_64-unknown-linux-gnu.tar.xz`,
binary `sqld` inside). Run it with no auth for local tests:

```bash
sqld -d /tmp/sqld-data/data.sqld --http-listen-addr 127.0.0.1:8080
```

then point the script at it with
`TURSO_DATABASE_URL=http://127.0.0.1:8080` (no token needed).

## 5. Test report (2026-11-08, this machine)

Test driver: throwaway script (not in the repo) that built a scratch
source DB through the real API (admin setup, rider signup, demo driver
login, ride book → counter → accept → start → complete, chat, SOS,
top-up approve, new city, promo code — 88 rows across 19 tables),
started a local `sqld 0.24.32` on a fresh dir, and ran the migration:

- `--dry-run`: exit 0, source counts printed, target reported "no table
  yet", no writes made. **PASS**
- Real migration: exit 0, `MIGRATE: OK — 88 rows across 19 tables, all
  counts match` (incl. `max(id)` per table). **PASS**
- Second run without `--force`: refused, exit 1, "target already has
  data". **PASS**
- Re-run with `--force`: exit 0, verified again. **PASS**
- App booted against the sqld target: `/api/health` → `db: "turso"`;
  migrated admin + rider logins work; overview 7 users / 3 rides /
  revenue Rs 298; 9 cities incl. the migrated one; AC Car fare
  Chunian→Lahore Rs 7,565 on the migrated DB. **PASS**
- **20/20 checks passed. `sqld` binary kept at `~/.local/bin/sqld`.**

What this test does NOT prove: the real Turso cloud endpoint (no cloud
DB exists yet). The protocol, client code path, and verification logic
are identical; the cloud run in §2 Step B is still required.
