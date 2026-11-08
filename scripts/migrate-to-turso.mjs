// Chunian Ride — one-time migration: local SQLite -> Turso (libSQL).
//
// Exports EVERY table from the local file DB (data/chunian-ride.db by
// default) and imports it into Turso via @libsql/client, preserving every
// row and every id (AUTOINCREMENT ids are inserted explicitly, so foreign
// keys keep pointing at the right rows).
//
// The live app still runs on LOCAL SQLite — no Turso cloud DB exists yet
// (blocked on the owner's Turso dashboard steps). This script is the
// migration path for the day the Turso DB exists: create the Turso DB,
// set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN in Render, run this script
// ONCE from this machine, then verify /api/health shows db "turso".
// Do NOT claim Turso is connected until that check passes.
//
// Usage:
//   node scripts/migrate-to-turso.mjs [--source <path>] [--dry-run] [--force]
//
//   --source <path>  Local SQLite file to export (default: data/chunian-ride.db,
//                    relative to the repo root or absolute).
//   --dry-run        Export + count only. Prints per-table source counts
//                    (and target counts if the target is reachable). No writes.
//   --force          Import even if the target already has rows. WITHOUT
//                    --force the script REFUSES to import into a non-empty
//                    target. With --force it deletes all rows from the target
//                    tables first (reverse dependency order), then imports.
//
// Env (target):
//   TURSO_DATABASE_URL   libsql://<db>.turso.io  (real Turso) or
//                        http://127.0.0.1:8080   (local sqld, for testing)
//   TURSO_AUTH_TOKEN     Required for libsql:// URLs. Not needed for a
//                        local sqld without --auth.
//
// Safety:
//   - Target counts are checked BEFORE any write; a non-empty target stops
//     the run unless --force is passed.
//   - After import, per-table row counts (and max(id) where the table has
//     an integer id) are re-read from the target and compared to the
//     source. Any mismatch exits non-zero.
//   - The auth token is never printed.
//   - Refuses to run if the target URL is the same file as the source.
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

// Dependency order: parents before children, so explicit ids always resolve.
const TABLES = [
  "settings",
  "users",
  "admins",
  "drivers",
  "vehicles",
  "cities",
  "wallets",
  "rides",
  "offers",
  "wallet_tx",
  "transactions",
  "ride_messages",
  "ride_status_history",
  "topup_requests",
  "complaints",
  "audit_log",
  "promo_codes",
  "sessions",
  "passengers",
];

const BATCH_SIZE = 100;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const sourceArg = (() => {
  const i = args.indexOf("--source");
  return i >= 0 && args[i + 1] ? args[i + 1] : "data/chunian-ride.db";
})();
const sourcePath = path.isAbsolute(sourceArg) ? sourceArg : path.resolve(root, sourceArg);

const targetUrl = process.env.TURSO_DATABASE_URL || "";
const targetToken = process.env.TURSO_AUTH_TOKEN || "";

function fail(msg) {
  console.error(`\nMIGRATE: ERROR — ${msg}`);
  process.exit(1);
}

// Never print the token; show only the target host.
function describeTarget(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url.replace(/:[^:/@]+@/, ":***@");
  }
}

async function tableExists(db, name) {
  const r = await db.execute({ sql: "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", args: [name] });
  return r.rows.length > 0;
}

async function countRows(db, name) {
  if (!(await tableExists(db, name))) return null; // table missing
  const r = await db.execute(`SELECT COUNT(*) AS n FROM "${name}"`);
  return Number(r.rows[0].n);
}

async function maxId(db, name) {
  const cols = await db.execute({ sql: `PRAGMA table_info("${name}")` });
  const hasId = cols.rows.some((c) => c.name === "id" && String(c.type).toUpperCase().includes("INT"));
  if (!hasId) return null;
  const r = await db.execute(`SELECT MAX(id) AS m FROM "${name}"`);
  return r.rows[0].m == null ? null : Number(r.rows[0].m);
}

async function readTable(db, name) {
  const cols = await db.execute({ sql: `PRAGMA table_info("${name}")` });
  const names = cols.rows.map((c) => c.name);
  const rows = await db.execute(`SELECT * FROM "${name}" ORDER BY rowid`);
  return { columns: names, rows: rows.rows };
}

async function main() {
  console.log("Chunian Ride — local SQLite -> Turso migration");
  console.log(`  source: ${sourcePath}`);
  console.log(`  target: ${targetUrl ? describeTarget(targetUrl) : "(not configured)"}`);
  console.log(`  mode:   ${dryRun ? "DRY-RUN (no writes)" : force ? "IMPORT (with --force: target rows will be deleted first)" : "IMPORT"}`);

  if (!fs.existsSync(sourcePath)) fail(`source DB not found: ${sourcePath}`);
  if (!dryRun) {
    if (!targetUrl) fail("TURSO_DATABASE_URL is not set — nothing to import into.");
    if (targetUrl.startsWith("libsql://") && !targetToken) {
      fail("TURSO_AUTH_TOKEN is not set — required for libsql:// (Turso) URLs.");
    }
    if (targetUrl === `file:${sourcePath}` || targetUrl === `file:./${path.relative(process.cwd(), sourcePath)}`) {
      fail("target URL is the same file as the source — refusing to migrate a DB into itself.");
    }
  }

  // ---- 1. Export: read every table from the local file ----
  const source = createClient({ url: `file:${sourcePath}` });
  const exported = {};
  let totalSource = 0;
  console.log("\n-- Source counts --");
  for (const t of TABLES) {
    if (!(await tableExists(source, t))) {
      console.log(`  ${t.padEnd(20)} MISSING in source — skipped`);
      exported[t] = null;
      continue;
    }
    const { columns, rows } = await readTable(source, t);
    const m = await maxId(source, t);
    exported[t] = { columns, rows, count: rows.length, maxId: m };
    totalSource += rows.length;
    console.log(`  ${t.padEnd(20)} ${String(rows.length).padStart(6)} rows${m != null ? `  (max id ${m})` : ""}`);
  }
  console.log(`  ${"TOTAL".padEnd(20)} ${String(totalSource).padStart(6)} rows`);

  if (dryRun) {
    if (targetUrl) {
      console.log("\n-- Target counts (read-only) --");
      try {
        const target = createClient(targetUrl.startsWith("libsql://") || targetUrl.startsWith("http")
          ? { url: targetUrl, authToken: targetToken || undefined }
          : { url: targetUrl });
        for (const t of TABLES) {
          const n = await countRows(target, t);
          console.log(`  ${t.padEnd(20)} ${n == null ? "no table yet" : `${n} rows`}`);
        }
      } catch (e) {
        console.log(`  (could not reach target: ${e.message})`);
      }
    } else {
      console.log("\n(Target not configured — set TURSO_DATABASE_URL to also show target counts.)");
    }
    console.log("\nMIGRATE: dry-run done — no writes made.");
    return;
  }

  // ---- 2. Target: create the schema from the source's own DDL ----
  // Copying sqlite_master SQL guarantees the target schema matches the
  // source exactly (tables + indexes), with no duplicated schema code.
  const target = createClient(
    targetUrl.startsWith("file:")
      ? { url: targetUrl }
      : { url: targetUrl, authToken: targetToken || undefined }
  );
  console.log("\n-- Creating target schema (from source DDL) --");
  const ddl = await source.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid"
  );
  const tablesDdl = ddl.rows.filter((r) => r.type === "table" && TABLES.includes(r.name));
  const indexesDdl = ddl.rows.filter((r) => r.type === "index");
  // Tables first, in dependency order; indexes after.
  for (const t of TABLES) {
    const row = tablesDdl.find((r) => r.name === t);
    if (!row) continue;
    try {
      await target.execute(row.sql);
      console.log(`  table ${t} — created`);
    } catch (e) {
      if (/already exists/i.test(e.message)) console.log(`  table ${t} — already exists`);
      else throw e;
    }
  }
  for (const row of indexesDdl) {
    try {
      await target.execute(row.sql);
    } catch (e) {
      if (!/already exists/i.test(e.message)) throw e;
    }
  }
  console.log(`  indexes — ${indexesDdl.length} applied (or already present)`);

  // ---- 3. Refuse a non-empty target unless --force ----
  console.log("\n-- Target emptiness check --");
  const targetBefore = {};
  let targetHasData = false;
  for (const t of TABLES) {
    const n = await countRows(target, t);
    targetBefore[t] = n == null ? 0 : n;
    if (targetBefore[t] > 0) targetHasData = true;
    console.log(`  ${t.padEnd(20)} ${targetBefore[t]} rows`);
  }
  if (targetHasData && !force) {
    fail(
      "target already has data — refusing to import. " +
      "Re-run with --force to delete the target rows first, " +
      "or point TURSO_DATABASE_URL at a fresh/empty Turso DB."
    );
  }
  if (targetHasData && force) {
    console.log("\n-- --force: clearing target rows (reverse dependency order) --");
    for (const t of [...TABLES].reverse()) {
      if (targetBefore[t] > 0) {
        await target.execute(`DELETE FROM "${t}"`);
        console.log(`  cleared ${t} (${targetBefore[t]} rows)`);
      }
    }
  }

  // ---- 4. Import: explicit ids, batched ----
  console.log("\n-- Importing --");
  for (const t of TABLES) {
    const data = exported[t];
    if (!data || data.rows.length === 0) {
      console.log(`  ${t.padEnd(20)} 0 rows — nothing to import`);
      continue;
    }
    const cols = data.columns.map((c) => `"${c}"`).join(", ");
    const placeholders = data.columns.map(() => "?").join(", ");
    const sql = `INSERT INTO "${t}" (${cols}) VALUES (${placeholders})`;
    for (let i = 0; i < data.rows.length; i += BATCH_SIZE) {
      const chunk = data.rows.slice(i, i + BATCH_SIZE);
      await target.batch(chunk.map((row) => ({ sql, args: data.columns.map((c) => row[c] ?? null) })));
    }
    console.log(`  ${t.padEnd(20)} ${data.rows.length} rows imported`);
  }

  // ---- 5. Verify: counts (+ max id) must match the source ----
  console.log("\n-- Verification (target vs source) --");
  let ok = true;
  for (const t of TABLES) {
    const data = exported[t];
    if (!data) continue; // was missing in source
    const n = await countRows(target, t);
    const m = await maxId(target, t);
    const countOk = n === data.count;
    const idOk = m === data.maxId;
    if (!countOk || !idOk) ok = false;
    console.log(
      `  ${countOk && idOk ? "OK  " : "FAIL"} ${t.padEnd(20)} source ${data.count} rows` +
      `${data.maxId != null ? ` (max id ${data.maxId})` : ""}  ->  target ${n} rows` +
      `${m != null ? ` (max id ${m})` : ""}`
    );
  }
  if (!ok) fail("verification FAILED — counts do not match. Do not switch the app to this target.");
  console.log(`\nMIGRATE: OK — ${totalSource} rows across ${TABLES.length} tables, all counts match.`);
  console.log("Next steps:");
  console.log("  1. Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN in Render (service chunian-ride).");
  console.log("  2. Redeploy (or restart) and check /api/health shows db \"turso\".");
  console.log("  3. Spot-check counts via the admin dashboard (users / rides / wallets).");
}

main().catch((e) => fail(e.message || String(e)));
