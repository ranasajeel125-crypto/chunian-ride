// Chunian Ride — Express server: pages + JSON API.
// inDrive-style: rider proposes a fare, drivers offer/counter/decline freely,
// rider picks an offer, cash is paid to the driver, platform fee is deducted
// from the driver's prepaid wallet (commission % + booking fee).
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  client,
  initDb,
  getSettings,
  fareFor,
  platformTake,
  distanceBetween,
  PLACES,
  usingTurso,
} from "./db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

app.use(express.json());
app.use(express.static(path.join(root, "public")));

const now = () => Date.now();
const VEHICLES = ["bike", "rickshaw", "car"];

function isAdmin(req) {
  return req.headers["x-admin-pin"] === ADMIN_PIN;
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: "Admin PIN required" });
  next();
}
function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "chunian-ride", version: "1.0.0", db: usingTurso ? "turso" : "local-sqlite" });
});

app.get("/api/places", (req, res) => res.json({ places: PLACES }));

app.get("/api/settings", async (req, res) => {
  const s = await getSettings();
  res.json({ settings: s });
});

// ---- Fare estimate ----
app.post("/api/fare", async (req, res) => {
  const { pickup, destination, vehicle, distance_km } = req.body || {};
  if (!VEHICLES.includes(vehicle)) return res.status(400).json({ error: "vehicle must be bike, rickshaw or car" });
  let km = num(distance_km, 0);
  let estimated = false;
  if (!km) {
    const d = distanceBetween(pickup, destination);
    if (d.km == null) return res.status(400).json({ error: "distance unknown — enter km manually" });
    km = d.km;
    estimated = d.estimated;
  }
  const s = await getSettings();
  const suggested = fareFor(s, vehicle, km);
  res.json({ pickup, destination, vehicle, distance_km: km, distance_estimated: estimated, suggested_fare: suggested, per_km: Number(s[`rate_${vehicle}_per_km`]), min_fare: Number(s[`min_${vehicle}`]) });
});

// ---- Signup (phone + name, no OTP provider in v1) ----
app.post("/api/signup", async (req, res) => {
  const { name, phone, role } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: "name and phone are required" });
  const cleanPhone = String(phone).trim();
  const existing = await client.execute({ sql: "SELECT * FROM users WHERE phone = ?", args: [cleanPhone] });
  if (existing.rows.length) return res.json({ user: existing.rows[0], existing: true });
  const r = await client.execute({
    sql: "INSERT INTO users(name, phone, role, created_at) VALUES (?, ?, ?, ?)",
    args: [String(name).trim(), cleanPhone, role === "driver" ? "driver" : "rider", now()],
  });
  const user = (await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [Number(r.lastInsertRowid)] })).rows[0];
  res.json({ user });
});

// ---- Driver registration (CNIC / licence / vehicle registration; owner approves) ----
app.post("/api/drivers/register", async (req, res) => {
  const { user_id, vehicle_type, vehicle_model, plate, cnic, licence, vehicle_reg } = req.body || {};
  if (!user_id || !VEHICLES.includes(vehicle_type)) return res.status(400).json({ error: "user_id and a valid vehicle_type are required" });
  if (!cnic || !licence || !vehicle_reg) return res.status(400).json({ error: "CNIC, driving licence and vehicle registration are all required" });
  const u = await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [num(user_id)] });
  if (!u.rows.length) return res.status(404).json({ error: "user not found" });
  const existing = await client.execute({ sql: "SELECT * FROM drivers WHERE user_id = ?", args: [num(user_id)] });
  if (existing.rows.length) return res.status(400).json({ error: "driver profile already exists — wait for owner approval" });
  const r = await client.execute({
    sql: "INSERT INTO drivers(user_id, vehicle_type, vehicle_model, plate, cnic, licence, vehicle_reg, status, online, wallet_balance, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, 30.9667, 74.0333, ?)",
    args: [num(user_id), vehicle_type, vehicle_model || "", plate || "", cnic, licence, vehicle_reg, now()],
  });
  res.json({ driver_id: Number(r.lastInsertRowid), status: "pending", message: "Registration submitted. The owner will approve it." });
});

app.get("/api/drivers/:id", async (req, res) => {
  const d = await client.execute({
    sql: `SELECT d.*, u.name, u.phone, u.rating, u.rating_count, u.demo FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.user_id = ?`,
    args: [num(req.params.id)],
  });
  if (!d.rows.length) return res.status(404).json({ error: "driver not found" });
  res.json({ driver: d.rows[0] });
});

app.post("/api/drivers/:id/online", async (req, res) => {
  const { online, lat, lng } = req.body || {};
  const d = await client.execute({ sql: "SELECT * FROM drivers WHERE user_id = ?", args: [num(req.params.id)] });
  if (!d.rows.length) return res.status(404).json({ error: "driver not found" });
  if (d.rows[0].status !== "approved") return res.status(403).json({ error: "driver is not approved yet" });
  await client.execute({
    sql: "UPDATE drivers SET online = ?, lat = COALESCE(?, lat), lng = COALESCE(?, lng) WHERE user_id = ?",
    args: [online ? 1 : 0, lat != null ? num(lat) : null, lng != null ? num(lng) : null, num(req.params.id)],
  });
  res.json({ online: !!online });
});

// Driver live location — the driver app posts phone GPS while online.
app.post("/api/drivers/:id/location", async (req, res) => {
  const { lat, lng } = req.body || {};
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
    return res.status(400).json({ error: "valid lat/lng required" });
  }
  const d = await client.execute({ sql: "SELECT * FROM drivers WHERE user_id = ?", args: [num(req.params.id)] });
  if (!d.rows.length) return res.status(404).json({ error: "driver not found" });
  await client.execute({
    sql: "UPDATE drivers SET lat = ?, lng = ?, loc_updated_at = ? WHERE user_id = ?",
    args: [la, ln, now(), num(req.params.id)],
  });
  res.json({ ok: true });
});

// Driver sees open requests for their vehicle type, with rider rating, BEFORE accepting.
app.get("/api/drivers/:id/requests", async (req, res) => {
  const d = await client.execute({ sql: "SELECT * FROM drivers WHERE user_id = ?", args: [num(req.params.id)] });
  if (!d.rows.length) return res.status(404).json({ error: "driver not found" });
  const rows = await client.execute({
    sql: `SELECT r.*, u.name AS rider_name, u.phone AS rider_phone, u.rating AS rider_rating, u.rating_count AS rider_rating_count
          FROM rides r JOIN users u ON u.id = r.rider_id
          WHERE r.status = 'requested' AND r.vehicle_type = ?
          ORDER BY r.created_at DESC`,
    args: [d.rows[0].vehicle_type],
  });
  res.json({ requests: rows.rows });
});

// Driver wallet top-up (JazzCash / Sadapay / cash). Owner confirms the TID.
app.post("/api/drivers/:id/topup", async (req, res) => {
  const { amount, method, tid } = req.body || {};
  const amt = num(amount, 0);
  if (amt <= 0) return res.status(400).json({ error: "amount must be more than 0" });
  const d = await client.execute({ sql: "SELECT * FROM drivers WHERE user_id = ?", args: [num(req.params.id)] });
  if (!d.rows.length) return res.status(404).json({ error: "driver not found" });
  await client.execute({
    sql: "INSERT INTO wallet_tx(driver_id, type, amount, method, tid, note, created_at) VALUES (?, 'topup', ?, ?, ?, 'Wallet top-up', ?)",
    args: [num(req.params.id), amt, method || "JazzCash", tid || "", now()],
  });
  await client.execute({ sql: "UPDATE drivers SET wallet_balance = wallet_balance + ? WHERE user_id = ?", args: [amt, num(req.params.id)] });
  const bal = (await client.execute({ sql: "SELECT wallet_balance FROM drivers WHERE user_id = ?", args: [num(req.params.id)] })).rows[0];
  res.json({ wallet_balance: bal.wallet_balance });
});

app.get("/api/drivers/:id/wallet", async (req, res) => {
  const tx = await client.execute({
    sql: "SELECT * FROM wallet_tx WHERE driver_id = ? ORDER BY created_at DESC LIMIT 50",
    args: [num(req.params.id)],
  });
  const bal = await client.execute({ sql: "SELECT wallet_balance FROM drivers WHERE user_id = ?", args: [num(req.params.id)] });
  res.json({ wallet_balance: bal.rows.length ? bal.rows[0].wallet_balance : 0, transactions: tx.rows });
});

app.get("/api/drivers/:id/earnings", async (req, res) => {
  const days = num(req.query.days, 1);
  const since = now() - days * 86400000;
  const rows = await client.execute({
    sql: "SELECT COUNT(*) AS rides, COALESCE(SUM(agreed_fare),0) AS gross, COALESCE(SUM(commission_charged),0) AS fees, COALESCE(SUM(tip_amount),0) AS tips FROM rides WHERE driver_id = ? AND status = 'completed' AND completed_at >= ?",
    args: [num(req.params.id), since],
  });
  const r = rows.rows[0];
  // Tips go 100% to the driver — no commission on tips.
  res.json({ days, rides: Number(r.rides), gross_fares: Number(r.gross), platform_fees: Number(r.fees), tips: Number(r.tips), driver_kept: Number(r.gross) - Number(r.fees) + Number(r.tips) });
});

// ---- Rides ----
app.post("/api/rides", async (req, res) => {
  const { rider_id, pickup, destination, vehicle, proposed_fare, distance_km, scheduled_for } = req.body || {};
  if (!rider_id || !pickup || !destination || !VEHICLES.includes(vehicle)) {
    return res.status(400).json({ error: "rider_id, pickup, destination and vehicle are required" });
  }
  // Scheduled ride (book for later, inDrive-style): optional epoch ms.
  // Must be in the future and within the next 7 days.
  let sched = null;
  if (scheduled_for != null && scheduled_for !== "") {
    sched = num(scheduled_for, 0);
    if (!Number.isFinite(sched) || sched <= now()) return res.status(400).json({ error: "scheduled time must be in the future" });
    if (sched > now() + 7 * 86400000) return res.status(400).json({ error: "you can only book up to 7 days ahead" });
  }
  let km = num(distance_km, 0);
  let estimated = false;
  if (!km) {
    const d = distanceBetween(pickup, destination);
    if (d.km == null) return res.status(400).json({ error: "distance unknown — enter km manually" });
    km = d.km;
    estimated = d.estimated;
  }
  const s = await getSettings();
  const suggested = fareFor(s, vehicle, km);
  const proposed = Math.max(1, num(proposed_fare, suggested));
  const r = await client.execute({
    sql: "INSERT INTO rides(rider_id, pickup, destination, distance_km, distance_estimated, vehicle_type, suggested_fare, proposed_fare, scheduled_for, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?)",
    args: [num(rider_id), pickup, destination, km, estimated ? 1 : 0, vehicle, suggested, proposed, sched, now()],
  });
  const rideId = Number(r.lastInsertRowid);
  // inDrive-style: every online, approved driver of this vehicle with a
  // non-negative wallet can see the request and make an offer. Seed offers
  // from them at the suggested fare (or the rider's proposal if higher).
  const drivers = await client.execute({
    sql: "SELECT d.user_id, u.name FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.status='approved' AND d.online=1 AND d.vehicle_type=? AND d.wallet_balance >= 0",
    args: [vehicle],
  });
  const offerFare = Math.max(suggested, proposed);
  for (const [i, drv] of drivers.rows.entries()) {
    await client.execute({
      sql: "INSERT INTO offers(ride_id, driver_id, fare, eta_min, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [rideId, drv.user_id, offerFare, 5 + i * 3, now()],
    });
  }
  res.json({ ride_id: rideId, suggested_fare: suggested, proposed_fare: proposed, scheduled_for: sched, distance_km: km, distance_estimated: estimated, offers_created: drivers.rows.length });
});

app.get("/api/rides/:id", async (req, res) => {
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) return res.status(404).json({ error: "ride not found" });
  const offers = await client.execute({
    sql: `SELECT o.*, u.name AS driver_name, u.rating AS driver_rating, u.rating_count AS driver_rating_count, d.vehicle_model, d.plate
          FROM offers o JOIN users u ON u.id = o.driver_id JOIN drivers d ON d.user_id = o.driver_id
          WHERE o.ride_id = ? ORDER BY o.fare ASC`,
    args: [num(req.params.id)],
  });
  // Driver live location for the rider's map (only when a driver is assigned).
  let driverLocation = null;
  if (ride.rows[0].driver_id) {
    const dl = await client.execute({ sql: "SELECT lat, lng, loc_updated_at FROM drivers WHERE user_id = ?", args: [num(ride.rows[0].driver_id)] });
    if (dl.rows.length) driverLocation = { lat: dl.rows[0].lat, lng: dl.rows[0].lng, updated_at: dl.rows[0].loc_updated_at };
  }
  res.json({ ride: ride.rows[0], offers: offers.rows, driver_location: driverLocation });
});

// ---- In-ride chat (text only, rider <-> driver of this ride; no phone numbers) ----
app.post("/api/rides/:id/messages", async (req, res) => {
  const { sender_id, sender_role, message } = req.body || {};
  const text = String(message || "").trim();
  if (!text || text.length > 500) return res.status(400).json({ error: "message must be 1-500 characters" });
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) return res.status(404).json({ error: "ride not found" });
  const r = ride.rows[0];
  const ok = (sender_role === "rider" && num(sender_id) === r.rider_id) || (sender_role === "driver" && num(sender_id) === r.driver_id);
  if (!ok) return res.status(403).json({ error: "only the rider or driver of this ride can chat here" });
  const ins = await client.execute({
    sql: "INSERT INTO ride_messages(ride_id, sender_role, sender_id, message, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [num(req.params.id), sender_role, num(sender_id), text, now()],
  });
  res.json({ message_id: Number(ins.lastInsertRowid) });
});
app.get("/api/rides/:id/messages", async (req, res) => {
  const userId = num(req.query.user_id, 0);
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) return res.status(404).json({ error: "ride not found" });
  const r = ride.rows[0];
  if (userId !== r.rider_id && userId !== r.driver_id) return res.status(403).json({ error: "only the rider or driver of this ride can read this chat" });
  const rows = await client.execute({
    sql: "SELECT id, sender_role, sender_id, message, created_at FROM ride_messages WHERE ride_id = ? ORDER BY created_at ASC LIMIT 50",
    args: [num(req.params.id)],
  });
  res.json({ messages: rows.rows });
});

app.get("/api/rides", async (req, res) => {
  const { rider_id, driver_id, status } = req.query;
  let sql = "SELECT r.*, u.name AS rider_name FROM rides r JOIN users u ON u.id = r.rider_id WHERE 1=1";
  const args = [];
  if (rider_id) { sql += " AND r.rider_id = ?"; args.push(num(rider_id)); }
  if (driver_id) { sql += " AND r.driver_id = ?"; args.push(num(driver_id)); }
  if (status) { sql += " AND r.status = ?"; args.push(status); }
  sql += " ORDER BY r.created_at DESC LIMIT 100";
  const rows = await client.execute({ sql, args });
  res.json({ rides: rows.rows });
});

// Rider picks one driver offer.
app.post("/api/rides/:id/offers/:offerId/accept", async (req, res) => {
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) return res.status(404).json({ error: "ride not found" });
  if (ride.rows[0].status !== "requested") return res.status(400).json({ error: "ride is no longer open" });
  const offer = await client.execute({
    sql: "SELECT * FROM offers WHERE id = ? AND ride_id = ? AND status = 'pending'",
    args: [num(req.params.offerId), num(req.params.id)],
  });
  if (!offer.rows.length) return res.status(404).json({ error: "offer not found or no longer pending" });
  const o = offer.rows[0];
  await client.execute({ sql: "UPDATE offers SET status='accepted' WHERE id = ?", args: [o.id] });
  await client.execute({ sql: "UPDATE offers SET status='declined' WHERE ride_id = ? AND id != ? AND status='pending'", args: [num(req.params.id), o.id] });
  await client.execute({
    sql: "UPDATE rides SET driver_id = ?, agreed_fare = ?, status = 'accepted' WHERE id = ?",
    args: [o.driver_id, o.fare, num(req.params.id)],
  });
  res.json({ ride_id: num(req.params.id), driver_id: o.driver_id, agreed_fare: o.fare });
});

// Driver sends a counter-offer.
app.post("/api/rides/:id/counter", async (req, res) => {
  const { driver_id, fare } = req.body || {};
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) return res.status(404).json({ error: "ride not found" });
  if (ride.rows[0].status !== "requested") return res.status(400).json({ error: "ride is no longer open" });
  const f = num(fare, 0);
  if (f <= 0) return res.status(400).json({ error: "fare must be more than 0" });
  const r = await client.execute({
    sql: "INSERT INTO offers(ride_id, driver_id, fare, eta_min, created_at) VALUES (?, ?, ?, 5, ?)",
    args: [num(req.params.id), num(driver_id), f, now()],
  });
  res.json({ offer_id: Number(r.lastInsertRowid), fare: f });
});

// Driver declines a request — no penalty, ever.
app.post("/api/rides/:id/decline", async (req, res) => {
  const { driver_id } = req.body || {};
  await client.execute({
    sql: "UPDATE offers SET status='declined' WHERE ride_id = ? AND driver_id = ? AND status='pending'",
    args: [num(req.params.id), num(driver_id)],
  });
  res.json({ declined: true, penalty: 0 });
});

app.post("/api/rides/:id/start", async (req, res) => {
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) return res.status(404).json({ error: "ride not found" });
  if (ride.rows[0].status !== "accepted") return res.status(400).json({ error: "ride must be accepted before it can start" });
  await client.execute({ sql: "UPDATE rides SET status='ongoing' WHERE id = ?", args: [num(req.params.id)] });
  res.json({ status: "ongoing" });
});

// Trip end — only after confirming cash was received from the rider.
app.post("/api/rides/:id/complete", async (req, res) => {
  const { cash_received } = req.body || {};
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) return res.status(404).json({ error: "ride not found" });
  if (ride.rows[0].status !== "ongoing") return res.status(400).json({ error: "ride must be ongoing before it can be completed" });
  if (!cash_received) return res.status(400).json({ error: "Confirm cash received from the rider first — a trip cannot be completed without it" });
  const s = await getSettings();
  const fare = ride.rows[0].agreed_fare || ride.rows[0].suggested_fare;
  const take = platformTake(s, fare);
  await client.execute({
    sql: "UPDATE rides SET status='completed', cash_confirmed=1, commission_charged=?, completed_at=? WHERE id = ?",
    args: [take, now(), num(req.params.id)],
  });
  const driverId = ride.rows[0].driver_id;
  await client.execute({
    sql: "INSERT INTO wallet_tx(driver_id, type, amount, method, note, created_at) VALUES (?, 'commission', ?, 'auto', ?, ?)",
    args: [driverId, -take, `Ride ${req.params.id}: commission ${s.commission_pct}% + booking fee Rs ${s.booking_fee}`, now()],
  });
  await client.execute({ sql: "UPDATE drivers SET wallet_balance = wallet_balance - ? WHERE user_id = ?", args: [take, driverId] });
  const bal = (await client.execute({ sql: "SELECT wallet_balance FROM drivers WHERE user_id = ?", args: [driverId] })).rows[0];
  res.json({
    status: "completed",
    fare,
    commission_pct: Number(s.commission_pct),
    booking_fee: Number(s.booking_fee),
    platform_take: take,
    driver_kept: fare - take,
    driver_wallet_balance: bal.wallet_balance,
  });
});

app.post("/api/rides/:id/cancel", async (req, res) => {
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) return res.status(404).json({ error: "ride not found" });
  if (ride.rows[0].status === "completed") return res.status(400).json({ error: "completed ride cannot be cancelled" });
  await client.execute({ sql: "UPDATE rides SET status='cancelled' WHERE id = ?", args: [num(req.params.id)] });
  res.json({ status: "cancelled" });
});

// Tip after a completed ride — goes 100% to the driver, NO commission on tips.
// Only the ride's own rider can tip, only once, only after completion.
app.post("/api/rides/:id/tip", async (req, res) => {
  const { rider_id, amount } = req.body || {};
  const tip = Math.round(num(amount, 0));
  if (tip <= 0) return res.status(400).json({ error: "tip must be more than 0" });
  if (tip > 5000) return res.status(400).json({ error: "tip cannot be more than Rs 5000" });
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) return res.status(404).json({ error: "ride not found" });
  const r = ride.rows[0];
  if (r.status !== "completed") return res.status(400).json({ error: "tip can only be added after the ride is completed" });
  if (num(rider_id) !== r.rider_id) return res.status(403).json({ error: "only the rider of this ride can add a tip" });
  if (Number(r.tip_amount || 0) > 0) return res.status(400).json({ error: "tip already added for this ride" });
  // Tip is cash, paid rider -> driver directly (like the fare itself):
  // it is recorded on the ride and shown in earnings/receipts, but it is
  // NOT added to the prepaid wallet balance (that balance is only money
  // the driver deposited for commission). 100% driver, 0% commission.
  await client.execute({
    sql: "UPDATE rides SET tip_amount = ? WHERE id = ?",
    args: [tip, num(req.params.id)],
  });
  res.json({ ride_id: num(req.params.id), tip, commission_on_tip: 0, note: "Tip 100% driver ko — is par koi commission nahi." });
});

// Rate driver (by rider) or rate rider (by driver).
app.post("/api/rides/:id/rate", async (req, res) => {
  const { by, stars } = req.body || {};
  const s = Math.max(1, Math.min(5, num(stars, 5)));
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) return res.status(404).json({ error: "ride not found" });
  const r = ride.rows[0];
  if (by === "rider" && r.driver_id) {
    await client.execute({ sql: "UPDATE rides SET rating_driver = ? WHERE id = ?", args: [s, num(req.params.id)] });
    await client.execute({
      sql: "UPDATE users SET rating = ((rating * rating_count) + ?) / (rating_count + 1), rating_count = rating_count + 1 WHERE id = ?",
      args: [s, r.driver_id],
    });
  } else if (by === "driver") {
    await client.execute({ sql: "UPDATE rides SET rating_rider = ? WHERE id = ?", args: [s, num(req.params.id)] });
    await client.execute({
      sql: "UPDATE users SET rating = ((rating * rating_count) + ?) / (rating_count + 1), rating_count = rating_count + 1 WHERE id = ?",
      args: [s, r.rider_id],
    });
  } else {
    return res.status(400).json({ error: "by must be 'rider' or 'driver'" });
  }
  res.json({ rated: true, stars: s });
});

// Share trip — returns copyable text + link.
app.get("/api/rides/:id/share", async (req, res) => {
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) return res.status(404).json({ error: "ride not found" });
  const r = ride.rows[0];
  const base = `${req.protocol}://${req.get("host")}`;
  const url = `${base}/?ride=${r.id}`;
  const text = `Chunian Ride — ${r.pickup} se ${r.destination} (${r.vehicle_type}, ${r.distance_km} km, Rs ${r.agreed_fare || r.suggested_fare}). Status: ${r.status}. ${url}`;
  res.json({ url, text });
});

// SOS / complaint.
app.post("/api/rides/:id/sos", async (req, res) => {
  const { user_id, message } = req.body || {};
  await client.execute({
    sql: "INSERT INTO complaints(ride_id, user_id, kind, message, created_at) VALUES (?, ?, 'sos', ?, ?)",
    args: [num(req.params.id), num(user_id, 0), message || "SOS pressed", now()],
  });
  res.json({ sos: true, police: "15", rescue: "1122", message: "SOS logged. Call Police 15 or Rescue 1122 now." });
});

app.post("/api/complaints", async (req, res) => {
  const { ride_id, user_id, message } = req.body || {};
  const r = await client.execute({
    sql: "INSERT INTO complaints(ride_id, user_id, kind, message, created_at) VALUES (?, ?, 'complaint', ?, ?)",
    args: [num(ride_id, 0) || null, num(user_id, 0) || null, message || "", now()],
  });
  res.json({ complaint_id: Number(r.lastInsertRowid) });
});

// ---- Admin ----
app.get("/api/admin/drivers", requireAdmin, async (req, res) => {
  const rows = await client.execute({
    sql: `SELECT d.*, u.name, u.phone, u.rating, u.rating_count, u.demo FROM drivers d JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC`,
  });
  res.json({ drivers: rows.rows });
});

app.post("/api/admin/drivers/:id/approve", requireAdmin, async (req, res) => {
  await client.execute({ sql: "UPDATE drivers SET status='approved' WHERE user_id = ?", args: [num(req.params.id)] });
  res.json({ status: "approved" });
});

app.post("/api/admin/drivers/:id/block", requireAdmin, async (req, res) => {
  await client.execute({ sql: "UPDATE drivers SET status='blocked', online=0 WHERE user_id = ?", args: [num(req.params.id)] });
  res.json({ status: "blocked" });
});

app.get("/api/admin/rides", requireAdmin, async (req, res) => {
  const rows = await client.execute({
    sql: `SELECT r.*, u.name AS rider_name, d.name AS driver_name FROM rides r
          JOIN users u ON u.id = r.rider_id LEFT JOIN users d ON d.id = r.driver_id
          ORDER BY r.created_at DESC LIMIT 200`,
  });
  res.json({ rides: rows.rows });
});

app.get("/api/admin/live-drivers", requireAdmin, async (req, res) => {
  const rows = await client.execute({
    sql: `SELECT d.*, u.name, u.phone, u.rating, u.rating_count FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.online = 1 AND d.status = 'approved'`,
  });
  res.json({ drivers: rows.rows });
});

app.get("/api/admin/complaints", requireAdmin, async (req, res) => {
  const rows = await client.execute({ sql: "SELECT * FROM complaints ORDER BY created_at DESC LIMIT 100" });
  res.json({ complaints: rows.rows });
});

app.post("/api/admin/complaints/:id/resolve", requireAdmin, async (req, res) => {
  await client.execute({ sql: "UPDATE complaints SET status='resolved' WHERE id = ?", args: [num(req.params.id)] });
  res.json({ status: "resolved" });
});

app.get("/api/admin/wallet/:driverId", requireAdmin, async (req, res) => {
  const tx = await client.execute({
    sql: "SELECT * FROM wallet_tx WHERE driver_id = ? ORDER BY created_at DESC LIMIT 100",
    args: [num(req.params.driverId)],
  });
  res.json({ transactions: tx.rows });
});

// Fare + commission settings — take effect immediately for new fare estimates.
app.post("/api/admin/settings", requireAdmin, async (req, res) => {
  const allowed = ["rate_bike_per_km", "rate_rickshaw_per_km", "rate_car_per_km", "min_bike", "min_rickshaw", "min_car", "commission_pct", "booking_fee", "sadapay_number", "jazzcash_number"];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      await client.execute({
        sql: "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        args: [key, String(req.body[key])],
      });
    }
  }
  res.json({ settings: await getSettings() });
});

app.get("/api/admin/reports", requireAdmin, async (req, res) => {
  const days = num(req.query.days, 7);
  const since = now() - days * 86400000;
  const totals = await client.execute({
    sql: "SELECT COUNT(*) AS rides, COALESCE(SUM(agreed_fare),0) AS gross, COALESCE(SUM(commission_charged),0) AS platform FROM rides WHERE status='completed' AND completed_at >= ?",
    args: [since],
  });
  const byVehicle = await client.execute({
    sql: "SELECT vehicle_type, COUNT(*) AS rides, COALESCE(SUM(agreed_fare),0) AS gross FROM rides WHERE status='completed' AND completed_at >= ? GROUP BY vehicle_type",
    args: [since],
  });
  const byDriver = await client.execute({
    sql: `SELECT r.driver_id, u.name, COUNT(*) AS rides, COALESCE(SUM(r.agreed_fare),0) AS gross, COALESCE(SUM(r.commission_charged),0) AS platform
          FROM rides r JOIN users u ON u.id = r.driver_id WHERE r.status='completed' AND r.completed_at >= ? GROUP BY r.driver_id ORDER BY rides DESC`,
    args: [since],
  });
  const t = totals.rows[0];
  res.json({
    days,
    rides: Number(t.rides),
    gross_fares: Number(t.gross),
    platform_revenue: Number(t.platform),
    by_vehicle: byVehicle.rows,
    by_driver: byDriver.rows,
  });
});

// Profit calculator — ESTIMATES ONLY, from the research report's maths.
// Lean monthly cost ~Rs 60,000; break-even rides/day = cost / platform keep per ride.
app.get("/api/admin/profit", requireAdmin, async (req, res) => {
  const s = await getSettings();
  const avgFare = num(req.query.avg_fare, 300);
  const monthlyCost = num(req.query.monthly_cost, 60000);
  const commissionPct = num(req.query.commission_pct, Number(s.commission_pct));
  const bookingFee = num(req.query.booking_fee, Number(s.booking_fee));
  const keepPerRide = Math.round((avgFare * commissionPct) / 100) + bookingFee;
  const breakEvenPerMonth = keepPerRide > 0 ? Math.ceil(monthlyCost / keepPerRide) : null;
  const breakEvenPerDay = breakEvenPerMonth ? Math.ceil(breakEvenPerMonth / 30) : null;
  const table = [10, 30, 50].map((ridesPerDay) => {
    const monthly = ridesPerDay * 30 * keepPerRide;
    return { rides_per_day: ridesPerDay, monthly_gross: monthly, monthly_net: monthly - monthlyCost };
  });
  res.json({
    estimates_only: true,
    note: "ESTIMATES ONLY — not a guarantee. Based on the research report: lean monthly cost ~Rs 60,000, average fare is an example, 30–50 rides/day needed to break even.",
    avg_fare: avgFare,
    monthly_cost: monthlyCost,
    commission_pct: commissionPct,
    booking_fee: bookingFee,
    platform_keep_per_ride: keepPerRide,
    break_even_rides_per_month: breakEvenPerMonth,
    break_even_rides_per_day: breakEvenPerDay,
    scenarios: table,
  });
});

app.get("/", (req, res) => res.sendFile(path.join(root, "public", "index.html")));

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[chunian-ride] listening on ${PORT} (db: ${usingTurso ? "turso" : "local-sqlite"})`);
    });
  })
  .catch((err) => {
    console.error("[chunian-ride] failed to start:", err);
    process.exit(1);
  });
