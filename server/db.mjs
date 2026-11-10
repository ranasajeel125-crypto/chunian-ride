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
import { createRequire } from "node:module";

// web-push is optional at runtime: if the package is ever missing the
// server still boots and push is simply disabled (logged, not fatal).
const _require = createRequire(import.meta.url);
let webpush = null;
try { webpush = _require("web-push"); } catch { webpush = null; }

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
  rate_ac_car_per_km: "85",
  min_bike: "50",
  min_rickshaw: "100",
  min_car: "150",
  min_ac_car: "200",
  commission_pct: "12",
  booking_fee: "20",
  jazzcash_number: "03266040350",
  sadapay_number: "",
  owner_name: "Chunian Ride",
  min_topup: "500",
  min_withdrawal: "100",
  support_phone: "",
  support_whatsapp: "",
  // Pilot launch (Phase 3, v2.2) — controlled rollout, Chunian only.
  // pilot_mode "1" = public signup closed; only whitelisted phones can
  // register. pilot_chunian_only "1" = rides restricted to Chunian City.
  pilot_mode: "1",
  pilot_max_drivers: "10",
  pilot_max_riders: "20",
  pilot_chunian_only: "1",
  // Auto-approve (v2.6, inDrive-like login — owner order 2026-11-10).
  // "1" (default) = no owner bottleneck: riders join instantly (pilot
  // whitelist + caps bypassed) and drivers are approved automatically
  // once CNIC + licence + vehicle documents are all uploaded. "0" =
  // manual approval exactly as before (whitelist gate + owner approval).
  // The owner can flip it back any time from Admin → Pilot settings;
  // flipping OFF→ON sweeps pending drivers with complete documents.
  auto_approve: "1",
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
  // First-admin setup (v2.0) uses a random one-time token: only its
  // SHA-256 hash is stored (settings key admin_setup_token_hash), the
  // token is printed once to stdout, and the hash is deleted after use.
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
  // Withdrawals (v2.1) — driver requests cash out of the prepaid wallet.
  // The amount is HELD (deducted) at request time; approve = the owner
  // pays manually on JazzCash (no gateway); reject = auto-refund of the hold.
  `CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    jazzcash_number TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT NOT NULL DEFAULT '',
    reviewed_by INTEGER,
    reviewed_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawals_driver ON withdrawals(driver_id)`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status)`,
  // Notifications (v2.1) — in-app feed, Phase 1 (no push). type + params
  // (JSON); the client renders localized title/body from its template map.
  // role: 'user' (rider/driver, user_id = users.id) | 'admin' (admins.id).
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    type TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    ride_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, role, created_at)`,
  // Driver documents (v2.1) — base64 photo uploads (client-downscaled to
  // <=1.5 MB, JPG/PNG only). Full data URL is visible ONLY to admins;
  // the owning driver sees metadata (type/status) only. One row per
  // (driver_id, doc_type).
  `CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    doc_type TEXT NOT NULL,
    data_url TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_driver_type ON documents(driver_id, doc_type)`,
  // Passengers — rider profile extras (Phase 2 fills this in).
  `CREATE TABLE IF NOT EXISTS passengers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    home_address TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  // Call signals (v2.3, WebRTC signalling — the server only stores +
  // relays them between the matched rider and driver; no media flows here).
  `CREATE TABLE IF NOT EXISTS call_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ride_id INTEGER NOT NULL REFERENCES rides(id),
    sender_id INTEGER NOT NULL,
    sender_role TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_call_signals_ride ON call_signals(ride_id, id)`,
  // Web push subscriptions (v2.3, VAPID — free, no Firebase).
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL DEFAULT '',
    auth TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)`,
  // Client error reports (v2.3) — the app posts JS errors here for the owner.
  `CREATE TABLE IF NOT EXISTS client_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    message TEXT NOT NULL DEFAULT '',
    stack TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors(created_at)`,
  // Pilot whitelist (Phase 3, v2.2) — the ONLY phones allowed to sign up
  // while pilot_mode is ON. status: 'pending' (invited, not signed up yet)
  // | 'approved' (account created) | 'revoked' (removed by the owner).
  // One row per (phone, role); caps are enforced in the API layer.
  `CREATE TABLE IF NOT EXISTS pilot_whitelist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'rider',
    status TEXT NOT NULL DEFAULT 'pending',
    added_by INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_whitelist_phone_role ON pilot_whitelist(phone, role)`,
  `CREATE INDEX IF NOT EXISTS idx_whitelist_role_status ON pilot_whitelist(role, status)`,
  // Google sign-in (v2.5, free OAuth 2.0). Short-lived rows only — every
  // token/state is single-use and expires after 10 minutes; stale rows are
  // pruned whenever a new one is created.
  `CREATE TABLE IF NOT EXISTS google_auth_states (
    state TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'rider',
    source TEXT NOT NULL DEFAULT 'web',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS google_pending (
    token TEXT PRIMARY KEY,
    google_id TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'rider',
    source TEXT NOT NULL DEFAULT 'web',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS google_login_tokens (
    token TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'rider',
    created_at INTEGER NOT NULL
  )`,
];

// Additive column migrations — safe to re-run on every boot (idempotent).
const COLUMN_MIGRATIONS = [
  ["users", "password_hash TEXT NOT NULL DEFAULT ''"],
  ["users", "google_id TEXT NOT NULL DEFAULT ''"],
  ["users", "google_email TEXT NOT NULL DEFAULT ''"],
  ["users", "phone_verified INTEGER NOT NULL DEFAULT 0"],
  ["users", "status TEXT NOT NULL DEFAULT 'active'"],
  ["users", "updated_at INTEGER"],
  ["drivers", "documents_status TEXT NOT NULL DEFAULT 'pending'"],
  ["drivers", "loc_updated_at INTEGER"],
  ["rides", "scheduled_for INTEGER"],
  ["rides", "tip_amount INTEGER NOT NULL DEFAULT 0"],
  ["rides", "promo_code TEXT NOT NULL DEFAULT ''"],
  ["rides", "discount_amount INTEGER NOT NULL DEFAULT 0"],
  ["rides", "cancel_reason TEXT NOT NULL DEFAULT ''"],
  ["rides", "pickup_lat REAL"],
  ["rides", "pickup_lng REAL"],
  ["offers", "expires_at INTEGER"],
  ["documents", "expires_at INTEGER"],
  ["ride_messages", "read_at INTEGER"],
];

// Offer TTL (v2.3): an offer lives 4 minutes; after that it expires and can
// no longer be accepted or declined. Overridable via OFFER_TTL_MS (ms) for
// tests only — production always uses the 4-minute default.
export const OFFER_TTL_MS = Number(process.env.OFFER_TTL_MS || 4 * 60 * 1000);
// Scheduled-ride reminder window (v2.3): remind when the ride is due
// within the next 30 minutes. Call-signal retention (v2.3): 10 minutes.
export const SCHEDULED_REMINDER_WINDOW_MS = 30 * 60 * 1000;
export const CALL_SIGNAL_TTL_MS = 10 * 60 * 1000;
// Average in-town speed used for the pickup ETA (v2.3).
export const PICKUP_SPEED_KMH = 25;

export function haversineKm(a, b) {
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

// Lazy offer expiry (v2.3): pending offers past their expires_at become
// 'expired'. Legacy rows without expires_at expire TTL after created_at.
export async function expireStaleOffers(txOrClient, rideId = null) {
  const nowMs = Date.now();
  const args = [nowMs, nowMs - OFFER_TTL_MS];
  let sql = `UPDATE offers SET status='expired' WHERE status='pending' AND ((expires_at IS NOT NULL AND expires_at < ?) OR (expires_at IS NULL AND created_at < ?))`;
  if (rideId != null) { sql += " AND ride_id = ?"; args.push(rideId); }
  try { await txOrClient.execute({ sql, args }); } catch (e) { console.warn("[chunian-ride] expireStaleOffers failed:", e.message); }
}

// Real pickup distance (v2.3): haversine from the driver's last known GPS
// fix to the ride's pickup point. Pickup coords come from the ride's own
// GPS (pickup_lat/lng) when the rider sent them, else the PLACES table.
// estimated=false ONLY when both ends are real GPS: the driver has posted
// a live fix (loc_updated_at set) AND the ride carries GPS pickup coords.
// Otherwise the distance is an estimate (registration-default driver
// position, or a named-place pickup pin). With no driver position at all,
// fall back to the place-table distance from Chunian City.
export function computePickupDistance(driverRow, ride) {
  let plat = null, plng = null, fromGps = false;
  // NOTE: Number(null) === 0, so null coords must be excluded explicitly —
  // otherwise a ride without GPS silently computes from (0, 0).
  if (ride && ride.pickup_lat != null && ride.pickup_lng != null && Number.isFinite(Number(ride.pickup_lat)) && Number.isFinite(Number(ride.pickup_lng))) {
    plat = Number(ride.pickup_lat); plng = Number(ride.pickup_lng); fromGps = true;
  } else if (ride) {
    const place = PLACES.find((p) => p.name === ride.pickup);
    if (place) { plat = place.lat; plng = place.lng; }
  }
  if (plat == null || plng == null) {
    return { pickup_distance_km: null, pickup_distance_estimated: true, pickup_eta_min: null };
  }
  const hasFix = !!driverRow && Number.isFinite(Number(driverRow.lat)) && Number.isFinite(Number(driverRow.lng));
  const liveFix = hasFix && driverRow.loc_updated_at != null;
  let km;
  if (hasFix) {
    km = haversineKm({ lat: Number(driverRow.lat), lng: Number(driverRow.lng) }, { lat: plat, lng: plng });
  } else {
    const d = distanceBetween("Chunian City", ride.pickup);
    if (d.km == null) return { pickup_distance_km: null, pickup_distance_estimated: true, pickup_eta_min: null };
    km = d.km;
  }
  km = Math.round(km * 100) / 100;
  return {
    pickup_distance_km: km,
    pickup_distance_estimated: !(liveFix && fromGps),
    pickup_eta_min: Math.max(1, Math.round((km / PICKUP_SPEED_KMH) * 60)),
  };
}

export async function getSettings() {
  const res = await client.execute("SELECT key, value FROM settings");
  const out = { ...DEFAULT_SETTINGS };
  for (const row of res.rows) {
    // NEVER leak secrets: /api/settings is public. The admin setup-token
    // hash and the VAPID private key are both filtered here.
    if (row.key === "admin_setup_token_hash" || row.key === "vapid_private_key") continue;
    out[row.key] = row.value;
  }
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
export async function adjustWallet(txOrClient, userId, delta, { type, method = "", tid = "", note = "", rideId = null, reference = "" }) {
  await ensureWallet(txOrClient, userId);
  await txOrClient.execute({
    sql: "UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ?",
    args: [delta, Date.now(), userId],
  });
  await txOrClient.execute({
    sql: "INSERT INTO transactions(user_id, type, amount, method, tid, reference, note, related_ride_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [userId, type, delta, method, tid, reference, note, rideId, Date.now()],
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
    notify(tx, { userId: Number(req.driver_id), role: "user", type: "topup_approved", params: { amount: Number(req.amount), tid: req.tid || "" } });
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
    notify(tx, { userId: Number(req.driver_id), role: "user", type: "topup_rejected", params: { amount: Number(req.amount), reason: reason || "" } });
    return { driver_id: Number(req.driver_id), amount: Number(req.amount) };
  });
}

// ---- Notifications (v2.1, in-app feed — no push) ----
// Insert one notification row. NEVER throws: a failed notification must
// never roll back the money/ride operation running in the same transaction.
// v2.3: after the insert, a web push is attempted for user-role
// notifications — fire-and-forget, never awaited, never throwing.
export async function notify(txOrClient, { userId, role = "user", type, params = {}, rideId = null }) {
  try {
    await txOrClient.execute({
      sql: "INSERT INTO notifications(user_id, role, type, params, ride_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
      args: [Number(userId), role, type, JSON.stringify(params || {}), rideId, Date.now()],
    });
  } catch (e) {
    console.warn("[chunian-ride] notification insert failed:", e.message);
    return;
  }
  if (role === "user") {
    void sendPushToUser(Number(userId), type, params, rideId).catch(() => {});
  }
}

// ---- Web Push (v2.3, free — VAPID, no Firebase) ----
// VAPID keys are generated ONCE at first boot and persisted in settings.
// The private key is NEVER returned by /api/settings (filtered in
// getSettings, same as admin_setup_token_hash). Subject is a placeholder
// (no real owner email exists for this); it only identifies the sender to
// the push service.
export const VAPID_SUBJECT = "mailto:owner@chunian-ride.local";
let vapidKeysCache = null; // { publicKey, privateKey }
let vapidConfigured = false;

export async function ensureVapidKeys() {
  try {
    const res = await client.execute({ sql: "SELECT key, value FROM settings WHERE key IN ('vapid_public_key', 'vapid_private_key')" });
    const map = {};
    for (const row of res.rows) map[row.key] = row.value;
    if (map.vapid_public_key && map.vapid_private_key) {
      vapidKeysCache = { publicKey: map.vapid_public_key, privateKey: map.vapid_private_key };
    } else {
      if (!webpush) { console.warn("[chunian-ride] web-push package missing — web push disabled"); return null; }
      const keys = webpush.generateVAPIDKeys();
      await client.execute({ sql: "INSERT INTO settings(key, value) VALUES ('vapid_public_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [keys.publicKey] });
      await client.execute({ sql: "INSERT INTO settings(key, value) VALUES ('vapid_private_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [keys.privateKey] });
      vapidKeysCache = { publicKey: keys.publicKey, privateKey: keys.privateKey };
      console.log("[chunian-ride] VAPID keys generated and stored in settings");
    }
    if (webpush && !vapidConfigured) {
      webpush.setVapidDetails(VAPID_SUBJECT, vapidKeysCache.publicKey, vapidKeysCache.privateKey);
      vapidConfigured = true;
    }
    return vapidKeysCache.publicKey;
  } catch (e) {
    console.warn("[chunian-ride] VAPID setup failed (push disabled):", e.message);
    return null;
  }
}

export async function getVapidPublicKey() {
  if (vapidKeysCache) return vapidKeysCache.publicKey;
  return ensureVapidKeys();
}

// Server-side push text (EN) — mirrors public/shared.js NOTIF_TEMPLATES
// (the client renders localized text for the in-app feed; the push payload
// carries the EN rendering). New v2.3 types are at the end.
const NOTIF_PUSH_TEXT = {
  offer_received: { title: "New offer on Ride #{ride}", body: "{driver} offered Rs {fare}." },
  ride_accepted: { title: "Ride #{ride} accepted", body: "Agreed fare Rs {fare} — go to the pickup." },
  ride_started: { title: "Your trip has started", body: "Ride #{ride} is on the way." },
  ride_completed: { title: "Ride complete", body: "Thank you! Ride #{ride} is complete — fare Rs {fare}." },
  trip_completed: { title: "Trip complete", body: "Ride #{ride} complete — fare Rs {fare}, you kept Rs {kept}." },
  tip_received: { title: "Tip received", body: "Tip Rs {tip} on Ride #{ride} — 100% yours, no commission." },
  topup_approved: { title: "Top-up approved", body: "Rs {amount} added to your wallet (TID {tid})." },
  topup_rejected: { title: "Top-up rejected", body: "Rs {amount} was not credited. {reason}" },
  topup_requested: { title: "New top-up request", body: "{name} requested Rs {amount} ({method}, TID {tid})." },
  driver_approved: { title: "Driver account approved", body: "You can go online now and take rides." },
  driver_blocked: { title: "Driver account blocked", body: "Your driver account was blocked. Contact the owner." },
  withdrawal_requested: { title: "New withdrawal request", body: "{name} requested Rs {amount} to JazzCash {number}." },
  withdrawal_approved: { title: "Withdrawal approved", body: "Rs {amount} will be paid to your JazzCash {number}." },
  withdrawal_rejected: { title: "Withdrawal rejected", body: "Rs {amount} refunded to your wallet. {reason}" },
  complaint_resolved: { title: "Complaint resolved", body: "Your complaint #{id} has been resolved." },
  scheduled_booked: { title: "Scheduled ride booked", body: "Ride #{ride} booked for {when}." },
  scheduled_request: { title: "Scheduled ride request", body: "Ride #{ride} — {pickup} → {destination} on {when}." },
  refund_credited: { title: "Refund credited", body: "Rs {amount} refunded to your wallet. {reason}" },
  doc_approved: { title: "Document approved", body: "Your {doc} was approved." },
  doc_rejected: { title: "Document rejected", body: "Your {doc} was rejected. Please re-upload." },
  sos_alert: { title: "SOS ALERT — Ride #{ride}", body: "Emergency! {message}" },
  new_ride_request: { title: "New ride request", body: "Ride #{ride_id} — {pickup} → {destination} ({vehicle_type}), Rs {proposed_fare}." },
  scheduled_ride_reminder: { title: "Ride in 30 minutes", body: "Your scheduled ride #{ride} — {pickup} → {destination} — is coming up in 30 minutes." },
};

function renderPushText(type, params) {
  const tpl = NOTIF_PUSH_TEXT[type] || { title: "Chunian Ride", body: "You have a new notification." };
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => (params && params[k] != null ? String(params[k]) : ""));
  return { title: fill(tpl.title), body: fill(tpl.body) };
}

// Best-effort web push to one user's subscriptions. Never throws. A 404/410
// from the push service means the subscription is dead — delete it.
export async function sendPushToUser(userId, type, params = {}, rideId = null) {
  try {
    if (!webpush) return;
    if (!vapidKeysCache) await ensureVapidKeys();
    if (!vapidKeysCache) return;
    const subs = await client.execute({ sql: "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?", args: [Number(userId)] });
    if (!subs.rows.length) return;
    const { title, body } = renderPushText(type, params);
    const payload = JSON.stringify({ title, body, type, ride_id: rideId, url: "/driver" });
    for (const s of subs.rows) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await client.execute({ sql: "DELETE FROM push_subscriptions WHERE endpoint = ?", args: [s.endpoint] });
        } else {
          console.warn("[chunian-ride] web push failed:", e && e.message ? e.message : e);
        }
      }
    }
  } catch (e) {
    console.warn("[chunian-ride] web push failed:", e.message);
  }
}

// ---- Scheduled-ride reminders (v2.3) ----
// For rides with scheduled_for in the next 30 minutes and status
// 'requested', notify the rider once (dedupe: an existing
// 'scheduled_ride_reminder' notification for that ride) and the assigned
// driver too, if one is assigned. Never throws — the 5-minute interval
// and the lazy ride-read trigger both call this guarded.
export async function runScheduledReminders() {
  try {
    const nowMs = Date.now();
    const rows = await client.execute({
      sql: "SELECT * FROM rides WHERE status = 'requested' AND scheduled_for IS NOT NULL AND scheduled_for > ? AND scheduled_for <= ?",
      args: [nowMs, nowMs + SCHEDULED_REMINDER_WINDOW_MS],
    });
    for (const ride of rows.rows) {
      const params = { ride: ride.id, pickup: ride.pickup, destination: ride.destination, scheduled_for: ride.scheduled_for };
      const remind = async (userId) => {
        const ex = await client.execute({
          sql: "SELECT 1 AS x FROM notifications WHERE user_id = ? AND role = 'user' AND type = 'scheduled_ride_reminder' AND ride_id = ? LIMIT 1",
          args: [Number(userId), ride.id],
        });
        if (!ex.rows.length) {
          await notify(client, { userId: Number(userId), role: "user", type: "scheduled_ride_reminder", params, rideId: ride.id });
        }
      };
      await remind(ride.rider_id);
      if (ride.driver_id) await remind(ride.driver_id);
    }
  } catch (e) {
    console.warn("[chunian-ride] scheduled-reminder sweep failed:", e.message);
  }
}

// One notification row per admin account (owner sees every request).
export async function notifyAdmins(txOrClient, { type, params = {}, rideId = null }) {
  try {
    const admins = await txOrClient.execute("SELECT id FROM admins");
    for (const a of admins.rows) {
      await notify(txOrClient, { userId: Number(a.id), role: "admin", type, params, rideId });
    }
  } catch (e) {
    console.warn("[chunian-ride] notifyAdmins failed:", e.message);
  }
}

// ---- Promo validation + discount math (v2.1) ----
// Throws a fixed-string Error when the code cannot be used (so the client
// can translate it via ERR_MAP). Returns the promo row when valid.
export async function validatePromo(txOrClient, code) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) throw new Error("promo code is required");
  const r = await txOrClient.execute({ sql: "SELECT * FROM promo_codes WHERE code = ?", args: [clean] });
  if (!r.rows.length) throw new Error("promo code not found");
  const p = r.rows[0];
  if (!Number(p.active)) throw new Error("promo code is not active");
  const nowMs = Date.now();
  if (p.valid_from && nowMs < Number(p.valid_from)) throw new Error("promo code is not valid yet");
  if (p.valid_to && nowMs > Number(p.valid_to)) throw new Error("promo code has expired");
  if (Number(p.max_uses) > 0 && Number(p.uses) >= Number(p.max_uses)) throw new Error("promo code has reached its maximum uses");
  return p;
}

// Discount amount in Rs for a base fare. Percent rounds to the nearest rupee;
// fixed is capped so the final fare never drops below Rs 1.
export function promoDiscount(baseFare, promo) {
  const base = Math.max(1, Math.round(Number(baseFare) || 0));
  if (promo.discount_type === "fixed") return Math.min(Number(promo.discount_value), base - 1);
  return Math.min(base - 1, Math.round((base * Number(promo.discount_value)) / 100));
}

// ---- Pilot launch (Phase 3, v2.2) ----
// Chunian-only lock: while pilot mode is ON, rides may only run inside
// Chunian City. Pickup may be "Chunian City" or the rider's phone GPS
// ("Current location" — the pilot group is in Chunian by definition, and
// the driver sees the rider's live GPS pin before accepting). Destination
// must be Chunian City — every intercity place is rejected.
export const PILOT_ALLOWED_PLACES = ["Chunian City"];
export const PILOT_ALLOWED_PICKUPS = ["Chunian City", "Current location"];

export function pilotLocked(settings) {
  return String(settings.pilot_mode) === "1" || String(settings.pilot_chunian_only) === "1";
}

// Returns the (Roman Urdu) error string when a pickup/destination pair is
// outside the pilot area, or null when it is allowed.
export function pilotAreaError(settings, pickup, destination) {
  if (!pilotLocked(settings)) return null;
  if (pickup && !PILOT_ALLOWED_PICKUPS.includes(String(pickup))) {
    return "Pilot phase: sirf Chunian City ki rides — intercity rides abhi band hain";
  }
  if (destination && !PILOT_ALLOWED_PLACES.includes(String(destination))) {
    return "Pilot phase: sirf Chunian City ki rides — intercity rides abhi band hain";
  }
  return null;
}

export function pilotCap(role, settings) {
  return role === "driver"
    ? Math.max(0, Number(settings.pilot_max_drivers || 10))
    : Math.max(0, Number(settings.pilot_max_riders || 20));
}

// ---- Driver document verification gate (Phase 3, v2.2) ----
// Required documents are exactly three: CNIC, driving licence, vehicle
// registration. CNIC is satisfied by a single "cnic" photo OR by BOTH
// "cnic_front" and "cnic_back" (legacy two-photo flow). "other" uploads
// never count toward the gate. Returns per-doc booleans + missing list.
export async function getDocChecklist(txOrClient, driverUserId) {
  const nowMs = Date.now();
  const rows = await txOrClient.execute({
    sql: "SELECT doc_type, status, expires_at FROM documents WHERE driver_id = ?",
    args: [Number(driverUserId)],
  });
  // A document counts as approved only while its approval is live: an
  // approved document whose expires_at has passed no longer counts toward
  // the gate (v2.3), so the driver is blocked from going online until
  // they re-upload.
  const approved = new Set(
    rows.rows.filter((r) => r.status === "approved" && (r.expires_at == null || Number(r.expires_at) > nowMs)).map((r) => r.doc_type)
  );
  const byType = {};
  for (const r of rows.rows) byType[r.doc_type] = r.status;
  const expired = [...new Set(rows.rows.filter((r) => r.status === "approved" && r.expires_at != null && Number(r.expires_at) <= nowMs).map((r) => r.doc_type))];
  const expiresSoon = [...new Set(rows.rows.filter((r) => r.status === "approved" && r.expires_at != null && Number(r.expires_at) > nowMs && Number(r.expires_at) <= nowMs + 30 * 86400000).map((r) => r.doc_type))];
  const cnic = approved.has("cnic") || (approved.has("cnic_front") && approved.has("cnic_back"));
  const licence = approved.has("licence");
  const vehicle = approved.has("vehicle");
  const missing = [];
  if (!cnic) missing.push("CNIC");
  if (!licence) missing.push("licence");
  if (!vehicle) missing.push("vehicle");
  return { cnic, licence, vehicle, all: missing.length === 0, missing, byType, expired, expires_soon: expiresSoon };
}

// ---- Withdrawals (v2.1) ----
// Approve a pending withdrawal: status guard + audit + driver notification,
// all in ONE transaction. The hold stays deducted — the owner pays the
// driver manually on JazzCash outside the app (no gateway). Throws if the
// request does not exist or is not pending (no double-pay).
export async function approveWithdrawal(requestId, adminId) {
  return withTx(async (tx) => {
    const cur = await tx.execute({ sql: "SELECT * FROM withdrawals WHERE id = ?", args: [requestId] });
    if (!cur.rows.length) throw new Error("withdrawal request not found");
    const req = cur.rows[0];
    if (req.status !== "pending") throw new Error("withdrawal request already reviewed");
    await tx.execute({
      sql: "UPDATE withdrawals SET status='approved', reviewed_by=?, reviewed_at=? WHERE id=? AND status='pending'",
      args: [adminId, Date.now(), requestId],
    });
    await writeAudit(tx, {
      actorId: adminId, actorRole: "admin", action: "withdrawal_approve",
      targetType: "withdrawal", targetId: requestId,
      detail: `Approved withdrawal Rs ${req.amount} to JazzCash ${req.jazzcash_number} for driver user #${req.driver_id} (owner pays manually)`,
    });
    notify(tx, { userId: Number(req.driver_id), role: "user", type: "withdrawal_approved", params: { amount: Number(req.amount), number: req.jazzcash_number || "" } });
    const bal = await tx.execute({ sql: "SELECT balance FROM wallets WHERE user_id = ?", args: [Number(req.driver_id)] });
    return { driver_id: Number(req.driver_id), amount: Number(req.amount), wallet_balance: bal.rows.length ? Number(bal.rows[0].balance) : 0 };
  });
}

// Reject a pending withdrawal: status guard + AUTO-REFUND of the hold back
// to the driver's wallet (+ ledger row) + audit + notification, in ONE
// transaction. Throws if not pending (no double-refund).
export async function rejectWithdrawal(requestId, adminId, reason = "") {
  return withTx(async (tx) => {
    const cur = await tx.execute({ sql: "SELECT * FROM withdrawals WHERE id = ?", args: [requestId] });
    if (!cur.rows.length) throw new Error("withdrawal request not found");
    const req = cur.rows[0];
    if (req.status !== "pending") throw new Error("withdrawal request already reviewed");
    await tx.execute({
      sql: "UPDATE withdrawals SET status='rejected', reviewed_by=?, reviewed_at=?, reason=? WHERE id=? AND status='pending'",
      args: [adminId, Date.now(), reason, requestId],
    });
    const balance = await adjustWallet(tx, Number(req.driver_id), Number(req.amount), {
      type: "withdrawal_refund",
      method: "JazzCash",
      note: `Withdrawal #${requestId} rejected — hold refunded (Rs ${req.amount})`,
    });
    await writeAudit(tx, {
      actorId: adminId, actorRole: "admin", action: "withdrawal_reject",
      targetType: "withdrawal", targetId: requestId,
      detail: `Rejected withdrawal Rs ${req.amount} for driver user #${req.driver_id}; hold refunded. Reason: ${reason || "—"}`,
    });
    notify(tx, { userId: Number(req.driver_id), role: "user", type: "withdrawal_rejected", params: { amount: Number(req.amount), reason: reason || "" } });
    return { driver_id: Number(req.driver_id), amount: Number(req.amount), wallet_balance: balance };
  });
}

// ---- Admin refunds (v2.1) ----
// Owner-initiated wallet credit (e.g. wrongly charged commission, cancelled
// ride). Transactional: credit + ledger + audit + notification. The optional
// idempotency key makes a double-click / retry safe: a second call with the
// same key returns {duplicate: true} and credits NOTHING.
export async function createRefund(adminId, { userId, amount, reason = "", idempotencyKey = null }) {
  return withTx(async (tx) => {
    const u = await tx.execute({ sql: "SELECT id FROM users WHERE id = ?", args: [userId] });
    if (!u.rows.length) throw new Error("user not found");
    if (idempotencyKey) {
      const dup = await tx.execute({ sql: "SELECT id FROM transactions WHERE reference = ? LIMIT 1", args: [idempotencyKey] });
      if (dup.rows.length) {
        const bal = await tx.execute({ sql: "SELECT balance FROM wallets WHERE user_id = ?", args: [userId] });
        return { user_id: userId, amount, wallet_balance: bal.rows.length ? Number(bal.rows[0].balance) : 0, duplicate: true };
      }
    }
    const balance = await adjustWallet(tx, userId, amount, {
      type: "refund",
      note: `Refund by admin: ${reason || "—"}`,
      reference: idempotencyKey || "",
    });
    await writeAudit(tx, {
      actorId: adminId, actorRole: "admin", action: "refund_credit",
      targetType: "user", targetId: userId,
      detail: `Refund Rs ${amount} to user #${userId}. Reason: ${reason || "—"}`,
    });
    notify(tx, { userId, role: "user", type: "refund_credited", params: { amount, reason: reason || "" } });
    return { user_id: userId, amount, wallet_balance: balance, duplicate: false };
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
      { name: "Ali Raza", phone: "03010000005", vehicle: "ac_car", model: "Toyota Corolla GLi", plate: "DEMO-ACC-01", wallet: 2000 },
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
