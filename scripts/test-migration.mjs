// Migration test (v2.1): prove the additive-only migrations are
// non-destructive on the preserved SQLite backup (data/chunian-ride.db).
// Copies the backup to a temp file, boots the server against the COPY,
// and compares row counts before/after for every pre-existing table.
// The original file is never opened for writing (sha256 verified before
// and after). New tables/columns must exist after the boot.
// Usage: node scripts/test-migration.mjs
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const orig = path.join(root, "data", "chunian-ride.db");
const copy = "/tmp/chunian-ride-migration-test.db";
const checksum = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const beforeHash = checksum(orig);

for (const f of [copy, copy + "-journal", copy + "-wal", copy + "-shm"]) if (fs.existsSync(f)) fs.unlinkSync(f);
fs.copyFileSync(orig, copy);

function counts(db) {
  const tables = execFileSync("sqlite3", [db, ".tables"]).toString().trim().split(/\s+/).filter(Boolean);
  const out = {};
  for (const t of tables) {
    out[t] = Number(execFileSync("sqlite3", [db, `SELECT COUNT(*) FROM "${t}";`]).toString().trim());
  }
  return out;
}
const before = counts(copy);
console.log("BEFORE (copy of preserved backup):", JSON.stringify(before));

const PORT = 3461;
const env = { ...process.env, PORT: String(PORT), TURSO_DATABASE_URL: `file:${copy}` };
const child = spawn("node", ["server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = false;
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) { ok = true; break; } } catch {}
  await sleep(500);
}
if (!ok) { console.error("server did not start:\n" + out); child.kill(); process.exit(1); }
const health = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json();
console.log("health on migrated copy:", JSON.stringify(health));
child.kill();
await sleep(500);

const after = counts(copy);
console.log("AFTER:", JSON.stringify(after));
let fail = 0;
for (const [t, n] of Object.entries(before)) {
  if (t === "settings") continue; // checked by value below, not by count
  if (after[t] !== n) { console.log(`FAIL  table ${t}: ${n} -> ${after[t]}`); fail++; }
  else console.log(`PASS  table ${t}: ${n} rows kept`);
}
// settings is a key-value store seeded with defaults: every pre-existing
// key must keep its EXACT value; new keys may only be ADDED (defaults).
const settingsBefore = Object.fromEntries(execFileSync("sqlite3", [copy, "SELECT key, value FROM settings;"]).toString().trim().split("\n").filter(Boolean).map((l) => { const i = l.indexOf("|"); return [l.slice(0, i), l.slice(i + 1)]; }));
// Re-read the pre-migration values from the ORIGINAL backup (the copy was migrated).
const origSettings = Object.fromEntries(execFileSync("sqlite3", [orig, "SELECT key, value FROM settings;"]).toString().trim().split("\n").filter(Boolean).map((l) => { const i = l.indexOf("|"); return [l.slice(0, i), l.slice(i + 1)]; }));
for (const [k, v] of Object.entries(origSettings)) {
  if (settingsBefore[k] !== v) { console.log(`FAIL  setting ${k}: "${v}" -> "${settingsBefore[k]}"`); fail++; }
}
console.log(`PASS  all ${Object.keys(origSettings).length} pre-existing settings values unchanged (${Object.keys(settingsBefore).length - Object.keys(origSettings).length} new defaults added)`);
for (const t of ["withdrawals", "notifications", "documents"]) {
  if (!(t in after)) { console.log(`FAIL  new table ${t} missing after migration`); fail++; }
  else console.log(`PASS  new table ${t} exists (${after[t]} rows)`);
}
const cols = execFileSync("sqlite3", [copy, "PRAGMA table_info(rides);"]).toString();
for (const c of ["promo_code", "discount_amount"]) {
  if (!cols.includes(c)) { console.log(`FAIL  rides.${c} column missing`); fail++; }
  else console.log(`PASS  rides.${c} column exists`);
}
const minW = execFileSync("sqlite3", [copy, "SELECT value FROM settings WHERE key='min_withdrawal';"]).toString().trim();
if (minW !== "100") { console.log(`FAIL  settings min_withdrawal = ${minW}`); fail++; }
else console.log("PASS  settings min_withdrawal = 100 (seeded)");
const afterHash = checksum(orig);
if (afterHash !== beforeHash) { console.log("FAIL  original backup file was modified!"); fail++; }
else console.log("PASS  original data/chunian-ride.db untouched (sha256 unchanged)");
for (const f of [copy, copy + "-journal", copy + "-wal", copy + "-shm"]) if (fs.existsSync(f)) fs.unlinkSync(f);
console.log(fail ? "\nMIGRATION TEST: FAILURES PRESENT" : "\nMIGRATION TEST: ALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
