// Chunian Ride — Express server: pages + JSON API.
// inDrive-style: rider proposes a fare, drivers offer/counter/decline freely,
// rider picks an offer, cash is paid to the driver, platform fee is deducted
// from the driver's prepaid wallet (commission % + booking fee).
//
// PHASE 1 (2026-11-08) — trust layer:
// - Phone + password login (bcrypt), server-side sessions, role-based access.
//   No SMS OTP: no free SMS OTP exists (all providers charge per SMS;
//   Firebase phone auth needs the paid Blaze plan). Driver phones are also
//   verified by the owner at document approval.
// - Top-ups are PENDING until the owner verifies the TID and approves.
//   A fake TID buys nothing (G2 fix).
// - Admin = password-protected accounts, not a shared PIN. The old ADMIN_PIN
//   is only a one-time bootstrap key to create the first admin account.
// - Ride status history + audit log for admin actions and wallet changes.
// - All money movements run inside transactions (no double-credit, no
//   double ride completion).
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  client,
  initDb,
  getSettings,
  getPlaces,
  fareFor,
  platformTake,
  distanceBetween,
  usingTurso,
  withTx,
  writeAudit,
  writeRideHistory,
  getWalletBalance,
  adjustWallet,
  approveTopup,
  rejectTopup,
} from "./db.mjs";
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  normalizePhone,
  createSession,
  destroySession,
  destroyAllSessionsFor,
  setSessionCookie,
  clearSessionCookie,
  attachAuth,
  requireAuth,
  requireAdmin,
  requireSelfOrAdmin,
  loginRateLimit,
  loginFailed,
  loginSucceeded,
} from "./auth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

app.use(express.json());
app.use(express.static(path.join(root, "public")));
app.use(attachAuth);

const now = () => Date.now();
const VEHICLES = ["bike", "rickshaw", "car", "ac_car"];

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

async function loadRideOr404(req, res) {
  const ride = await client.execute({ sql: "SELECT * FROM rides WHERE id = ?", args: [num(req.params.id)] });
  if (!ride.rows.length) { res.status(404).json({ error: "ride not found" }); return null; }
  return ride.rows[0];
}

function isRideParticipant(ride, auth) {
  if (!auth) return false;
  if (auth.ownerType === "admin") return true;
  return ride.rider_id === auth.ownerId || ride.driver_id === auth.ownerId;
}

// Drivers may VIEW an open request (inDrive model: drivers browse requests
// before offering) — but they only see their OWN offers on it, and they
// cannot touch chat, SOS, cancel or ratings unless they are the assigned
// driver. Everything else needs isRideParticipant.
function canViewRide(ride, auth) {
  if (isRideParticipant(ride, auth)) return true;
  return ride.status === "requested" && auth && auth.ownerType === "user" && auth.role === "driver";
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "chunian-ride", version: "1.0.0", db: usingTurso ? "turso" : "local-sqlite" });
});

app.get("/api/places", async (req, res) => {
  res.json({ places: await getPlaces() });
});

app.get("/api/settings", async (req, res) => {
  const s = await getSettings();
  res.json({ settings: s });
});

// ---- Fare estimate (public — needed before login) ----
app.post("/api/fare", async (req, res) => {
  const { pickup, destination, vehicle, distance_km } = req.body || {};
  if (!VEHICLES.includes(vehicle)) return res.status(400).json({ error: "vehicle must be bike, rickshaw, car or ac_car" });
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

// ---- Auth: phone + password (free — no SMS OTP) ----
app.post("/api/auth/signup", async (req, res) => {
  const { name, phone, password, role } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: "name and phone are required" });
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });
  const cleanPhone = normalizePhone(phone);
  const wantRole = role === "driver" ? "driver" : "rider";
  const existing = await client.execute({ sql: "SELECT * FROM users WHERE phone = ?", args: [cleanPhone] });
  if (existing.rows.length) {
    const ex = existing.rows[0];
    // Demo accounts ship without a password: the first login claims the
    // account by setting its password. Real accounts can never be claimed.
    if (!ex.password_hash && Number(ex.demo) === 1 && ex.role === wantRole) {
      const hash = await hashPassword(password);
      await client.execute({ sql: "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", args: [hash, now(), ex.id] });
      const sessionId = await createSession("user", ex.id, req.headers["user-agent"]);
      setSessionCookie(res, req, sessionId);
      return res.json({ user: publicUser({ ...ex, password_hash: hash }), claimed: true });
    }
    return res.status(409).json({ error: "Is phone par account pehle se hai — login karein" });
  }
  const hash = await hashPassword(password);
  const r = await client.execute({
    sql: "INSERT INTO users(name, phone, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [String(name).trim(), cleanPhone, wantRole, hash, now()],
  });
  const userId = Number(r.lastInsertRowid);
  await client.execute({ sql: "INSERT OR IGNORE INTO wallets(user_id, balance, updated_at) VALUES (?, 0, ?)", args: [userId, now()] });
  if (wantRole === "rider") {
    await client.execute({ sql: "INSERT OR IGNORE INTO passengers(user_id, created_at) VALUES (?, ?)", args: [userId, now()] });
  }
  const user = (await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [userId] })).rows[0];
  const sessionId = await createSession("user", userId, req.headers["user-agent"]);
  setSessionCookie(res, req, sessionId);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/login", loginRateLimit, async (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) { loginFailed(req); return res.status(400).json({ error: "phone and password are required" }); }
  const cleanPhone = normalizePhone(phone);
  const found = await client.execute({ sql: "SELECT * FROM users WHERE phone = ?", args: [cleanPhone] });
  if (!found.rows.length) { loginFailed(req); return res.status(401).json({ error: "Phone ya password ghalat hai" }); }
  const user = found.rows[0];
  if (user.status === "suspended") { loginFailed(req); return res.status(403).json({ error: "Ye account suspend hai — owner se rabta karein" }); }
  if (!user.password_hash) {
    // Demo account without a password yet: first login sets (claims) it.
    if (Number(user.demo) === 1) {
      const pwError = validatePassword(password);
      if (pwError) { loginFailed(req); return res.status(400).json({ error: pwError }); }
      const hash = await hashPassword(password);
      await client.execute({ sql: "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", args: [hash, now(), user.id] });
      loginSucceeded(req);
      const sessionId = await createSession("user", user.id, req.headers["user-agent"]);
      setSessionCookie(res, req, sessionId);
      return res.json({ user: publicUser({ ...user, password_hash: hash }), claimed: true });
    }
    loginFailed(req);
    return res.status(400).json({ error: "Is account ka password abhi set nahi — owner se rabta karein" });
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) { loginFailed(req); return res.status(401).json({ error: "Phone ya password ghalat hai" }); }
  loginSucceeded(req);
  const sessionId = await createSession("user", user.id, req.headers["user-agent"]);
  setSessionCookie(res, req, sessionId);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  const cookies = req.headers.cookie || "";
  const m = cookies.match(/cr_session=([^;]+)/);
  if (m) await destroySession(decodeURIComponent(m[1]));
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.auth) return res.status(401).json({ error: "not logged in" });
  if (req.auth.ownerType === "admin") {
    return res.json({ admin: { id: req.auth.ownerId, name: req.auth.name, phone: req.auth.phone, role: req.auth.role } });
  }
  const u = await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.auth.ownerId] });
  if (!u.rows.length) return res.status(401).json({ error: "not logged in" });
  res.json({ user: publicUser(u.rows[0]) });
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  if (req.auth.ownerType !== "user") return res.status(403).json({ error: "Sirf user account ka password yahan badalta hai" });
  const { current, next } = req.body || {};
  const pwError = validatePassword(next);
  if (pwError) return res.status(400).json({ error: pwError });
  const u = await client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.auth.ownerId] });
  if (!u.rows.length) return res.status(404).json({ error: "user not found" });
  if (u.rows[0].password_hash && !(await verifyPassword(current || "", u.rows[0].password_hash))) {
    return res.status(401).json({ error: "Maujooda password ghalat hai" });
  }
  const hash = await hashPassword(next);
  await client.execute({ sql: "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", args: [hash, now(), req.auth.ownerId] });
  await destroyAllSessionsFor("user", req.auth.ownerId);
  const sessionId = await createSession("user", req.auth.ownerId, req.headers["user-agent"]);
  setSessionCookie(res, req, sessionId);
  res.json({ ok: true, message: "Password badal gaya — baqi devices se logout ho gaya" });
});

// ---- Admin bootstrap + login ----
// Does an admin account exist yet? (Public — only reveals existence.)
app.get("/api/admin/setup-needed", async (req, res) => {
  const c = await client.execute("SELECT COUNT(*) AS n FROM admins");
  res.json({ setup_needed: Number(c.rows[0].n) === 0 });
});

// One-time owner setup: the current ADMIN_PIN is the bootstrap key. It works
// ONLY while no admin account exists; after that the PIN is dead and only
// phone + password logins work.
app.post("/api/admin/setup", async (req, res) => {
  const { pin, name, phone, password } = req.body || {};
  const c = await client.execute("SELECT COUNT(*) AS n FROM admins");
  if (Number(c.rows[0].n) > 0) return res.status(400).json({ error: "Admin account pehle se bana hua hai — login karein" });
  if (String(pin || "") !== ADMIN_PIN) return res.status(401).json({ error: "PIN ghalat hai" });
  if (!phone) return res.status(400).json({ error: "phone is required" });
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });
  const hash = await hashPassword(password);
  const r = await client.execute({
    sql: "INSERT INTO admins(name, phone, password_hash, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
    args: [String(name || "Owner").trim(), normalizePhone(phone), hash, now()],
  });
  const adminId = Number(r.lastInsertRowid);
  const sessionId = await createSession("admin", adminId, req.headers["user-agent"]);
  setSessionCookie(res, req, sessionId);
  res.json({ admin: { id: adminId, name: String(name || "Owner").trim(), phone: normalizePhone(phone), role: "owner" }, message: "Owner account ban gaya — ab se PIN kaam nahi karega, sirf phone + password login hoga." });
});

app.post("/api/admin/login", loginRateLimit, async (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) { loginFailed(req); return res.status(400).json({ error: "phone and password are required" }); }
  const found = await client.execute({ sql: "SELECT * FROM admins WHERE phone = ?", args: [normalizePhone(phone)] });
  if (!found.rows.length) { loginFailed(req); return res.status(401).json({ error: "Phone ya password ghalat hai" }); }
  const admin = found.rows[0];
  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok) { loginFailed(req); return res.status(401).json({ error: "Phone ya password ghalat hai" }); }
  loginSucceeded(req);
  await client.execute({ sql: "UPDATE admins SET last_login_at = ? WHERE id = ?", args: [now(), admin.id] });
  const sessionId = await createSession("admin", admin.id, req.headers["user-agent"]);
  setSessionCookie(res, req, sessionId);
  res.json({ admin: { id: admin.id, name: admin.name, phone: admin.phone, role: admin.role } });
});

app.post("/api/admin/change-password", requireAdmin, async (req, res) => {
  const { current, next } = req.body || {};
  const pwError = validatePassword(next);
  if (pwError) return res.status(400).json({ error: pwError });
  const a = await client.execute({ sql: "SELECT * FROM admins WHERE id = ?", args: [req.auth.ownerId] });
  if (!a.rows.length) return res.status(404).json({ error: "admin not found" });
  if (!(await verifyPassword(current || "", a.rows[0].password_hash))) {
    return res.status(401).json({ error: "Maujooda password ghalat hai" });
  }
  const hash = await hashPassword(next);
  await client.execute({ sql: "UPDATE admins SET password_hash = ? WHERE id = ?", args: [hash, req.auth.ownerId] });
  await destroyAllSessionsFor("admin", req.auth.ownerId);
  const sessionId = await createSession("admin", req.auth.ownerId, req.headers["user-agent"]);
  setSessionCookie(res, req, sessionId);
  res.json({ ok: true, message: "Admin password badal gaya — baqi devices se logout ho gaya" });
});

// ---- Driver registration (CNIC / licence / vehicle registration; owner approves) ----
app.post("/api/drivers/register", requireAuth, async (req, res) => {
  const { user_id, vehicle_type, vehicle_model, plate, cnic, licence, vehicle_reg } = req.body || {};
  if (num(user_id) !== req.auth.ownerId && req.auth.ownerType !== "admin") {
    return res.status(403).json({ error: "Sirf apni registration kar sakte hain" });
  }
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
  const driverId = Number(r.lastInsertRowid);
  await client.execute({
    sql: "INSERT INTO vehicles(driver_user_id, vehicle_type, model, plate, registration_no, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)",
    args: [num(user_id), vehicle_type, vehicle_model || "", plate || "", vehicle_reg, now()],
  });
  res.json({ driver_id: driverId, status: "pending", message: "Registration submitted. The owner will approve it." });
});

app.get("/api/drivers/:id", requireAuth, requireSelfOrAdmin((req) => req.params.id), async (req, res) => {
  const d = await client.execute({
    sql: `SELECT d.*, u.name, u.phone, u.rating, u.rating_count, u.demo FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.user_id = ?`,
    args: [num(req.params.id)],
  });
  if (!d.rows.length) return res.status(404).json({ error: "driver not found" });
  res.json({ driver: d.rows[0] });
});

app.post("/api/drivers/:id/online", requireAuth, requireSelfOrAdmin((req) => req.params.id), async (req, res) => {
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
app.post("/api/drivers/:id/location", requireAuth, requireSelfOrAdmin((req) => req.params.id), async (req, res) => {
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
app.get("/api/drivers/:id/requests", requireAuth, requireSelfOrAdmin((req) => req.params.id), async (req, res) => {
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

// Driver wallet top-up (JazzCash / Sadapay). G2 FIX: this only CREATES a
// pending request. The wallet is credited ONLY when the owner verifies the
// TID in his own JazzCash app and approves it (POST /api/admin/topups/:id/approve).
app.post("/api/drivers/:id/topup", requireAuth, requireSelfOrAdmin((req) => req.params.id), async (req, res) => {
  const { amount, method, tid } = req.body || {};
  const amt = num(amount, 0);
  const s = await getSettings();
  const minTopup = Number(s.min_topup || 500);
  if (amt < minTopup) return res.status(400).json({ error: `minimum top-up is Rs ${minTopup}` });
  const d = await client.execute({ sql: "SELECT * FROM drivers WHERE user_id = ?", args: [num(req.params.id)] });
  if (!d.rows.length) return res.status(404).json({ error: "driver not found" });
  const r = await client.execute({
    sql: "INSERT INTO topup_requests(driver_id, amount, method, tid, note, status, created_at) VALUES (?, ?, ?, ?, 'Wallet top-up request', 'pending', ?)",
    args: [num(req.params.id), amt, method || "JazzCash", tid || "", now()],
  });
  res.json({
    request_id: Number(r.lastInsertRowid),
    status: "pending",
    amount: amt,
    wallet_balance: await getWalletBalance(num(req.params.id)),
    message: "Top-up request bhej di — balance tabhi barhe ga jab owner TID verify kar ke approve karega.",
  });
});

app.get("/api/drivers/:id/wallet", requireAuth, requireSelfOrAdmin((req) => req.params.id), async (req, res) => {
  const tx = await client.execute({
    sql: "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    args: [num(req.params.id)],
  });
  const pending = await client.execute({
    sql: "SELECT * FROM topup_requests WHERE driver_id = ? AND status = 'pending' ORDER BY created_at DESC",
    args: [num(req.params.id)],
  });
  const past = await client.execute({
    sql: "SELECT * FROM topup_requests WHERE driver_id = ? AND status != 'pending' ORDER BY created_at DESC LIMIT 10",
    args: [num(req.params.id)],
  });
  res.json({ wallet_balance: await getWalletBalance(num(req.params.id)), transactions: tx.rows, pending_topups: pending.rows, past_topups: past.rows });
});

// ---- Wallet (self): balance + recent transactions for the logged-in user ----
// User sessions only — admin sessions get 403 (admins use /api/admin/wallet/:driverId).
app.get("/api/wallet/me", requireAuth, async (req, res) => {
  if (req.auth.ownerType !== "user") return res.status(403).json({ error: "Sirf user account ka wallet yahan dikhta hai" });
  const tx = await client.execute({
    sql: "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    args: [req.auth.ownerId],
  });
  res.json({ balance: await getWalletBalance(req.auth.ownerId), transactions: tx.rows });
});

app.get("/api/drivers/:id/earnings", requireAuth, requireSelfOrAdmin((req) => req.params.id), async (req, res) => {
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
app.post("/api/rides", requireAuth, async (req, res) => {
  const { rider_id, pickup, destination, vehicle, proposed_fare, distance_km, scheduled_for } = req.body || {};
  if (req.auth.ownerType !== "user" || req.auth.role !== "rider" || req.auth.ownerId !== num(rider_id)) {
    return res.status(403).json({ error: "Sirf logged-in rider apni ride book kar sakta hai" });
  }
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
  const rideId = await withTx(async (tx) => {
    const r = await tx.execute({
      sql: "INSERT INTO rides(rider_id, pickup, destination, distance_km, distance_estimated, vehicle_type, suggested_fare, proposed_fare, scheduled_for, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?)",
      args: [num(rider_id), pickup, destination, km, estimated ? 1 : 0, vehicle, suggested, proposed, sched, now()],
    });
    const id = Number(r.lastInsertRowid);
    await writeRideHistory(tx, id, null, "requested", num(rider_id));
    return id;
  });
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

app.get("/api/rides/:id", requireAuth, async (req, res) => {
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (!canViewRide(ride, req.auth)) return res.status(403).json({ error: "Ye ride aap ki nahi hai" });
  const offers = await client.execute({
    sql: `SELECT o.*, u.name AS driver_name, u.rating AS driver_rating, u.rating_count AS driver_rating_count, d.vehicle_model, d.plate
          FROM offers o JOIN users u ON u.id = o.driver_id JOIN drivers d ON d.user_id = o.driver_id
          WHERE o.ride_id = ? ORDER BY o.fare ASC`,
    args: [num(req.params.id)],
  });
  // A browsing driver sees only their own offers on an open request.
  const visibleOffers = (!isRideParticipant(ride, req.auth) && ride.status === "requested")
    ? offers.rows.filter((o) => o.driver_id === req.auth.ownerId)
    : offers.rows;
  // Driver live location for the rider's map (only when a driver is assigned).
  let driverLocation = null;
  if (ride.driver_id) {
    const dl = await client.execute({ sql: "SELECT lat, lng, loc_updated_at FROM drivers WHERE user_id = ?", args: [num(ride.driver_id)] });
    if (dl.rows.length) driverLocation = { lat: dl.rows[0].lat, lng: dl.rows[0].lng, updated_at: dl.rows[0].loc_updated_at };
  }
  res.json({ ride, offers: visibleOffers, driver_location: driverLocation });
});

// ---- In-ride chat (text only, rider <-> driver of this ride; no phone numbers) ----
app.post("/api/rides/:id/messages", requireAuth, async (req, res) => {
  const { sender_id, sender_role, message } = req.body || {};
  const text = String(message || "").trim();
  if (!text || text.length > 500) return res.status(400).json({ error: "message must be 1-500 characters" });
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (req.auth.ownerType !== "user" || num(sender_id) !== req.auth.ownerId) {
    return res.status(403).json({ error: "Sirf apne naam se message bhej sakte hain" });
  }
  const ok = (sender_role === "rider" && num(sender_id) === ride.rider_id) || (sender_role === "driver" && num(sender_id) === ride.driver_id);
  if (!ok) return res.status(403).json({ error: "only the rider or driver of this ride can chat here" });
  const ins = await client.execute({
    sql: "INSERT INTO ride_messages(ride_id, sender_role, sender_id, message, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [num(req.params.id), sender_role, num(sender_id), text, now()],
  });
  res.json({ message_id: Number(ins.lastInsertRowid) });
});
app.get("/api/rides/:id/messages", requireAuth, async (req, res) => {
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (!isRideParticipant(ride, req.auth)) return res.status(403).json({ error: "only the rider or driver of this ride can read this chat" });
  const rows = await client.execute({
    sql: "SELECT id, sender_role, sender_id, message, created_at FROM ride_messages WHERE ride_id = ? ORDER BY created_at ASC LIMIT 50",
    args: [num(req.params.id)],
  });
  res.json({ messages: rows.rows });
});

app.get("/api/rides", requireAuth, async (req, res) => {
  const { rider_id, driver_id, status } = req.query;
  if (req.auth.ownerType !== "admin") {
    if (rider_id && num(rider_id) !== req.auth.ownerId) return res.status(403).json({ error: "Sirf apni rides dekh sakte hain" });
    if (driver_id && num(driver_id) !== req.auth.ownerId) return res.status(403).json({ error: "Sirf apni rides dekh sakte hain" });
    if (!rider_id && !driver_id) return res.status(400).json({ error: "rider_id or driver_id is required" });
  }
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
app.post("/api/rides/:id/offers/:offerId/accept", requireAuth, async (req, res) => {
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (req.auth.ownerType !== "user" || ride.rider_id !== req.auth.ownerId) {
    return res.status(403).json({ error: "Sirf is ride ka rider offer accept kar sakta hai" });
  }
  if (ride.status !== "requested") return res.status(400).json({ error: "ride is no longer open" });
  const offer = await client.execute({
    sql: "SELECT * FROM offers WHERE id = ? AND ride_id = ? AND status = 'pending'",
    args: [num(req.params.offerId), num(req.params.id)],
  });
  if (!offer.rows.length) return res.status(404).json({ error: "offer not found or no longer pending" });
  const o = offer.rows[0];
  try {
    await withTx(async (tx) => {
      const cur = await tx.execute({ sql: "SELECT status FROM rides WHERE id = ?", args: [num(req.params.id)] });
      if (!cur.rows.length || cur.rows[0].status !== "requested") throw new Error("ride is no longer open");
      await tx.execute({ sql: "UPDATE offers SET status='accepted' WHERE id = ?", args: [o.id] });
      await tx.execute({ sql: "UPDATE offers SET status='declined' WHERE ride_id = ? AND id != ? AND status='pending'", args: [num(req.params.id), o.id] });
      await tx.execute({
        sql: "UPDATE rides SET driver_id = ?, agreed_fare = ?, status = 'accepted' WHERE id = ?",
        args: [o.driver_id, o.fare, num(req.params.id)],
      });
      await writeRideHistory(tx, num(req.params.id), "requested", "accepted", ride.rider_id);
    });
  } catch (e) {
    if (e.message === "ride is no longer open") return res.status(400).json({ error: e.message });
    return next(e);
  }
  res.json({ ride_id: num(req.params.id), driver_id: o.driver_id, agreed_fare: o.fare });
});

// Driver sends a counter-offer.
app.post("/api/rides/:id/counter", requireAuth, async (req, res) => {
  const { driver_id, fare } = req.body || {};
  if (req.auth.ownerType !== "user" || req.auth.ownerId !== num(driver_id)) {
    return res.status(403).json({ error: "Sirf apne naam se counter-offer bhej sakte hain" });
  }
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (ride.status !== "requested") return res.status(400).json({ error: "ride is no longer open" });
  const d = await client.execute({ sql: "SELECT * FROM drivers WHERE user_id = ?", args: [num(driver_id)] });
  if (!d.rows.length || d.rows[0].status !== "approved") return res.status(403).json({ error: "driver is not approved yet" });
  const f = num(fare, 0);
  if (f <= 0) return res.status(400).json({ error: "fare must be more than 0" });
  const r = await client.execute({
    sql: "INSERT INTO offers(ride_id, driver_id, fare, eta_min, created_at) VALUES (?, ?, ?, 5, ?)",
    args: [num(req.params.id), num(driver_id), f, now()],
  });
  res.json({ offer_id: Number(r.lastInsertRowid), fare: f });
});

// Driver declines a request — no penalty, ever.
app.post("/api/rides/:id/decline", requireAuth, async (req, res) => {
  const { driver_id } = req.body || {};
  if (req.auth.ownerType !== "user" || req.auth.ownerId !== num(driver_id)) {
    return res.status(403).json({ error: "Sirf apne naam se decline kar sakte hain" });
  }
  await client.execute({
    sql: "UPDATE offers SET status='declined' WHERE ride_id = ? AND driver_id = ? AND status='pending'",
    args: [num(req.params.id), num(driver_id)],
  });
  res.json({ declined: true, penalty: 0 });
});

app.post("/api/rides/:id/start", requireAuth, async (req, res) => {
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (req.auth.ownerType !== "user" || ride.driver_id !== req.auth.ownerId) {
    return res.status(403).json({ error: "Sirf is ride ka driver trip start kar sakta hai" });
  }
  if (ride.status !== "accepted") return res.status(400).json({ error: "ride must be accepted before it can start" });
  await withTx(async (tx) => {
    await tx.execute({ sql: "UPDATE rides SET status='ongoing' WHERE id = ? AND status='accepted'", args: [num(req.params.id)] });
    await writeRideHistory(tx, num(req.params.id), "accepted", "ongoing", req.auth.ownerId);
  });
  res.json({ status: "ongoing" });
});

// Trip end — only after confirming cash was received from the rider.
// Runs inside one transaction: the status guard + commission debit happen
// together, so a ride can never be completed (and charged) twice.
app.post("/api/rides/:id/complete", requireAuth, async (req, res) => {
  const { cash_received } = req.body || {};
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (req.auth.ownerType !== "user" || ride.driver_id !== req.auth.ownerId) {
    return res.status(403).json({ error: "Sirf is ride ka driver trip complete kar sakta hai" });
  }
  if (ride.status !== "ongoing") return res.status(400).json({ error: "ride must be ongoing before it can be completed" });
  if (!cash_received) return res.status(400).json({ error: "Confirm cash received from the rider first — a trip cannot be completed without it" });
  const s = await getSettings();
  const fare = ride.agreed_fare || ride.suggested_fare;
  const take = platformTake(s, fare);
  const driverId = ride.driver_id;
  let newBalance;
  try {
    newBalance = await withTx(async (tx) => {
      const cur = await tx.execute({ sql: "SELECT status FROM rides WHERE id = ?", args: [num(req.params.id)] });
      if (!cur.rows.length || cur.rows[0].status !== "ongoing") throw new Error("ride must be ongoing before it can be completed");
      await tx.execute({
        sql: "UPDATE rides SET status='completed', cash_confirmed=1, commission_charged=?, completed_at=? WHERE id = ? AND status='ongoing'",
        args: [take, now(), num(req.params.id)],
      });
      const bal = await adjustWallet(tx, driverId, -take, {
        type: "commission",
        method: "auto",
        note: `Ride ${req.params.id}: commission ${s.commission_pct}% + booking fee Rs ${s.booking_fee}`,
        rideId: num(req.params.id),
      });
      await writeRideHistory(tx, num(req.params.id), "ongoing", "completed", driverId);
      return bal;
    });
  } catch (e) {
    if (e.message === "ride must be ongoing before it can be completed") {
      return res.status(400).json({ error: e.message });
    }
    return next(e);
  }
  res.json({
    status: "completed",
    fare,
    commission_pct: Number(s.commission_pct),
    booking_fee: Number(s.booking_fee),
    platform_take: take,
    driver_kept: fare - take,
    driver_wallet_balance: newBalance,
  });
});

app.post("/api/rides/:id/cancel", requireAuth, async (req, res) => {
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (!isRideParticipant(ride, req.auth)) return res.status(403).json({ error: "Sirf is ride ka rider ya driver cancel kar sakta hai" });
  if (ride.status === "completed") return res.status(400).json({ error: "completed ride cannot be cancelled" });
  await withTx(async (tx) => {
    await tx.execute({ sql: "UPDATE rides SET status='cancelled' WHERE id = ?", args: [num(req.params.id)] });
    await writeRideHistory(tx, num(req.params.id), ride.status, "cancelled", req.auth.ownerId);
  });
  res.json({ status: "cancelled" });
});

// Tip after a completed ride — goes 100% to the driver, NO commission on tips.
// Only the ride's own rider can tip, only once, only after completion.
app.post("/api/rides/:id/tip", requireAuth, async (req, res) => {
  const { rider_id, amount } = req.body || {};
  const tip = Math.round(num(amount, 0));
  if (tip <= 0) return res.status(400).json({ error: "tip must be more than 0" });
  if (tip > 5000) return res.status(400).json({ error: "tip cannot be more than Rs 5000" });
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (ride.status !== "completed") return res.status(400).json({ error: "tip can only be added after the ride is completed" });
  if (req.auth.ownerType !== "user" || num(rider_id) !== req.auth.ownerId || num(rider_id) !== ride.rider_id) {
    return res.status(403).json({ error: "only the rider of this ride can add a tip" });
  }
  if (Number(ride.tip_amount || 0) > 0) return res.status(400).json({ error: "tip already added for this ride" });
  // Tip is cash, paid rider -> driver directly (like the fare itself):
  // it is recorded on the ride and shown in earnings/receipts, but it is
  // NOT added to the prepaid wallet balance (that balance is only money
  // the driver deposited for commission). 100% driver, 0% commission.
  await client.execute({
    sql: "UPDATE rides SET tip_amount = ? WHERE id = ? AND tip_amount = 0",
    args: [tip, num(req.params.id)],
  });
  res.json({ ride_id: num(req.params.id), tip, commission_on_tip: 0, note: "Tip 100% driver ko — is par koi commission nahi." });
});

// Rate driver (by rider) or rate rider (by driver).
app.post("/api/rides/:id/rate", requireAuth, async (req, res) => {
  const { by, stars } = req.body || {};
  const s = Math.max(1, Math.min(5, num(stars, 5)));
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (by === "rider" && ride.driver_id) {
    if (req.auth.ownerType !== "user" || ride.rider_id !== req.auth.ownerId) {
      return res.status(403).json({ error: "Sirf is ride ka rider driver ko rate kar sakta hai" });
    }
    await client.execute({ sql: "UPDATE rides SET rating_driver = ? WHERE id = ?", args: [s, num(req.params.id)] });
    await client.execute({
      sql: "UPDATE users SET rating = ((rating * rating_count) + ?) / (rating_count + 1), rating_count = rating_count + 1 WHERE id = ?",
      args: [s, ride.driver_id],
    });
  } else if (by === "driver") {
    if (req.auth.ownerType !== "user" || ride.driver_id !== req.auth.ownerId) {
      return res.status(403).json({ error: "Sirf is ride ka driver rider ko rate kar sakta hai" });
    }
    await client.execute({ sql: "UPDATE rides SET rating_rider = ? WHERE id = ?", args: [s, num(req.params.id)] });
    await client.execute({
      sql: "UPDATE users SET rating = ((rating * rating_count) + ?) / (rating_count + 1), rating_count = rating_count + 1 WHERE id = ?",
      args: [s, ride.rider_id],
    });
  } else {
    return res.status(400).json({ error: "by must be 'rider' or 'driver'" });
  }
  res.json({ rated: true, stars: s });
});

// Share trip — returns copyable text + link. (Public on purpose: the rider
// shares it with family; it only exposes the ride summary.)
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
app.post("/api/rides/:id/sos", requireAuth, async (req, res) => {
  const { message } = req.body || {};
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (!isRideParticipant(ride, req.auth)) return res.status(403).json({ error: "Sirf is ride ka rider ya driver SOS bhej sakta hai" });
  await client.execute({
    sql: "INSERT INTO complaints(ride_id, user_id, kind, message, created_at) VALUES (?, ?, 'sos', ?, ?)",
    args: [num(req.params.id), req.auth.ownerId, message || "SOS pressed", now()],
  });
  res.json({ sos: true, police: "15", rescue: "1122", message: "SOS logged. Call Police 15 or Rescue 1122 now." });
});

app.post("/api/complaints", requireAuth, async (req, res) => {
  const { ride_id, message } = req.body || {};
  const r = await client.execute({
    sql: "INSERT INTO complaints(ride_id, user_id, kind, message, created_at) VALUES (?, ?, 'complaint', ?, ?)",
    args: [num(ride_id, 0) || null, req.auth.ownerId, message || "", now()],
  });
  res.json({ complaint_id: Number(r.lastInsertRowid) });
});

// ---- Admin (session login — the shared PIN is gone) ----
app.get("/api/admin/drivers", requireAdmin, async (req, res) => {
  const rows = await client.execute({
    sql: `SELECT d.*, u.name, u.phone, u.rating, u.rating_count, u.demo, u.status AS user_status FROM drivers d JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC`,
  });
  res.json({ drivers: rows.rows });
});

app.post("/api/admin/drivers/:id/approve", requireAdmin, async (req, res) => {
  await client.execute({ sql: "UPDATE drivers SET status='approved', documents_status='approved' WHERE user_id = ?", args: [num(req.params.id)] });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "driver_approve", targetType: "driver", targetId: num(req.params.id), detail: "Driver documents approved" });
  res.json({ status: "approved" });
});

app.post("/api/admin/drivers/:id/block", requireAdmin, async (req, res) => {
  await client.execute({ sql: "UPDATE drivers SET status='blocked', online=0 WHERE user_id = ?", args: [num(req.params.id)] });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "driver_block", targetType: "driver", targetId: num(req.params.id), detail: "Driver blocked" });
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
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "complaint_resolve", targetType: "complaint", targetId: num(req.params.id), detail: "Complaint resolved" });
  res.json({ status: "resolved" });
});

app.get("/api/admin/wallet/:driverId", requireAdmin, async (req, res) => {
  const tx = await client.execute({
    sql: "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    args: [num(req.params.driverId)],
  });
  res.json({ wallet_balance: await getWalletBalance(num(req.params.driverId)), transactions: tx.rows });
});

// ---- Admin overview (dashboard stat cards) ----
// "today" = last 24h (completed_at for completed rides, created_at for rides).
// Platform revenue = SUM(commission_charged) on completed rides.
app.get("/api/admin/overview", requireAdmin, async (req, res) => {
  const dayAgo = now() - 86400000;
  const weekAgo = now() - 7 * 86400000;
  const one = async (sql, args = []) => Number((await client.execute({ sql, args })).rows[0].n);
  const users = await one("SELECT COUNT(*) AS n FROM users");
  const riders = await one("SELECT COUNT(*) AS n FROM users WHERE role = 'rider'");
  const drivers = await one("SELECT COUNT(*) AS n FROM drivers");
  const driversOnline = await one("SELECT COUNT(*) AS n FROM drivers WHERE online = 1 AND status = 'approved'");
  const ridesToday = await one("SELECT COUNT(*) AS n FROM rides WHERE created_at >= ?", [dayAgo]);
  const ridesTotal = await one("SELECT COUNT(*) AS n FROM rides");
  const completedToday = await one("SELECT COUNT(*) AS n FROM rides WHERE status = 'completed' AND completed_at >= ?", [dayAgo]);
  const pendingTopups = await one("SELECT COUNT(*) AS n FROM topup_requests WHERE status = 'pending'");
  const openComplaints = await one("SELECT COUNT(*) AS n FROM complaints WHERE status = 'open'");
  const pendingDrivers = await one("SELECT COUNT(*) AS n FROM drivers WHERE status = 'pending'");
  const rev7d = await one("SELECT COALESCE(SUM(commission_charged), 0) AS n FROM rides WHERE status = 'completed' AND completed_at >= ?", [weekAgo]);
  const revToday = await one("SELECT COALESCE(SUM(commission_charged), 0) AS n FROM rides WHERE status = 'completed' AND completed_at >= ?", [dayAgo]);
  res.json({
    totals: { users, riders, drivers, drivers_online: driversOnline, rides_today: ridesToday, rides_total: ridesTotal, completed_today: completedToday },
    pending_topups: pendingTopups,
    open_complaints: openComplaints,
    pending_drivers: pendingDrivers,
    platform_revenue_7d: rev7d,
    platform_revenue_today: revToday,
  });
});

// ---- Admin cities (service areas; the rider app reads them via /api/places) ----
app.get("/api/admin/cities", requireAdmin, async (req, res) => {
  const rows = await client.execute({ sql: "SELECT * FROM cities ORDER BY id ASC" });
  res.json({ cities: rows.rows });
});

app.post("/api/admin/cities", requireAdmin, async (req, res) => {
  const { name, lat, lng, km_from_chunian, note } = req.body || {};
  const cleanName = String(name || "").trim();
  if (!cleanName) return res.status(400).json({ error: "name is required" });
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return res.status(400).json({ error: "valid lat/lng are required" });
  const km = km_from_chunian == null || km_from_chunian === "" ? null : Number(km_from_chunian);
  if (km != null && !Number.isFinite(km)) return res.status(400).json({ error: "km_from_chunian must be a number" });
  try {
    const r = await client.execute({
      sql: "INSERT INTO cities(name, lat, lng, km_from_chunian, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [cleanName, la, ln, km, String(note || ""), now()],
    });
    const city = (await client.execute({ sql: "SELECT * FROM cities WHERE id = ?", args: [Number(r.lastInsertRowid)] })).rows[0];
    await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "city_create", targetType: "city", targetId: Number(r.lastInsertRowid), detail: `City added: ${cleanName}` });
    res.json({ city });
  } catch {
    res.status(409).json({ error: "Is naam ka sheher pehle se hai" });
  }
});

app.post("/api/admin/cities/:id/deactivate", requireAdmin, async (req, res) => {
  const c = await client.execute({ sql: "SELECT * FROM cities WHERE id = ?", args: [num(req.params.id)] });
  if (!c.rows.length) return res.status(404).json({ error: "city not found" });
  await client.execute({ sql: "UPDATE cities SET active = 0 WHERE id = ?", args: [num(req.params.id)] });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "city_deactivate", targetType: "city", targetId: num(req.params.id), detail: `City deactivated: ${c.rows[0].name}` });
  res.json({ active: 0 });
});

app.post("/api/admin/cities/:id/activate", requireAdmin, async (req, res) => {
  const c = await client.execute({ sql: "SELECT * FROM cities WHERE id = ?", args: [num(req.params.id)] });
  if (!c.rows.length) return res.status(404).json({ error: "city not found" });
  await client.execute({ sql: "UPDATE cities SET active = 1 WHERE id = ?", args: [num(req.params.id)] });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "city_activate", targetType: "city", targetId: num(req.params.id), detail: `City activated: ${c.rows[0].name}` });
  res.json({ active: 1 });
});

// ---- Admin foundation: users, top-ups, promo codes, audit log ----
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const rows = await client.execute({
    sql: `SELECT u.*, w.balance AS wallet_balance,
            (SELECT d.status FROM drivers d WHERE d.user_id = u.id) AS driver_status
          FROM users u LEFT JOIN wallets w ON w.user_id = u.id ORDER BY u.created_at DESC LIMIT 200`,
  });
  res.json({ users: rows.rows.map((u) => publicUser(u)) });
});

app.post("/api/admin/users/:id/suspend", requireAdmin, async (req, res) => {
  await client.execute({ sql: "UPDATE users SET status='suspended' WHERE id = ?", args: [num(req.params.id)] });
  await client.execute({ sql: "UPDATE drivers SET online=0 WHERE user_id = ?", args: [num(req.params.id)] });
  await destroyAllSessionsFor("user", num(req.params.id));
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "user_suspend", targetType: "user", targetId: num(req.params.id), detail: "Account suspended" });
  res.json({ status: "suspended" });
});

app.post("/api/admin/users/:id/reactivate", requireAdmin, async (req, res) => {
  await client.execute({ sql: "UPDATE users SET status='active' WHERE id = ?", args: [num(req.params.id)] });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "user_reactivate", targetType: "user", targetId: num(req.params.id), detail: "Account reactivated" });
  res.json({ status: "active" });
});

// Top-up review — the owner checks the TID in his own JazzCash app, then
// approves (credits the wallet exactly once) or rejects (credits nothing).
app.get("/api/admin/topups", requireAdmin, async (req, res) => {
  const status = req.query.status || "";
  const sql = status
    ? "SELECT t.*, u.name AS driver_name, u.phone AS driver_phone FROM topup_requests t JOIN users u ON u.id = t.driver_id WHERE t.status = ? ORDER BY t.created_at DESC LIMIT 100"
    : "SELECT t.*, u.name AS driver_name, u.phone AS driver_phone FROM topup_requests t JOIN users u ON u.id = t.driver_id ORDER BY t.created_at DESC LIMIT 100";
  const args = status ? [status] : [];
  const rows = await client.execute({ sql, args });
  res.json({ topups: rows.rows });
});

app.post("/api/admin/topups/:id/approve", requireAdmin, async (req, res) => {
  try {
    const out = await approveTopup(num(req.params.id), req.auth.ownerId);
    res.json({ status: "approved", ...out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/admin/topups/:id/reject", requireAdmin, async (req, res) => {
  try {
    const out = await rejectTopup(num(req.params.id), req.auth.ownerId, String((req.body || {}).reason || ""));
    res.json({ status: "rejected", ...out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Promo codes — foundation only (fare-math integration comes in Phase 6).
app.get("/api/admin/promo-codes", requireAdmin, async (req, res) => {
  const rows = await client.execute({ sql: "SELECT * FROM promo_codes ORDER BY created_at DESC LIMIT 100" });
  res.json({ promo_codes: rows.rows });
});

app.post("/api/admin/promo-codes", requireAdmin, async (req, res) => {
  const { code, discount_type, discount_value, max_uses, valid_from, valid_to } = req.body || {};
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode) return res.status(400).json({ error: "code is required" });
  const dv = num(discount_value, 0);
  if (dv <= 0) return res.status(400).json({ error: "discount_value must be more than 0" });
  if (discount_type === "percent" && dv > 100) return res.status(400).json({ error: "percent discount cannot be more than 100" });
  try {
    const r = await client.execute({
      sql: "INSERT INTO promo_codes(code, discount_type, discount_value, max_uses, valid_from, valid_to, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
      args: [cleanCode, discount_type === "fixed" ? "fixed" : "percent", dv, num(max_uses, 0), valid_from ? num(valid_from) : null, valid_to ? num(valid_to) : null, now()],
    });
    await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "promo_create", targetType: "promo_code", targetId: Number(r.lastInsertRowid), detail: `Promo ${cleanCode} (${discount_type}, ${dv})` });
    res.json({ promo_id: Number(r.lastInsertRowid), code: cleanCode });
  } catch {
    res.status(409).json({ error: "Is code par promo pehle se hai" });
  }
});

app.post("/api/admin/promo-codes/:id/deactivate", requireAdmin, async (req, res) => {
  await client.execute({ sql: "UPDATE promo_codes SET active=0 WHERE id = ?", args: [num(req.params.id)] });
  res.json({ active: 0 });
});

app.get("/api/admin/audit-log", requireAdmin, async (req, res) => {
  const rows = await client.execute({ sql: "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100" });
  res.json({ audit_log: rows.rows });
});

// Launch hygiene: suspend every demo account (and take demo drivers offline).
// Demo data is for testing only — real launch must not have claimable demo
// accounts offering rides.
app.post("/api/admin/demo/disable", requireAdmin, async (req, res) => {
  const r = await client.execute({ sql: "UPDATE users SET status='suspended' WHERE demo = 1" });
  await client.execute({ sql: "UPDATE drivers SET online=0 WHERE user_id IN (SELECT id FROM users WHERE demo = 1)" });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "demo_disable", targetType: "users", targetId: null, detail: `Suspended ${Number(r.rowsAffected)} demo accounts` });
  res.json({ suspended: Number(r.rowsAffected) });
});

// Fare + commission settings — take effect immediately for new fare estimates.
app.post("/api/admin/settings", requireAdmin, async (req, res) => {
  const allowed = ["rate_bike_per_km", "rate_rickshaw_per_km", "rate_car_per_km", "rate_ac_car_per_km", "min_bike", "min_rickshaw", "min_car", "min_ac_car", "commission_pct", "booking_fee", "sadapay_number", "jazzcash_number", "support_phone", "support_whatsapp", "min_topup"];
  const changed = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      await client.execute({
        sql: "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        args: [key, String(req.body[key])],
      });
      changed.push(`${key}=${req.body[key]}`);
    }
  }
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "settings_change", targetType: "settings", targetId: null, detail: changed.join(", ") });
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

// Separate role pages (frontend agent builds admin.html / rider.html / driver.html).
app.get("/admin", (req, res) => res.sendFile(path.join(root, "public", "admin.html")));
app.get("/rider", (req, res) => res.sendFile(path.join(root, "public", "rider.html")));
app.get("/driver", (req, res) => res.sendFile(path.join(root, "public", "driver.html")));

// JSON error handler — never leak a stack trace or an HTML error page to the app.
app.use((err, req, res, next) => {
  console.error("[chunian-ride] error:", err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Server error — dobara koshish karein" });
});

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
