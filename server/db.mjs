// Chunian Ride — database layer.
// Uses @libsql/client so the same SQLite schema runs locally (file: URL)
// and in production on Turso (libsql:// URL + auth token) if configured.
// Default (no env vars): local SQLite file ./data/chunian-ride.db
// NOTE: on Render's free tier the local disk is ephemeral — data resets on
// redeploy/restart. Acceptable for v1 testing only; set TURSO_DATABASE_URL
// + TURSO_AUTH_TOKEN in Render for persistent data.
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
    lat REAL, lng REAL,
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

export async function initDb() {
  for (const s of STATEMENTS) await client.execute(s);
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await client.execute({
      sql: "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
      args: [k, v],
    });
  }
  // Seed once.
  const count = await client.execute("SELECT COUNT(*) AS n FROM users");
  if (Number(count.rows[0].n) > 0) return;
  const now = Date.now();
  const demoDrivers = [
    { name: "Ahmed Raza", phone: "0301-0000001", vehicle: "bike", model: "Honda CD 70", plate: "DEMO-BIKE-01", wallet: 2000 },
    { name: "Bilal Hussain", phone: "0301-0000002", vehicle: "rickshaw", model: "Tez Raftar Rickshaw", plate: "DEMO-RIK-01", wallet: 2000 },
    { name: "Usman Ghani", phone: "0301-0000003", vehicle: "car", model: "Toyota Corolla", plate: "DEMO-CAR-01", wallet: 2000 },
    { name: "Hassan Ali", phone: "0301-0000004", vehicle: "car", model: "Suzuki Alto", plate: "DEMO-CAR-02", wallet: 2000 },
  ];
  const driverUserIds = {};
  for (const d of demoDrivers) {
    const u = await client.execute({
      sql: "INSERT INTO users(name, phone, role, rating, rating_count, demo, created_at) VALUES (?, ?, 'driver', 4.8, 12, 1, ?)",
      args: [d.name, d.phone, now],
    });
    const userId = Number(u.lastInsertRowid);
    driverUserIds[d.name] = userId;
    await client.execute({
      sql: "INSERT INTO drivers(user_id, vehicle_type, vehicle_model, plate, cnic, licence, vehicle_reg, status, online, wallet_balance, lat, lng, created_at) VALUES (?, ?, ?, ?, '35202-0000000-1 (demo)', 'LTV-DEMO (demo)', 'REG-DEMO (demo)', 'approved', 1, ?, 30.9667, 74.0333, ?)",
      args: [userId, d.vehicle, d.model, d.plate, d.wallet, now],
    });
    await client.execute({
      sql: "INSERT INTO wallet_tx(driver_id, type, amount, method, note, created_at) VALUES (?, 'topup', ?, 'JazzCash (demo)', 'Demo starting balance', ?)",
      args: [userId, d.wallet, now],
    });
  }
  const rider = await client.execute({
    sql: "INSERT INTO users(name, phone, role, rating, rating_count, demo, created_at) VALUES ('Demo Rider', '0300-0000000', 'rider', 5.0, 2, 1, ?)",
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
