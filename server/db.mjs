// Chunian Ride — database layer.
// Uses @libsql/client so the same SQLite schema runs locally (file: URL)
// and in production on Turso (libsql:// URL + auth token) if configured.
// Default (no env vars): local SQLite file ./data/chunian-ride.db
// NOTE: on Render's free tier the local disk is ephemeral — data resets on
// redeploy/restart. Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN in Render for
// persistent data (see docs/backup.md). The app keeps working on local
// SQLite until those vars are set, but data will not survive a redeploy.
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const url = process.env.TURSO_DATABASE_URL || "file:./data/chunian-ride.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

let dbPath = null;
if (url.startsWith("file:")) {
  dbPath = path.resolve(root, url.slice("file:".length));
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

export const client = createClient(
  url.startsWith("file:") ? { url } : { url, authToken }
);
export const usingTurso = !url.startsWith("file:");

export const PLACES = [
  // name, lat, lng, road distance (km) from Chunian city. null = not verified.
  { name: "Chunian City", lat: 30.9667, lng: 74.0333, km: 0, note: "Within town" },
  { name: "Theeng Mor", lat: 31.03, lng: 73.95, km: 12, note: "~12 km from Chunian" },
  { name: "Changa Manga", lat: 31.08, lng: 73.9667, km: 13, note: "~13 km from Chunian" },
  { name: "Pattoki", lat: 31.0247, lng: 73.8528, km: 14, note: "14 km from Chunian" },
  { name: "Kot Radha Kishan", lat: 31.1736, lng: 74.1019, km: 30, note: "~30 km from Chunian" },
  { name: "Kasur", lat: 31.116, lng: 74.437, km: 48, note: "~48 km from Chunian" },
  { name: "Lahore", lat: 31.5204, lng: 74.3587, km: 89, note: "~89 km by road (~70 km straight line)" },
  { name: "Allahabad", lat: 30.998, lng: 74.278, km: null, note: "Distance not verified — fare estimated from map" },
];

export const DEFAULT_SETTINGS = {
  rate_bike_per_km: "15",
  rate_rickshaw_per_km: "25",
  rate_car_per_km: "70",
  min_bike: "50",
  min_rickshaw: "100",
  min_car: "150",
  commission_pct: "12",
  booking_fee: "20",
  jazzcash_number: "03266040350",
  sadapay_number: "",
  owner_name: "Chunian Ride",
  min_topup: "500",
  support_phone: "",
  support_whatsapp: "",
};

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'rider',
    rating REAL NOT NULL DEFAULT 5.0,
    rating_count INTEGER NOT NULL DEFAULT 0,
    demo INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    vehicle_type TEXT NOT NULL,
    vehicle_model TEXT NOT NULL DEFAULT '',
    plate TEXT NOT NULL DEFAULT '',
    cnic TEXT NOT NULL DEFAULT '',
    licence TEXT NOT NULL DEFAULT '',
    vehicle_reg TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    online INTEGER NOT NULL DEFAULT 0,
    wallet_balance INTEGER NOT NULL DEFAULT 0,
    lat REAL, lng REAL, loc_updated_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rider_id INTEGER NOT NULL REFERENCES users(id),
    driver_id INTEGER REFERENCES users(id),
    pickup TEXT NOT NULL,
    destination TEXT NOT NULL,
    distance_km REAL NOT NULL,
    distance_estimated INTEGER NOT NULL DEFAULT 0,
    vehicle_type TEXT NOT NULL,
    suggested_fare INTEGER NOT NULL,
    proposed_fare INTEGER NOT NULL,
    agreed_fare INTEGER,
    status TEXT NOT NULL DEFAULT 'requested',
    cash_confirmed INTEGER NOT NULL DEFAULT 0,
    commission_charged INTEGER,
    rating_driver INTEGER,
    rating_rider INTEGER,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ride_id INTEGER NOT NULL REFERENCES rides(id),
    driver_id INTEGER NOT NULL REFERENCES users(id),
    fare INTEGER NOT NULL,
    eta_min INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_tx (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT '',
    tid TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ride_id INTEGER,
    user_id INTEGER,
    kind TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ride_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ride_id INTEGER NOT NULL REFERENCES rides(id),
    sender_role TEXT NOT NULL,
    sender_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  // ---- Phase 1 tables ----
  // Server-side sessions (revocable). owner_type: 'user' | 'admin'.
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER,
    user_agent TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_type, owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
  // Admin accounts — separate from users. role: 'owner' | 'admin'.
  // The old shared ADMIN_PIN is only a one-time bootstrap key: it is accepted
  // solely to create the FIRST admin account, then ignored.
  `CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  )`,
  // Top-up requests — PENDING until the owner verifies the TID in his own
  // JazzCash app and approves. The wallet is credited ONLY on approval,
  // inside one transaction (see approveTopup). A fake TID buys nothing.
  `CREATE TABLE IF NOT EXISTS topup_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'JazzCash',
    tid TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by INTEGER,
    reviewed_at INTEGER,
    reject_reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_topup_driver ON topup_requests(driver_id)`,
  `CREATE INDEX IF NOT EXISTS idx_topup_status ON topup_requests(status)`,
  // Ride status history — audit trail for every ride status change.
  `CREATE TABLE IF NOT EXISTS ride_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ride_id INTEGER NOT NULL REFERENCES rides(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor_id INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ride_history ON ride_status_history(ride_id)`,
  // Audit log — admin actions + all wallet balance changes.
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    actor_role TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    detail TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id)`,
  // Vehicles — one row per registered vehicle (a driver may add more later).
  // drivers.vehicle_* columns are kept in sync as a mirror for v1 reads.
  `CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_user_id INTEGER NOT NULL REFERENCES users(id),
    vehicle_type TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    plate TEXT NOT NULL DEFAULT '',
    registration_no TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vehicles_driver ON vehicles(driver_user_id)`,
  // Cities / service areas — seeded from PLACES; admin-manageable later.
  `CREATE TABLE IF NOT EXISTS cities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    km_from_chunian REAL,
    note TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,
  // Wallets — single source of truth for ALL users (riders + drivers).
  // drivers.wallet_balance is kept in sync as a mirror for v1 reads.
  `CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  // Unified transaction ledger (all users). wallet_tx is legacy: its rows are
  // migrated here once, and no new rows are written to wallet_tx after Phase 1.
  `CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT '',
    tid TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    related_ride_id INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id)`,
  // Promo codes — foundation only in Phase 1 (no fare-math integration yet).
  `CREATE TABLE IF NOT EXISTS promo_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT 0,
    uses INTEGER NOT NULL DEFAULT 0,
    valid_from INTEGER,
    valid_to INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,
  // Passengers — rider profile extras (Phase 2 fills this in).
  `CREATE TABLE IF NOT EXISTS passengers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    home_address TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
];

// Additive column migrations — safe to re-run on every boot (idempotent).
const COLUMN_MIGRATIONS = [
  ["users", "password_hash TEXT NOT NULL DEFAULT ''"],
  ["users", "phone_verified INTEGER NOT NULL DEFAULT 0"],
  ["users", "status TEXT NOT NULL DEFAULT 'active'"],
  ["users", "updated_at INTEGER"],
  ["drivers", "documents_status TEXT NOT NULL DEFAULT 'pending'"],
  ["drivers", "loc_updated_at INTEGER"],
  ["rides", "scheduled_for INTEGER"],
  ["rides", "tip_amount INTEGER NOT NULL DEFAULT 0"],
];

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function distanceBetween(fromName, toName) {
  const a = PLACES.find((p) => p.name === fromName);
  const b = PLACES.find((p) => p.name === toName);
  if (!a || !b) return { km: null, estimated: true };
  if (fromName === "Chunian City" && b.km != null) return { km: b.km, estimated: false };
  if (toName === "Chunian City" && a.km != null) return { km: a.km, estimated: false };
  if (a.km != null && b.km != null) {
    // Both are out-of-town places: no verified road distance between them.
    return { km: Math.round(haversineKm(a, b) * 1.3), estimated: true };
  }
  return { km: Math.round(haversineKm(a, b) * 1.3), estimated: true };
}

export async function getSettings() {
  const res = await client.execute("SELECT key, value FROM settings");
  const out = { ...DEFAULT_SETTINGS };
  for (const row of res.rows) out[row.key] = row.value;
  return out;
}

export function fareFor(settings, vehicle, km) {
  const perKm = Number(settings[`rate_${vehicle}_per_km`]);
  const min = Number(settings[`min_${vehicle}`]);
  return Math.max(min, Math.round(perKm * km));
}

export function platformTake(settings, fare) {
  const commission = Math.round((fare * Number(settings.commission_pct)) / 100);
  return commission + Number(settings.booking_fee);
}

// Run fn inside a write transaction; rolls back on any error. Used for all
// money movements and guarded status changes (no double-credit, no double
// ride completion).
export async function withTx(fn) {
  const tx = await client.transaction("write");
  try {
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (e) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw e;
  }
}

export async function writeAudit(txOrClient, { actorId = null, actorRole = "", action, targetType = null, targetId = null, detail = "" }) {
  await txOrClient.execute({
    sql: "INSERT INTO audit_log(actor_id, actor_role, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [actorId, actorRole, action, targetType, targetId, detail, Date.now()],
  });
}

export async function writeRideHistory(txOrClient, rideId, fromStatus, toStatus, actorId = null) {
  await txOrClient.execute({
    sql: "INSERT INTO ride_status_history(ride_id, from_status, to_status, actor_id, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [rideId, fromStatus, toStatus, actorId, Date.now()],
  });
}

// Wallet helpers — wallets is the single source of truth; drivers.wallet_balance
// is kept in sync as a mirror. Every balance change writes a transactions row.
export async function ensureWallet(txOrClient, userId) {
  await txOrClient.execute({
    sql: "INSERT OR IGNORE INTO wallets(user_id, balance, updated_at) VALUES (?, 0, ?)",
    args: [userId, Date.now()],
  });
}

export async function getWalletBalance(userId) {
  const r = await client.execute({ sql: "SELECT balance FROM wallets WHERE user_id = ?", args: [userId] });
  return r.rows.length ? Number(r.rows[0].balance) : 0;
}

// Adjust a user's wallet by delta (positive = credit, negative = debit).
// Writes the ledger row + mirror in the same transaction when tx is given.
export async function adjustWallet(txOrClient, userId, delta, { type, method = "", tid = "", note = "", rideId = null }) {
  await ensureWallet(txOrClient, userId);
  await txOrClient.execute({
    sql: "UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ?",
    args: [delta, Date.now(), userId],
  });
  await txOrClient.execute({
    sql: "INSERT INTO transactions(user_id, type, amount, method, tid, note, related_ride_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [userId, type, delta, method, tid, note, rideId, Date.now()],
  });
  // Mirror for drivers (v1 reads drivers.wallet_balance).
  const d = await txOrClient.execute({ sql: "SELECT 1 AS x FROM drivers WHERE user_id = ?", args: [userId] });
  if (d.rows.length) {
    await txOrClient.execute({
      sql: "UPDATE drivers SET wallet_balance = wallet_balance + ? WHERE user_id = ?",
      args: [delta, userId],
    });
  }
  const bal = await txOrClient.execute({ sql: "SELECT balance FROM wallets WHERE user_id = ?", args: [userId] });
  return bal.rows.length ? Number(bal.rows[0].balance) : 0;
}

// Approve a pending top-up request: status guard + credit + ledger + audit,
// all in ONE transaction. Returns the new wallet balance.
// Throws if the request does not exist or is not pending (no double-credit).
export async function approveTopup(requestId, adminId) {
  return withTx(async (tx) => {
    const cur = await tx.execute({ sql: "SELECT * FROM topup_requests WHERE id = ?", args: [requestId] });
    if (!cur.rows.length) throw new Error("topup request not found");
    const req = cur.rows[0];
    if (req.status !== "pending") throw new Error("topup request already reviewed");
    await tx.execute({
      sql: "UPDATE topup_requests SET status='approved', reviewed_by=?, reviewed_at=? WHERE id=? AND status='pending'",
      args: [adminId, Date.now(), requestId],
    });
    const balance = await adjustWallet(tx, Number(req.driver_id), Number(req.amount), {
      type: "topup",
      method: req.method || "JazzCash",
      tid: req.tid || "",
      note: `Top-up approved (request #${requestId}, TID ${req.tid || "—"})`,
    });
    await writeAudit(tx, {
      actorId: adminId, actorRole: "admin", action: "topup_approve",
      targetType: "topup_request", targetId: requestId,
      detail: `Approved Rs ${req.amount} (${req.method}, TID ${req.tid || "—"}) for driver user #${req.driver_id}`,
    });
    return { driver_id: Number(req.driver_id), amount: Number(req.amount), wallet_balance: balance };
  });
}

export async function rejectTopup(requestId, adminId, reason = "") {
  return withTx(async (tx) => {
    const cur = await tx.execute({ sql: "SELECT * FROM topup_requests WHERE id = ?", args: [requestId] });
    if (!cur.rows.length) throw new Error("topup request not found");
    const req = cur.rows[0];
    if (req.status !== "pending") throw new Error("topup request already reviewed");
    await tx.execute({
      sql: "UPDATE topup_requests SET status='rejected', reviewed_by=?, reviewed_at=?, reject_reason=? WHERE id=? AND status='pending'",
      args: [adminId, Date.now(), reason, requestId],
    });
    await writeAudit(tx, {
      actorId: adminId, actorRole: "admin", action: "topup_reject",
      targetType: "topup_request", targetId: requestId,
      detail: `Rejected Rs ${req.amount} (${req.method}, TID ${req.tid || "—"}) for driver user #${req.driver_id}. Reason: ${reason || "—"}`,
    });
    return { driver_id: Number(req.driver_id), amount: Number(req.amount) };
  });
}

export async function getPlaces() {
  const res = await client.execute("SELECT name, lat, lng, km_from_chunian AS km, note FROM cities WHERE active = 1 ORDER BY id ASC");
  if (res.rows.length) return res.rows.map((r) => ({ name: r.name, lat: r.lat, lng: r.lng, km: r.km, note: r.note }));
  return PLACES;
}

export async function initDb() {
  for (const s of STATEMENTS) await client.execute(s);
  // Additive column migrations (idempotent — each ALTER is tried, ignored if
  // the column already exists).
  for (const [table, col] of COLUMN_MIGRATIONS) {
    try { await client.execute(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* column already exists */ }
  }
  // One phone number = one account. Wrapped: fails silently if old data has
  // duplicate phones (log it — the owner must resolve duplicates manually).
  try {
    await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone)");
  } catch (e) {
    console.warn("[chunian-ride] could not create unique index on users.phone (duplicate phones?)", e.message);
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await client.execute({
      sql: "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
      args: [k, v],
    });
  }
  // Seed cities from the verified PLACES list (kept in code as the fallback).
  const now = Date.now();
  for (const p of PLACES) {
    await client.execute({
      sql: "INSERT OR IGNORE INTO cities(name, lat, lng, km_from_chunian, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [p.name, p.lat, p.lng, p.km, p.note || "", now],
    });
  }
  // Seed once (demo data) — only when the users table is empty.
  const count = await client.execute("SELECT COUNT(*) AS n FROM users");
  if (Number(count.rows[0].n) === 0) {
    const demoDrivers = [
      { name: "Ahmed Raza", phone: "0301-0000001", vehicle: "bike", model: "Honda CD 70", plate: "DEMO-BIKE-01", wallet: 2000 },
      { name: "Bilal Hussain", phone: "0301-0000002", vehicle: "rickshaw", model: "Tez Raftar Rickshaw", plate: "DEMO-RIK-01", wallet: 2000 },
      { name: "Usman Ghani", phone: "0301-0000003", vehicle: "car", model: "Toyota Corolla", plate: "DEMO-CAR-01", wallet: 2000 },
      { name: "Hassan Ali", phone: "0301-0000004", vehicle: "car", model: "Suzuki Alto", plate: "DEMO-CAR-02", wallet: 2000 },
    ];
    const driverUserIds = {};
    // Demo drivers start with NO rating (rating 0, count 0) — stars only ever
    // come from real completed rides. Never seed fake ratings.
    for (const d of demoDrivers) {
      const u = await client.execute({
        sql: "INSERT INTO users(name, phone, role, rating, rating_count, demo, created_at) VALUES (?, ?, 'driver', 0, 0, 1, ?)",
        args: [d.name, d.phone, now],
      });
      const userId = Number(u.lastInsertRowid);
      driverUserIds[d.name] = userId;
      await client.execute({
        sql: "INSERT INTO drivers(user_id, vehicle_type, vehicle_model, plate, cnic, licence, vehicle_reg, status, online, wallet_balance, lat, lng, created_at) VALUES (?, ?, ?, ?, '35202-0000000-1 (demo)', 'LTV-DEMO (demo)', 'REG-DEMO (demo)', 'approved', 1, ?, 30.9667, 74.0333, ?)",
        args: [userId, d.vehicle, d.model, d.plate, d.wallet, now],
      });
      await client.execute({
        sql: "INSERT INTO wallet_tx(driver_id, type, amount, method, tid, note, created_at) VALUES (?, 'topup', ?, 'JazzCash (demo)', '', 'Demo starting balance', ?)",
        args: [userId, d.wallet, now],
      });
    }
    const rider = await client.execute({
      sql: "INSERT INTO users(name, phone, role, rating, rating_count, demo, created_at) VALUES ('Demo Rider', '0300-0000000', 'rider', 0, 0, 1, ?)",
      args: [now],
    });
    const riderId = Number(rider.lastInsertRowid);
    // Demo ride 1: completed, Car, Chunian City -> Pattoki, 14 km, fare Rs 980.
    const r1 = await client.execute({
      sql: "INSERT INTO rides(rider_id, driver_id, pickup, destination, distance_km, distance_estimated, vehicle_type, suggested_fare, proposed_fare, agreed_fare, status, cash_confirmed, commission_charged, rating_driver, created_at, completed_at) VALUES (?, ?, 'Chunian City', 'Pattoki', 14, 0, 'car', 980, 980, 980, 'completed', 1, 138, 5, ?, ?)",
      args: [riderId, driverUserIds["Usman Ghani"], now - 86400000, now - 86400000 + 1800000],
    });
    await client.execute({
      sql: "INSERT INTO wallet_tx(driver_id, type, amount, method, note, created_at) VALUES (?, 'commission', -138, 'auto', 'Demo ride 1 commission 12% (Rs 118) + booking fee Rs 20', ?)",
      args: [driverUserIds["Usman Ghani"], now - 86400000 + 1800000],
    });
    await client.execute({
      sql: "UPDATE drivers SET wallet_balance = wallet_balance - 138 WHERE user_id = ?",
      args: [driverUserIds["Usman Ghani"]],
    });
    // Demo ride 2: completed, Bike, within Chunian City, 3 km, fare Rs 50 (minimum).
    await client.execute({
      sql: "INSERT INTO rides(rider_id, driver_id, pickup, destination, distance_km, distance_estimated, vehicle_type, suggested_fare, proposed_fare, agreed_fare, status, cash_confirmed, commission_charged, rating_driver, created_at, completed_at) VALUES (?, ?, 'Chunian City', 'Chunian City', 3, 0, 'bike', 50, 50, 50, 'completed', 1, 26, 5, ?, ?)",
      args: [riderId, driverUserIds["Ahmed Raza"], now - 43200000, now - 43200000 + 600000],
    });
    await client.execute({
      sql: "INSERT INTO wallet_tx(driver_id, type, amount, method, note, created_at) VALUES (?, 'commission', -26, 'auto', 'Ride commission 12% (Rs 6) + booking fee Rs 20', ?)",
      args: [driverUserIds["Ahmed Raza"], now - 43200000 + 600000],
    });
    await client.execute({
      sql: "UPDATE drivers SET wallet_balance = wallet_balance - 26 WHERE user_id = ?",
      args: [driverUserIds["Ahmed Raza"]],
    });
    void r1;
  }
  // ---- Derived data (idempotent — safe to run on every boot) ----
  // Normalize stored phone numbers (strip spaces/dashes) so logins match
  // regardless of how the number was typed. Wrapped: fails if two accounts
  // would collide after normalizing (owner must resolve duplicates manually).
  try {
    await client.execute({
      sql: "UPDATE users SET phone = REPLACE(REPLACE(phone, '-', ''), ' ', '') WHERE phone LIKE '%-%' OR phone LIKE '% %'",
    });
  } catch (e) {
    console.warn("[chunian-ride] could not normalize phone numbers (duplicate phones?)", e.message);
  }
  // Vehicles: one row per existing driver profile (from drivers.vehicle_*).
  await client.execute({
    sql: `INSERT INTO vehicles(driver_user_id, vehicle_type, model, plate, registration_no, status, created_at)
          SELECT d.user_id, d.vehicle_type, d.vehicle_model, d.plate, d.vehicle_reg, 'active', ?
          FROM drivers d WHERE NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.driver_user_id = d.user_id)`,
    args: [now],
  });
  // Wallets: one per user. Drivers start from their current wallet_balance;
  // riders start at 0. (Balances are NOT reset — INSERT only for missing rows.)
  await client.execute({
    sql: `INSERT INTO wallets(user_id, balance, updated_at)
          SELECT u.id, COALESCE((SELECT d.wallet_balance FROM drivers d WHERE d.user_id = u.id), 0), ?
          FROM users u WHERE NOT EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id)`,
    args: [now],
  });
  // Unified ledger: migrate legacy wallet_tx rows once (only while the new
  // ledger is still empty — afterwards all writes go to transactions).
  const txCount = await client.execute("SELECT COUNT(*) AS n FROM transactions");
  if (Number(txCount.rows[0].n) === 0) {
    await client.execute({
      sql: `INSERT INTO transactions(user_id, type, amount, method, tid, note, created_at)
            SELECT driver_id, type, amount, method, tid, note, created_at FROM wallet_tx`,
    });
  }
  // Passengers: one profile row per rider user.
  await client.execute({
    sql: `INSERT INTO passengers(user_id, created_at)
          SELECT u.id, ? FROM users u WHERE u.role = 'rider'
          AND NOT EXISTS (SELECT 1 FROM passengers p WHERE p.user_id = u.id)`,
    args: [now],
  });
  // Expire stale sessions (older than 30 days) — housekeeping on boot.
  try {
    await client.execute({ sql: "DELETE FROM sessions WHERE expires_at < ?", args: [now] });
  } catch { /* sessions table is new; ignore */ }
}
