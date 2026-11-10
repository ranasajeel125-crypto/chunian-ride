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
// - Admin = password-protected accounts, not a shared PIN. The old
//   ADMIN_PIN bootstrap is gone (v2.0): first-admin setup uses a random
//   one-time token whose SHA-256 hash is stored in settings; the token is
//   printed once to stdout (Render logs) and deleted after use.
// - Ride status history + audit log for admin actions and wallet changes.
// - All money movements run inside transactions (no double-credit, no
//   double ride completion).
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
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
  haversineKm,
  OFFER_TTL_MS,
  CALL_SIGNAL_TTL_MS,
  computePickupDistance,
  expireStaleOffers,
  runScheduledReminders,
  ensureVapidKeys,
  getVapidPublicKey,
  usingTurso,
  withTx,
  writeAudit,
  writeRideHistory,
  getWalletBalance,
  adjustWallet,
  approveTopup,
  rejectTopup,
  notify,
  notifyAdmins,
  validatePromo,
  promoDiscount,
  approveWithdrawal,
  rejectWithdrawal,
  createRefund,
  getDocChecklist,
  pilotLocked,
  pilotAreaError,
  pilotCap,
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
  setupRateLimit,
  setupFailed,
  setupSucceeded,
} from "./auth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
// NOTE: the old ADMIN_PIN env var is IGNORED completely since v2.0 — the
// fixed 4-digit bootstrap PIN is gone (it was brute-forceable: public
// endpoint, no rate limit). If ADMIN_PIN still exists in the Render
// dashboard it is inert and should be deleted by the owner. First-admin
// setup now uses a random one-time token (see ensureSetupToken below).

// JSON body limit 3 MB: document photo uploads are base64 data URLs up
// to ~2.1 MB (the server's own cap returns 400 above that). The default
// 100 kb limit would reject a legit upload with a 500 instead.
app.use(express.json({ limit: "3mb" }));
// HTML pages must never be served stale from a cache: the v1 page a user
// cached kept showing after the redesign (no "Version 1" text exists in
// current code). no-store on every HTML/extensionless route; versioned
// (?v=6) JS/CSS bust asset caches instead.
app.use((req, res, next) => {
  if (req.path === "/" || req.path.endsWith(".html") || !path.extname(req.path)) {
    res.set("Cache-Control", "no-store");
  }
  next();
});
// App Links verification file for the APK Google sign-in return trip
// (v2.5). express.static ignores dotfiles by default, so this needs an
// explicit route — Android fetches it when the app is installed to verify
// that chunian-ride.onrender.com may open the app. Fingerprint = the APK
// signing cert (same since v1).
app.get("/.well-known/assetlinks.json", (req, res) => {
  res.sendFile(path.join(root, "public", ".well-known", "assetlinks.json"));
});
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
  const { password_hash, google_id, ...rest } = u;
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
  res.json({ ok: true, app: "chunian-ride", version: "2.5.0", db: usingTurso ? "turso" : "local-sqlite" });
});

// App update check (v2.1): single source of truth for the latest APK.
// The Android app polls this on launch; no auth, no DB, no other logic.
app.get("/api/app-version", (req, res) => {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, "public", "app-version.json"), "utf8"));
    res.json({ ok: true, ...v });
  } catch (e) {
    res.status(500).json({ ok: false, error: "version info unavailable" });
  }
});

app.get("/api/places", async (req, res) => {
  res.json({ places: await getPlaces() });
});

app.get("/api/settings", async (req, res) => {
  const s = await getSettings();
  // google_login_enabled is a public boolean (client ID is public by
  // design); the client SECRET never leaves the server.
  res.json({ settings: s, google_login_enabled: googleConfigured() });
});

// ---- Fare estimate (public — needed before login) ----
// Optional promo_code: validated (active, in date range, uses left); the
// discount lands in suggested_fare. base_fare is the undiscounted fare.
app.post("/api/fare", async (req, res) => {
  const { pickup, destination, vehicle, distance_km, promo_code } = req.body || {};
  if (!VEHICLES.includes(vehicle)) return res.status(400).json({ error: "vehicle must be bike, rickshaw, car or ac_car" });
  // Pilot lock (v2.2): Chunian City only while pilot mode is ON.
  const s = await getSettings();
  const areaErr = pilotAreaError(s, pickup, destination);
  if (areaErr) return res.status(400).json({ error: areaErr });
  let km = num(distance_km, 0);
  let estimated = false;
  if (!km) {
    const d = distanceBetween(pickup, destination);
    if (d.km == null) return res.status(400).json({ error: "distance unknown — enter km manually" });
    km = d.km;
    estimated = d.estimated;
  }
  const base = fareFor(s, vehicle, km);
  let discount = 0, promo = null;
  if (promo_code) {
    try {
      promo = await validatePromo(client, promo_code);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    discount = promoDiscount(base, promo);
  }
  const suggested = Math.max(1, base - discount);
  res.json({ pickup, destination, vehicle, distance_km: km, distance_estimated: estimated, suggested_fare: suggested, base_fare: base, discount_amount: discount, promo_code: promo ? promo.code : null, per_km: Number(s[`rate_${vehicle}_per_km`]), min_fare: Number(s[`min_${vehicle}`]) });
});

// ---- Auth: phone + password (free — no SMS OTP) ----
app.post("/api/auth/signup", async (req, res) => {
  const { name, phone, password, role } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: "name and phone are required" });
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });
  const cleanPhone = normalizePhone(phone);
  const wantRole = role === "driver" ? "driver" : "rider";
  // Pilot mode (v2.2): public signup is CLOSED — only whitelisted phones
  // may register, and only up to the pilot caps. Login of existing
  // accounts is unaffected (see /api/auth/login).
  let whitelistEntry = null;
  if (String((await getSettings()).pilot_mode) === "1") {
    const wl = await client.execute({
      sql: "SELECT * FROM pilot_whitelist WHERE phone = ? AND role = ?",
      args: [cleanPhone, wantRole],
    });
    whitelistEntry = wl.rows.find((r) => r.status === "pending" || r.status === "approved") || null;
    if (!whitelistEntry) {
      return res.status(403).json({ error: "Pilot registration sirf whitelist par hai — owner se rabta karein" });
    }
    // Live cap re-check at signup time (the whitelist-add check is the
    // first layer; this one guards the actual account creation).
    if (whitelistEntry.status === "pending") {
      const s = await getSettings();
      const cap = pilotCap(wantRole, s);
      const approvedCount = await client.execute({
        sql: "SELECT COUNT(*) AS n FROM pilot_whitelist WHERE role = ? AND status = 'approved'",
        args: [wantRole],
      });
      if (Number(approvedCount.rows[0].n) >= cap) {
        return res.status(403).json({ error: "Pilot limit poori ho gayi — registration band hai" });
      }
    }
  }
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
  if (whitelistEntry) {
    await client.execute({ sql: "UPDATE pilot_whitelist SET status='approved' WHERE id = ?", args: [whitelistEntry.id] });
  }
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

// ---- Google sign-in (v2.5, free OAuth 2.0) ----
// Standard authorization-code flow. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
// live ONLY in Render env vars — never in code, files or chat. The button
// is shown only when both are set (google_login_enabled in /api/settings).
// WebView gotcha: Google blocks OAuth inside embedded WebViews
// (disallowed_useragent), and this app's APK is a WebView wrapper — so in
// the APK the auth URL opens in the system browser (intent:// URL from the
// page, routed by MainActivity), and the return trip comes back via an App
// Link (/auth/google/return) that hands a one-time token to the WebView,
// which exchanges it for the session cookie. In a normal browser the
// callback sets the cookie directly.
// Pilot gate: Google profiles have no phone, so a first-time Google user
// must give a phone number (see /google-phone) and that number must be on
// the pilot whitelist before any account is created — same rules as phone
// signup. Drivers are owner-created: a Google driver login only links an
// existing driver account (with that account's phone password).
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = process.env.GOOGLE_USERINFO_URL || "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_TTL_MS = 10 * 60 * 1000; // states / pending identities / login tokens live 10 minutes
const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const googleRedirectUri = (req) => process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
const roleHome = (role) => (role === "driver" ? "/driver" : "/rider");
const googleErrorRedirect = (role, message) => `${roleHome(role)}?google_error=${encodeURIComponent(message)}`;

async function pruneGoogleRows() {
  const cut = Date.now() - GOOGLE_TTL_MS;
  for (const tbl of ["google_auth_states", "google_pending", "google_login_tokens"]) {
    await client.execute({ sql: `DELETE FROM ${tbl} WHERE created_at < ?`, args: [cut] }).catch(() => {});
  }
}
async function newGoogleLoginToken(sessionId, role) {
  const token = crypto.randomBytes(32).toString("hex");
  await client.execute({ sql: "INSERT INTO google_login_tokens(token, session_id, role, created_at) VALUES (?, ?, ?, ?)", args: [token, sessionId, role, Date.now()] });
  return token;
}

app.get("/api/auth/google", async (req, res) => {
  if (!googleConfigured()) return res.status(503).json({ error: "Google login abhi setup nahi — owner se rabta karein" });
  const role = req.query.role === "driver" ? "driver" : "rider";
  const source = req.query.source === "apk" ? "apk" : "web";
  const state = crypto.randomBytes(32).toString("hex");
  await pruneGoogleRows();
  await client.execute({ sql: "INSERT INTO google_auth_states(state, role, source, created_at) VALUES (?, ?, ?, ?)", args: [state, role, source, Date.now()] });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

app.get("/api/auth/google/callback", async (req, res) => {
  const { code, state } = req.query || {};
  // The state is looked up FIRST (before any Google call) so a forged
  // callback fails fast without spending a token exchange.
  const st = state ? (await client.execute({ sql: "SELECT * FROM google_auth_states WHERE state = ?", args: [String(state)] })).rows[0] : null;
  if (!st || Date.now() - Number(st.created_at) > GOOGLE_TTL_MS) {
    return res.redirect(googleErrorRedirect("rider", "Google login ka waqt khatam — dobara koshish karein"));
  }
  await client.execute({ sql: "DELETE FROM google_auth_states WHERE state = ?", args: [st.state] });
  const role = st.role === "driver" ? "driver" : "rider";
  const source = st.source === "apk" ? "apk" : "web";
  if (!code) return res.redirect(googleErrorRedirect(role, "Google se login nahi ho saka — dobara koshish karein"));
  let profile = null;
  try {
    const tokRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(req),
        grant_type: "authorization_code",
      }),
    });
    const tok = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tok.access_token) throw new Error("token exchange failed");
    const meRes = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const me = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !me.sub) throw new Error("userinfo failed");
    profile = { googleId: String(me.sub), email: String(me.email || ""), name: String(me.name || "") };
  } catch (e) {
    return res.redirect(googleErrorRedirect(role, "Google se login nahi ho saka — dobara koshish karein"));
  }
  // Returning Google user: log straight in (no phone step).
  const linked = (await client.execute({ sql: "SELECT * FROM users WHERE google_id = ?", args: [profile.googleId] })).rows[0];
  if (linked) {
    if (linked.status === "suspended") return res.redirect(googleErrorRedirect(role, "Ye account suspend hai — owner se rabta karein"));
    const sessionId = await createSession("user", linked.id, req.headers["user-agent"]);
    if (source === "apk") {
      const token = await newGoogleLoginToken(sessionId, linked.role);
      return res.redirect(`/auth/google/done?token=${token}`);
    }
    setSessionCookie(res, req, sessionId);
    return res.redirect(roleHome(linked.role));
  }
  // First time: park the Google identity and ask for a phone number
  // (the pilot whitelist is phone-based — checked at the phone step).
  await pruneGoogleRows();
  const token = crypto.randomBytes(32).toString("hex");
  await client.execute({
    sql: "INSERT INTO google_pending(token, google_id, email, name, role, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [token, profile.googleId, profile.email, profile.name, role, source, Date.now()],
  });
  res.redirect(`/google-phone?token=${token}`);
});

app.get("/api/auth/google/pending", async (req, res) => {
  const token = String(req.query.token || "");
  if (!token) return res.status(400).json({ error: "token chahiye" });
  const row = (await client.execute({ sql: "SELECT * FROM google_pending WHERE token = ?", args: [token] })).rows[0];
  if (!row || Date.now() - Number(row.created_at) > GOOGLE_TTL_MS) return res.status(404).json({ error: "Ye Google login khatam ho gaya — dobara koshish karein" });
  res.json({ name: row.name, email: row.email, role: row.role });
});

app.post("/api/auth/google/phone", async (req, res) => {
  const { token, phone, password } = req.body || {};
  if (!token || !phone) return res.status(400).json({ error: "token aur phone chahiye" });
  const pend = (await client.execute({ sql: "SELECT * FROM google_pending WHERE token = ?", args: [String(token)] })).rows[0];
  if (!pend || Date.now() - Number(pend.created_at) > GOOGLE_TTL_MS) {
    return res.status(400).json({ error: "Ye Google login khatam ho gaya — dobara koshish karein" });
  }
  const cleanPhone = normalizePhone(phone);
  const wantRole = pend.role === "driver" ? "driver" : "rider";
  const finish = async (userId, role) => {
    await client.execute({ sql: "DELETE FROM google_pending WHERE token = ?", args: [pend.token] });
    const sessionId = await createSession("user", userId, req.headers["user-agent"]);
    if (pend.source === "apk") {
      const loginToken = await newGoogleLoginToken(sessionId, role);
      return res.json({ ok: true, redirect: `/auth/google/done?token=${loginToken}` });
    }
    setSessionCookie(res, req, sessionId);
    return res.json({ ok: true, redirect: roleHome(role) });
  };
  const existing = (await client.execute({ sql: "SELECT * FROM users WHERE phone = ?", args: [cleanPhone] })).rows[0];
  if (existing) {
    // Link Google to the existing phone account — only with that
    // account's password, so a Google account alone can never hijack a
    // phone number it does not own.
    if (existing.role !== wantRole) return res.status(400).json({ error: `Is phone par ${wantRole} account nahi hai` });
    if (existing.status === "suspended") return res.status(403).json({ error: "Ye account suspend hai — owner se rabta karein" });
    if (existing.google_id && existing.google_id !== pend.google_id) {
      return res.status(409).json({ error: "Is account se koi aur Google account link hai" });
    }
    if (existing.google_id === pend.google_id) return finish(existing.id, existing.role);
    if (!existing.password_hash) return res.status(400).json({ error: "Is account ka password abhi set nahi — owner se rabta karein" });
    if (!password || !(await verifyPassword(password, existing.password_hash))) {
      return res.status(401).json({ error: "Is phone ke account ka password ghalat hai" });
    }
    await client.execute({ sql: "UPDATE users SET google_id = ?, google_email = ?, updated_at = ? WHERE id = ?", args: [pend.google_id, pend.email, Date.now(), existing.id] });
    return finish(existing.id, existing.role);
  }
  // New account: drivers are owner-created, riders go through the pilot gate.
  if (wantRole === "driver") return res.status(403).json({ error: "Driver account sirf owner banata hai — owner se rabta karein" });
  let whitelistEntry = null;
  if (String((await getSettings()).pilot_mode) === "1") {
    const wl = await client.execute({ sql: "SELECT * FROM pilot_whitelist WHERE phone = ? AND role = ?", args: [cleanPhone, "rider"] });
    whitelistEntry = wl.rows.find((r) => r.status === "pending" || r.status === "approved") || null;
    if (!whitelistEntry) return res.status(403).json({ error: "Pilot registration sirf whitelist par hai — owner se rabta karein" });
    if (whitelistEntry.status === "pending") {
      const s = await getSettings();
      const cap = pilotCap("rider", s);
      const approvedCount = await client.execute({ sql: "SELECT COUNT(*) AS n FROM pilot_whitelist WHERE role = ? AND status = 'approved'", args: ["rider"] });
      if (Number(approvedCount.rows[0].n) >= cap) return res.status(403).json({ error: "Pilot limit poori ho gayi — registration band hai" });
    }
  }
  const r = await client.execute({
    sql: "INSERT INTO users(name, phone, role, password_hash, google_id, google_email, created_at) VALUES (?, ?, ?, '', ?, ?, ?)",
    args: [String(pend.name || "Google User").trim() || "Google User", cleanPhone, "rider", pend.google_id, pend.email, Date.now()],
  });
  const userId = Number(r.lastInsertRowid);
  await client.execute({ sql: "INSERT OR IGNORE INTO wallets(user_id, balance, updated_at) VALUES (?, 0, ?)", args: [userId, Date.now()] });
  await client.execute({ sql: "INSERT OR IGNORE INTO passengers(user_id, created_at) VALUES (?, ?)", args: [userId, Date.now()] });
  if (whitelistEntry) await client.execute({ sql: "UPDATE pilot_whitelist SET status='approved' WHERE id = ?", args: [whitelistEntry.id] });
  return finish(userId, "rider");
});

// APK return trip: the system browser hands a one-time token back to the
// app via an App Link. The token names the session the callback already
// created, so this page only sets the cookie inside the WebView.
app.get("/auth/google/done", async (req, res) => {
  const token = String(req.query.token || "");
  const ret = `/auth/google/return?token=${encodeURIComponent(token)}`;
  res.type("html").send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Chunian Ride — Google login</title><style>body{font-family:system-ui,sans-serif;background:#0D1748;color:#fff;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}main{max-width:420px}h1{font-size:22px}a{display:inline-block;margin-top:18px;background:#fff;color:#0D1748;font-weight:700;text-decoration:none;padding:14px 22px;border-radius:12px}p{opacity:.85;line-height:1.5}</style></head><body><main><h1>Google login ho gaya ✓</h1><p>Ab Chunian Ride app mein wapas jayein — aap login ho chuke hain.</p><a href="${ret}">Chunian Ride app mein kholein</a><p>App khud nahi khul rahi? App ko v2.5 par update karein, phir dobara koshish karein.</p></main><script>setTimeout(function(){location.href=${JSON.stringify(ret)};},900);</script></body></html>`);
});

app.get("/auth/google/return", async (req, res) => {
  const token = String(req.query.token || "");
  const row = token ? (await client.execute({ sql: "SELECT * FROM google_login_tokens WHERE token = ?", args: [token] })).rows[0] : null;
  if (!row || Date.now() - Number(row.created_at) > GOOGLE_TTL_MS) {
    return res.redirect(googleErrorRedirect("rider", "Google login ka waqt khatam — dobara koshish karein"));
  }
  await client.execute({ sql: "DELETE FROM google_login_tokens WHERE token = ?", args: [token] });
  setSessionCookie(res, req, row.session_id);
  res.redirect(roleHome(row.role === "driver" ? "driver" : "rider"));
});

// ---- Admin bootstrap + login ----
// ONE-TIME SETUP TOKEN (v2.0, replaces the fixed ADMIN_PIN "1234").
// - The token is a cryptographically random 64-hex-char string, generated
//   ONCE on first boot when no admin exists and no token hash is stored.
// - ONLY its SHA-256 hash is stored (settings key admin_setup_token_hash).
//   The token itself is NEVER written to any file, DB row, commit or API
//   response — it is printed exactly once to stdout (Render logs) so the
//   owner can copy it from there.
// - On later boots/restarts the stored hash is REUSED: no new token is
//   generated while a hash exists, so the token survives Render free-tier
//   sleep/wake cycles until it is used.
// - After a successful setup the hash is DELETED; the token stops working
//   and only phone + password admin login works.
// - RECOVERY if the token is lost from the logs: delete the stored hash
//   (Turso dashboard SQL: DELETE FROM settings WHERE key =
//   'admin_setup_token_hash';), then restart/redeploy the service — a fresh
//   token is generated and logged. Never share the token in chat/screenshots.
const SETUP_TOKEN_HASH_KEY = "admin_setup_token_hash";
function hashSetupToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
async function ensureSetupToken() {
  const admins = await client.execute("SELECT COUNT(*) AS n FROM admins");
  if (Number(admins.rows[0].n) > 0) {
    // An admin already exists: any leftover token hash is dead weight —
    // remove it so no stale bootstrap credential lingers.
    await client.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [SETUP_TOKEN_HASH_KEY] });
    return null;
  }
  const existing = await client.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [SETUP_TOKEN_HASH_KEY] });
  if (existing.rows.length) return null; // token already issued — survives restarts
  const token = crypto.randomBytes(32).toString("hex"); // 64 chars, 256-bit
  await client.execute({
    sql: "INSERT INTO settings(key, value) VALUES (?, ?)",
    args: [SETUP_TOKEN_HASH_KEY, hashSetupToken(token)],
  });
  // THE ONLY place the token ever appears. Owner-only: find it in the
  // Render dashboard -> chunian-ride service -> Logs, searching for
  // "ONE-TIME ADMIN SETUP CODE".
  console.log(`[chunian-ride] ONE-TIME ADMIN SETUP CODE: ${token} — use it once in /admin setup (field "One-time setup code"), then it stops working. Do NOT share it.`);
  return token;
}
async function verifySetupToken(pin) {
  const row = await client.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [SETUP_TOKEN_HASH_KEY] });
  if (!row.rows.length) return false;
  const stored = Buffer.from(String(row.rows[0].value), "utf8");
  const given = Buffer.from(hashSetupToken(pin || ""), "utf8");
  if (stored.length !== given.length) return false;
  return crypto.timingSafeEqual(stored, given);
}

// Does an admin account exist yet? (Public — only reveals existence.)
app.get("/api/admin/setup-needed", async (req, res) => {
  const c = await client.execute("SELECT COUNT(*) AS n FROM admins");
  res.json({ setup_needed: Number(c.rows[0].n) === 0 });
});

// One-time owner setup: the one-time setup code (printed once in the
// Render logs on first boot) is the bootstrap key. It works ONLY while no
// admin account exists AND the stored token hash has not been used; after
// that the code is dead and only phone + password logins work.
// Rate-limited: 5 wrong codes / 15 min per IP -> 429.
app.post("/api/admin/setup", setupRateLimit, async (req, res) => {
  const { pin, name, phone, password } = req.body || {};
  const c = await client.execute("SELECT COUNT(*) AS n FROM admins");
  if (Number(c.rows[0].n) > 0) return res.status(400).json({ error: "Admin account pehle se bana hua hai — login karein" });
  if (!(await verifySetupToken(pin))) { setupFailed(req); return res.status(401).json({ error: "Setup code ghalat hai" }); }
  if (!phone) return res.status(400).json({ error: "phone is required" });
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });
  const hash = await hashPassword(password);
  const r = await client.execute({
    sql: "INSERT INTO admins(name, phone, password_hash, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
    args: [String(name || "Owner").trim(), normalizePhone(phone), hash, now()],
  });
  // The one-time code dies with its first successful use.
  await client.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [SETUP_TOKEN_HASH_KEY] });
  setupSucceeded(req);
  const adminId = Number(r.lastInsertRowid);
  const sessionId = await createSession("admin", adminId, req.headers["user-agent"]);
  setSessionCookie(res, req, sessionId);
  res.json({ admin: { id: adminId, name: String(name || "Owner").trim(), phone: normalizePhone(phone), role: "owner" }, message: "Owner account ban gaya — ab se setup code kaam nahi karega, sirf phone + password login hoga." });
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
  // Pilot gate (v2.2): an approved driver whose documents are not all
  // verified cannot go online — approve is gated the same way, so this
  // also catches drivers approved before the gate existed.
  if (online) {
    const checklist = await getDocChecklist(client, num(req.params.id));
    if (!checklist.all) {
      return res.status(403).json({ error: "Driver ki documents verify nahi — pehle documents approve karwain" });
    }
  }
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
// v2.3: stale offers are expired first (lazy sweep); each request carries
// the real pickup distance/ETA from this driver's last GPS fix.
app.get("/api/drivers/:id/requests", requireAuth, requireSelfOrAdmin((req) => req.params.id), async (req, res) => {
  const d = await client.execute({ sql: "SELECT * FROM drivers WHERE user_id = ?", args: [num(req.params.id)] });
  if (!d.rows.length) return res.status(404).json({ error: "driver not found" });
  await expireStaleOffers(client);
  const rows = await client.execute({
    sql: `SELECT r.*, u.name AS rider_name, u.rating AS rider_rating, u.rating_count AS rider_rating_count
          FROM rides r JOIN users u ON u.id = r.rider_id
          WHERE r.status = 'requested' AND r.vehicle_type = ?
          ORDER BY r.created_at DESC`,
    args: [d.rows[0].vehicle_type],
  });
  const requests = rows.rows.map((r) => ({ ...r, ...computePickupDistance(d.rows[0], r) }));
  res.json({ requests, server_time_ms: now() });
});

// Shared top-up request creator (driver + rider — same manual JazzCash flow).
// Only CREATES a pending request; the wallet is credited ONLY on owner
// approval. Notifies all admins so the request is seen in their feed.
async function createTopupRequest(userId, userName, { amount, method, tid }) {
  const amt = num(amount, 0);
  const s = await getSettings();
  const minTopup = Number(s.min_topup || 500);
  if (amt < minTopup) throw new Error("minimum top-up not met");
  // Request + audit in ONE transaction: a top-up request must never exist
  // without its audit entry (v2.2 financial-audit completeness).
  const requestId = await withTx(async (tx) => {
    const r = await tx.execute({
      sql: "INSERT INTO topup_requests(driver_id, amount, method, tid, note, status, created_at) VALUES (?, ?, ?, ?, 'Wallet top-up request', 'pending', ?)",
      args: [num(userId), amt, method || "JazzCash", tid || "", now()],
    });
    const id = Number(r.lastInsertRowid);
    await writeAudit(tx, {
      actorId: num(userId), actorRole: "user", action: "topup_request",
      targetType: "topup_request", targetId: id,
      detail: `Top-up request Rs ${amt} (${method || "JazzCash"}, TID ${tid || "—"}) — pending owner approval`,
    });
    return id;
  });
  await notifyAdmins(client, { type: "topup_requested", params: { name: userName || "", amount: amt, method: method || "JazzCash", tid: tid || "" } });
  return { request_id: requestId, status: "pending", amount: amt, wallet_balance: await getWalletBalance(num(userId)) };
}

// Driver wallet top-up (JazzCash / Sadapay). G2 FIX: this only CREATES a
// pending request. The wallet is credited ONLY when the owner verifies the
// TID in his own JazzCash app and approves it (POST /api/admin/topups/:id/approve).
app.post("/api/drivers/:id/topup", requireAuth, requireSelfOrAdmin((req) => req.params.id), async (req, res) => {
  const { amount, method, tid } = req.body || {};
  const d = await client.execute({ sql: "SELECT * FROM drivers WHERE user_id = ?", args: [num(req.params.id)] });
  if (!d.rows.length) return res.status(404).json({ error: "driver not found" });
  try {
    const out = await createTopupRequest(num(req.params.id), req.auth.name, { amount, method, tid });
    res.json({ ...out, message: "Top-up request bhej di — balance tabhi barhe ga jab owner TID verify kar ke approve karega." });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Unified top-up (v2.1) — any logged-in user (rider OR driver) tops up
// their own wallet with the same manual JazzCash flow. The old
// /api/drivers/:id/topup route above still works for drivers.
app.post("/api/topup", requireAuth, async (req, res) => {
  if (req.auth.ownerType !== "user") return res.status(403).json({ error: "Sirf user account ka top-up yahan hota hai" });
  const { amount, method, tid } = req.body || {};
  try {
    const out = await createTopupRequest(req.auth.ownerId, req.auth.name, { amount, method, tid });
    res.json({ ...out, message: "Top-up request bhej di — balance tabhi barhe ga jab owner TID verify kar ke approve karega." });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
// v2.1: also returns the user's own top-up requests (pending + past) so the
// rider wallet screen can show top-up status like the driver screen does.
app.get("/api/wallet/me", requireAuth, async (req, res) => {
  if (req.auth.ownerType !== "user") return res.status(403).json({ error: "Sirf user account ka wallet yahan dikhta hai" });
  const tx = await client.execute({
    sql: "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    args: [req.auth.ownerId],
  });
  const pending = await client.execute({
    sql: "SELECT * FROM topup_requests WHERE driver_id = ? AND status = 'pending' ORDER BY created_at DESC",
    args: [req.auth.ownerId],
  });
  const past = await client.execute({
    sql: "SELECT * FROM topup_requests WHERE driver_id = ? AND status != 'pending' ORDER BY created_at DESC LIMIT 10",
    args: [req.auth.ownerId],
  });
  res.json({ balance: await getWalletBalance(req.auth.ownerId), transactions: tx.rows, pending_topups: pending.rows, past_topups: past.rows });
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
// Optional promo_code (v2.1): validated before booking; the discount lands
// in the ride's suggested fare AND in the seeded offers, so the agreed
// fare carries the discount. promo uses increment only on a successful
// booking (inside the same transaction, guarded against max_uses races).
app.post("/api/rides", requireAuth, async (req, res) => {
  const { rider_id, pickup, destination, vehicle, proposed_fare, distance_km, scheduled_for, promo_code, pickup_lat, pickup_lng } = req.body || {};
  if (req.auth.ownerType !== "user" || req.auth.role !== "rider" || req.auth.ownerId !== num(rider_id)) {
    return res.status(403).json({ error: "Sirf logged-in rider apni ride book kar sakta hai" });
  }
  if (!rider_id || !pickup || !destination || !VEHICLES.includes(vehicle)) {
    return res.status(400).json({ error: "rider_id, pickup, destination and vehicle are required" });
  }
  // Optional rider GPS pickup point (v2.3): stored on the ride and used for
  // the real pickup distance instead of the place-table coordinates.
  let plat = null, plng = null;
  if (pickup_lat != null || pickup_lng != null) {
    plat = Number(pickup_lat); plng = Number(pickup_lng);
    if (!Number.isFinite(plat) || !Number.isFinite(plng) || plat < -90 || plat > 90 || plng < -180 || plng > 180) {
      return res.status(400).json({ error: "valid pickup_lat/pickup_lng required" });
    }
  }
  // Pilot lock (v2.2): Chunian City only while pilot mode is ON.
  const s0 = await getSettings();
  const areaErr = pilotAreaError(s0, pickup, destination);
  if (areaErr) return res.status(400).json({ error: areaErr });
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
  const s = s0;
  const baseSuggested = fareFor(s, vehicle, km);
  let promo = null, discount = 0;
  if (promo_code) {
    try {
      promo = await validatePromo(client, promo_code);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    discount = promoDiscount(baseSuggested, promo);
  }
  const suggested = Math.max(1, baseSuggested - discount);
  const proposed = Math.max(1, num(proposed_fare, suggested));
  let rideId;
  try {
    rideId = await withTx(async (tx) => {
      const r = await tx.execute({
        sql: "INSERT INTO rides(rider_id, pickup, destination, distance_km, distance_estimated, vehicle_type, suggested_fare, proposed_fare, scheduled_for, promo_code, discount_amount, pickup_lat, pickup_lng, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?)",
        args: [num(rider_id), pickup, destination, km, estimated ? 1 : 0, vehicle, suggested, proposed, sched, promo ? promo.code : "", discount, plat, plng, now()],
      });
      const id = Number(r.lastInsertRowid);
      if (promo) {
        // Uses increment only on successful booking; the WHERE guard makes
        // a max_uses race fail the whole booking instead of over-issuing.
        const up = await tx.execute({
          sql: "UPDATE promo_codes SET uses = uses + 1 WHERE id = ? AND (max_uses = 0 OR uses < max_uses)",
          args: [promo.id],
        });
        if (Number(up.rowsAffected) !== 1) throw new Error("promo code has reached its maximum uses");
        // Financial audit (v2.2): the discount applied to this ride.
        await writeAudit(tx, {
          actorId: num(rider_id), actorRole: "user", action: "promo_applied",
          targetType: "ride", targetId: id,
          detail: `Promo ${promo.code}: discount Rs ${discount} on base fare Rs ${baseSuggested} (ride #${id})`,
        });
      }
      await writeRideHistory(tx, id, null, "requested", num(rider_id));
      return id;
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  // inDrive-style: every online, approved driver of this vehicle with a
  // non-negative wallet can see the request and make an offer. Seed offers
  // from them at the suggested fare (or the rider's proposal if higher).
  const drivers = await client.execute({
    sql: "SELECT d.user_id, u.name FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.status='approved' AND d.online=1 AND d.vehicle_type=? AND d.wallet_balance >= 0",
    args: [vehicle],
  });
  const offerFare = Math.max(suggested, proposed);
  // One timestamp for both columns so expires_at - created_at is exactly TTL.
  const offerT0 = now();
  const offerExpiresAt = offerT0 + OFFER_TTL_MS;
  for (const [i, drv] of drivers.rows.entries()) {
    await client.execute({
      sql: "INSERT INTO offers(ride_id, driver_id, fare, eta_min, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [rideId, drv.user_id, offerFare, 5 + i * 3, offerExpiresAt, offerT0],
    });
  }
  // v2.3: every eligible driver gets ONE new_ride_request notification for
  // this ride (dedupe: an existing notification of this type + ride_id for
  // that driver means "already notified" — a re-read never re-notifies).
  for (const drv of drivers.rows) {
    const ex = await client.execute({
      sql: "SELECT 1 AS x FROM notifications WHERE user_id = ? AND role = 'user' AND type = 'new_ride_request' AND ride_id = ? LIMIT 1",
      args: [Number(drv.user_id), rideId],
    });
    if (!ex.rows.length) {
      await notify(client, {
        userId: Number(drv.user_id), role: "user", type: "new_ride_request",
        params: { ride_id: rideId, pickup, destination, vehicle_type: vehicle, proposed_fare: proposed },
        rideId,
      });
    }
  }
  // Scheduled ride: the rider gets a confirmation, and every online approved
  // driver of this vehicle gets a heads-up (they see it in Requests too).
  if (sched) {
    const when = new Date(sched).toISOString();
    await notify(client, { userId: num(rider_id), role: "user", type: "scheduled_booked", params: { ride: rideId, when }, rideId });
    for (const drv of drivers.rows) {
      await notify(client, { userId: Number(drv.user_id), role: "user", type: "scheduled_request", params: { ride: rideId, pickup, destination, when }, rideId });
    }
  }
  res.json({ ride_id: rideId, suggested_fare: suggested, base_fare: baseSuggested, discount_amount: discount, promo_code: promo ? promo.code : null, proposed_fare: proposed, scheduled_for: sched, distance_km: km, distance_estimated: estimated, offers_created: drivers.rows.length });
});

app.get("/api/rides/:id", requireAuth, async (req, res) => {
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (!canViewRide(ride, req.auth)) return res.status(403).json({ error: "Ye ride aap ki nahi hai" });
  // v2.3: lazy sweep — past-due pending offers on this ride become
  // 'expired' before the client sees them; also runs the scheduled-ride
  // reminder sweep (guarded, best-effort) so a due reminder is not stuck
  // waiting for the 5-minute interval.
  await expireStaleOffers(client, num(req.params.id));
  await runScheduledReminders();
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
  // v2.3: real pickup distance for a driver caller (nulls for anyone else);
  // server_time_ms lets the client count the offer-expiry countdown down
  // from the server clock instead of the phone clock.
  let pickupDistance = { pickup_distance_km: null, pickup_distance_estimated: true, pickup_eta_min: null };
  if (req.auth.ownerType === "user") {
    const dRow = await client.execute({ sql: "SELECT lat, lng, loc_updated_at FROM drivers WHERE user_id = ?", args: [req.auth.ownerId] });
    if (dRow.rows.length) pickupDistance = computePickupDistance(dRow.rows[0], ride);
  }
  res.json({ ride, offers: visibleOffers, driver_location: driverLocation, server_time_ms: now(), ...pickupDistance });
});

// ---- In-ride chat (text only, rider <-> driver of this ride; no phone numbers) ----
// v2.3: GET supports ?after=<id>&limit=50 (default 50) for polling, marks
// the other party's messages as read (read_at) on fetch, and returns the
// caller's unread_count (computed BEFORE marking). Admins may read only.
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
  const after = num(req.query.after, 0);
  const limit = Math.max(1, Math.min(50, num(req.query.limit, 50)));
  // Unread count for the caller: the other party's messages not yet read.
  // Admins are read-only observers — their unread count is always 0.
  let unreadCount = 0;
  if (req.auth.ownerType === "user") {
    const u = await client.execute({
      sql: "SELECT COUNT(*) AS n FROM ride_messages WHERE ride_id = ? AND sender_id != ? AND read_at IS NULL",
      args: [num(req.params.id), req.auth.ownerId],
    });
    unreadCount = Number(u.rows[0].n);
    await client.execute({
      sql: "UPDATE ride_messages SET read_at = ? WHERE ride_id = ? AND sender_id != ? AND read_at IS NULL",
      args: [now(), num(req.params.id), req.auth.ownerId],
    });
  }
  const rows = await client.execute({
    sql: "SELECT id, sender_role, sender_id, message, created_at, read_at FROM ride_messages WHERE ride_id = ? AND id > ? ORDER BY created_at ASC LIMIT ?",
    args: [num(req.params.id), after, limit],
  });
  res.json({ messages: rows.rows, unread_count: unreadCount });
});

// ---- WebRTC call signalling (v2.3, server only — no media, no phone numbers) ----
// The matched rider + assigned driver exchange SDP/ICE through these rows
// while the ride is ACTIVE (accepted/ongoing). Signals older than 10
// minutes for the ride are pruned on every new signal.
const CALL_SIGNAL_KINDS = ["offer", "answer", "ice", "end"];
const CALL_ACTIVE_STATUSES = ["accepted", "ongoing"];
function canCallOnRide(ride, auth) {
  if (!auth || auth.ownerType !== "user") return false;
  if (ride.rider_id !== auth.ownerId && ride.driver_id !== auth.ownerId) return false;
  return CALL_ACTIVE_STATUSES.includes(ride.status);
}
app.post("/api/rides/:id/call-signal", requireAuth, async (req, res) => {
  const { kind, payload } = req.body || {};
  if (!CALL_SIGNAL_KINDS.includes(kind)) return res.status(400).json({ error: "kind must be offer, answer, ice or end" });
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return res.status(400).json({ error: "payload must be an object" });
  }
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > 8000) return res.status(400).json({ error: "payload is too large" });
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (!canCallOnRide(ride, req.auth)) return res.status(403).json({ error: "calls are only available to the rider or assigned driver of an active ride" });
  await client.execute({
    sql: "DELETE FROM call_signals WHERE ride_id = ? AND created_at < ?",
    args: [num(req.params.id), now() - CALL_SIGNAL_TTL_MS],
  });
  const ins = await client.execute({
    sql: "INSERT INTO call_signals(ride_id, sender_id, sender_role, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [num(req.params.id), req.auth.ownerId, req.auth.role || "", kind, payloadStr, now()],
  });
  res.json({ signal_id: Number(ins.lastInsertRowid) });
});
app.get("/api/rides/:id/call-signal", requireAuth, async (req, res) => {
  const after = num(req.query.after, 0);
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (!canCallOnRide(ride, req.auth)) return res.status(403).json({ error: "calls are only available to the rider or assigned driver of an active ride" });
  const rows = await client.execute({
    sql: "SELECT id, ride_id, sender_id, sender_role, kind, payload, created_at FROM call_signals WHERE ride_id = ? AND id > ? ORDER BY id ASC LIMIT 100",
    args: [num(req.params.id), after],
  });
  res.json({
    signals: rows.rows.map((s) => ({
      id: s.id, ride_id: s.ride_id, sender_id: s.sender_id, sender_role: s.sender_role,
      kind: s.kind, payload: JSON.parse(s.payload || "{}"), created_at: s.created_at,
    })),
  });
});

// ---- Web Push (v2.3, VAPID — free, no Firebase) ----
// User sessions only: push_subscriptions.user_id is a users.id. The public
// key is safe to hand out (the private key never leaves the server).
app.get("/api/push/public-key", requireAuth, async (req, res) => {
  const key = await getVapidPublicKey();
  if (!key) return res.status(503).json({ error: "push is not configured" });
  res.json({ public_key: key });
});
app.post("/api/push/subscribe", requireAuth, async (req, res) => {
  if (req.auth.ownerType !== "user") return res.status(403).json({ error: "Sirf user account push subscribe kar sakta hai" });
  const { endpoint, keys } = req.body || {};
  const ep = String(endpoint || "");
  // Web Push endpoints are always https: web-push sends over TLS even for
  // an http:// URL (it fails with an SSL error), so only https is accepted.
  if (!ep.startsWith("https://") || !keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string" || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: "endpoint (https) and keys.p256dh + keys.auth are required" });
  }
  // web-push rejects anything else at send time: p256dh must decode to a
  // 65-byte P-256 point and auth to 16 bytes. Reject garbage up front so a
  // bad subscription can never be stored.
  let p256, au;
  try { p256 = Buffer.from(keys.p256dh, "base64url"); au = Buffer.from(keys.auth, "base64url"); } catch { p256 = null; au = null; }
  if (!p256 || p256.length !== 65 || !au || au.length !== 16) {
    return res.status(400).json({ error: "keys.p256dh must be a 65-byte base64url key and keys.auth a 16-byte base64url secret" });
  }
  await client.execute({
    sql: "INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth",
    args: [req.auth.ownerId, ep, keys.p256dh, keys.auth, now()],
  });
  res.json({ ok: true, subscribed: true });
});
app.post("/api/push/unsubscribe", requireAuth, async (req, res) => {
  if (req.auth.ownerType !== "user") return res.status(403).json({ error: "Sirf user account push unsubscribe kar sakta hai" });
  const ep = String((req.body || {}).endpoint || "");
  if (!ep) return res.status(400).json({ error: "endpoint is required" });
  const r = await client.execute({
    sql: "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?",
    args: [ep, req.auth.ownerId],
  });
  res.json({ ok: true, removed: Number(r.rowsAffected) });
});

// ---- Client error reports (v2.3) ----
// The app posts JS errors here so the owner can see them. Lengths are
// capped by truncation (not rejection) except for an empty message.
app.post("/api/client-error", requireAuth, async (req, res) => {
  const { message, stack, url, user_agent } = req.body || {};
  const msg = String(message || "").trim();
  if (!msg) return res.status(400).json({ error: "message is required" });
  await client.execute({
    sql: "INSERT INTO client_errors(user_id, message, stack, url, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [
      req.auth.ownerType === "user" ? req.auth.ownerId : null,
      msg.slice(0, 2000),
      String(stack || "").slice(0, 4000),
      String(url || "").slice(0, 500),
      String(user_agent || req.headers["user-agent"] || "").slice(0, 500),
      now(),
    ],
  });
  res.status(201).json({ ok: true });
});
app.get("/api/admin/client-errors", requireAdmin, async (req, res) => {
  const rows = await client.execute({ sql: "SELECT * FROM client_errors ORDER BY created_at DESC LIMIT 100" });
  res.json({ client_errors: rows.rows });
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
  // v2.3: past-due offers are expired first — accepting an expired offer
  // is a 400, not a silent 404.
  await expireStaleOffers(client, num(req.params.id));
  const offerAny = await client.execute({
    sql: "SELECT * FROM offers WHERE id = ? AND ride_id = ?",
    args: [num(req.params.offerId), num(req.params.id)],
  });
  if (!offerAny.rows.length) return res.status(404).json({ error: "offer not found or no longer pending" });
  if (offerAny.rows[0].status === "expired" || (offerAny.rows[0].expires_at && Number(offerAny.rows[0].expires_at) < now())) {
    return res.status(400).json({ error: "offer has expired" });
  }
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
  await notify(client, { userId: Number(o.driver_id), role: "user", type: "ride_accepted", params: { ride: num(req.params.id), fare: Number(o.fare) }, rideId: num(req.params.id) });
  res.json({ ride_id: num(req.params.id), driver_id: o.driver_id, agreed_fare: o.fare });
});

// Driver accepts their OWN pending offer (v2.3, P0 fix — the old endpoint
// was rider-only, so driverAccept() in public/driver.js always got 403).
// NOTE for the frontend: driver.js must call THIS path, not /accept.
// One transaction: winning offer accepted, ride assigned, all other pending
// offers auto-declined, audit + ride-history rows, rider notified. Any
// second accept (same or another driver) after assignment -> 400.
app.post("/api/rides/:id/offers/:offerId/accept-driver", requireAuth, async (req, res, next) => {
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  if (req.auth.ownerType !== "user" || req.auth.role !== "driver") {
    return res.status(403).json({ error: "Sirf driver apni offer accept kar sakta hai" });
  }
  if (ride.status !== "requested") return res.status(400).json({ error: "ride is no longer open" });
  await expireStaleOffers(client, num(req.params.id));
  const offerAny = await client.execute({
    sql: "SELECT * FROM offers WHERE id = ? AND ride_id = ?",
    args: [num(req.params.offerId), num(req.params.id)],
  });
  if (!offerAny.rows.length) return res.status(404).json({ error: "offer not found or no longer pending" });
  const o = offerAny.rows[0];
  if (Number(o.driver_id) !== req.auth.ownerId) {
    return res.status(403).json({ error: "Sirf apni offer accept kar sakte hain" });
  }
  if (o.status === "expired" || (o.expires_at && Number(o.expires_at) < now())) {
    return res.status(400).json({ error: "offer has expired" });
  }
  if (o.status !== "pending") return res.status(400).json({ error: "offer is no longer pending" });
  try {
    await withTx(async (tx) => {
      const cur = await tx.execute({ sql: "SELECT status FROM rides WHERE id = ?", args: [num(req.params.id)] });
      if (!cur.rows.length || cur.rows[0].status !== "requested") throw new Error("ride is no longer open");
      const oc = await tx.execute({ sql: "SELECT status, expires_at FROM offers WHERE id = ?", args: [o.id] });
      if (!oc.rows.length || oc.rows[0].status !== "pending") throw new Error("offer is no longer pending");
      if (oc.rows[0].expires_at && Number(oc.rows[0].expires_at) < Date.now()) throw new Error("offer has expired");
      await tx.execute({ sql: "UPDATE offers SET status='accepted' WHERE id = ?", args: [o.id] });
      await tx.execute({ sql: "UPDATE offers SET status='declined' WHERE ride_id = ? AND id != ? AND status='pending'", args: [num(req.params.id), o.id] });
      await tx.execute({
        sql: "UPDATE rides SET driver_id = ?, agreed_fare = ?, status = 'accepted' WHERE id = ?",
        args: [o.driver_id, o.fare, num(req.params.id)],
      });
      await writeRideHistory(tx, num(req.params.id), "requested", "accepted", o.driver_id);
      await writeAudit(tx, {
        actorId: Number(o.driver_id), actorRole: "driver", action: "driver_accept",
        targetType: "ride", targetId: num(req.params.id),
        detail: `Driver #${o.driver_id} accepted own offer Rs ${o.fare} on ride #${req.params.id}`,
      });
    });
  } catch (e) {
    if (["ride is no longer open", "offer is no longer pending", "offer has expired"].includes(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    return next(e);
  }
  await notify(client, { userId: Number(ride.rider_id), role: "user", type: "ride_accepted", params: { ride: num(req.params.id), fare: Number(o.fare) }, rideId: num(req.params.id) });
  res.json({ ride_id: num(req.params.id), driver_id: o.driver_id, agreed_fare: o.fare, accepted_by: "driver" });
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
  // One timestamp for both columns so expires_at - created_at is exactly TTL.
  const t0 = now();
  const r = await client.execute({
    sql: "INSERT INTO offers(ride_id, driver_id, fare, eta_min, expires_at, created_at) VALUES (?, ?, ?, 5, ?, ?)",
    args: [num(req.params.id), num(driver_id), f, t0 + OFFER_TTL_MS, t0],
  });
  await notify(client, { userId: Number(ride.rider_id), role: "user", type: "offer_received", params: { ride: num(req.params.id), driver: req.auth.name || "", fare: f }, rideId: num(req.params.id) });
  res.json({ offer_id: Number(r.lastInsertRowid), fare: f });
});

// Driver declines a request — no penalty, ever.
// v2.3: declining an already-expired offer is a 400 ("offer has expired");
// declining while a pending offer exists still declines it (200).
app.post("/api/rides/:id/decline", requireAuth, async (req, res) => {
  const { driver_id } = req.body || {};
  if (req.auth.ownerType !== "user" || req.auth.ownerId !== num(driver_id)) {
    return res.status(403).json({ error: "Sirf apne naam se decline kar sakte hain" });
  }
  await expireStaleOffers(client, num(req.params.id));
  const pending = await client.execute({
    sql: "SELECT 1 AS x FROM offers WHERE ride_id = ? AND driver_id = ? AND status = 'pending' LIMIT 1",
    args: [num(req.params.id), num(driver_id)],
  });
  if (!pending.rows.length) {
    const expired = await client.execute({
      sql: "SELECT 1 AS x FROM offers WHERE ride_id = ? AND driver_id = ? AND status = 'expired' LIMIT 1",
      args: [num(req.params.id), num(driver_id)],
    });
    if (expired.rows.length) return res.status(400).json({ error: "offer has expired" });
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
  await notify(client, { userId: Number(ride.rider_id), role: "user", type: "ride_started", params: { ride: num(req.params.id) }, rideId: num(req.params.id) });
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
      // Financial audit (v2.2): the fare settlement + commission deduction.
      await writeAudit(tx, {
        actorId: driverId, actorRole: "driver", action: "ride_settlement",
        targetType: "ride", targetId: num(req.params.id),
        detail: `Ride #${req.params.id} completed — fare Rs ${fare}, commission Rs ${take} deducted, driver kept Rs ${fare - take}`,
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
  await notify(client, { userId: Number(ride.rider_id), role: "user", type: "ride_completed", params: { ride: num(req.params.id), fare }, rideId: num(req.params.id) });
  await notify(client, { userId: Number(driverId), role: "user", type: "trip_completed", params: { ride: num(req.params.id), fare, kept: fare - take }, rideId: num(req.params.id) });
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
  const reason = String((req.body || {}).reason || "").slice(0, 200);
  await withTx(async (tx) => {
    await tx.execute({ sql: "UPDATE rides SET status='cancelled', cancel_reason = ? WHERE id = ?", args: [reason, num(req.params.id)] });
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
  // Financial audit (v2.2): the tip is recorded even though no wallet
  // balance moves (cash, 100% driver).
  await writeAudit(client, {
    actorId: num(rider_id), actorRole: "user", action: "tip_recorded",
    targetType: "ride", targetId: num(req.params.id),
    detail: `Tip Rs ${tip} on ride #${req.params.id} (cash, 100% driver, no commission)`,
  });
  await notify(client, { userId: Number(ride.driver_id), role: "user", type: "tip_received", params: { ride: num(req.params.id), tip }, rideId: num(req.params.id) });
  res.json({ ride_id: num(req.params.id), tip, commission_on_tip: 0, note: "Tip 100% driver ko — is par koi commission nahi." });
});

// Rate driver (by rider) or rate rider (by driver).
app.post("/api/rides/:id/rate", requireAuth, async (req, res) => {
  const { by, stars } = req.body || {};
  const s = Math.max(1, Math.min(5, num(stars, 5)));
  const ride = await loadRideOr404(req, res);
  if (!ride) return;
  // Ratings only count for finished trips — a rating on a requested,
  // accepted, ongoing or cancelled ride would be meaningless (and could be
  // abused to tank a driver's rating before the trip even happens).
  if (ride.status !== "completed") return res.status(400).json({ error: "rating can only be given after the ride is completed" });
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
  // SOS must reach the owner immediately: admin notification + audit entry
  // (v2.2 — the old handler only stored the complaint row).
  await notifyAdmins(client, { type: "sos_alert", params: { ride: num(req.params.id), message: message || "SOS pressed" }, rideId: num(req.params.id) });
  await writeAudit(client, {
    actorId: req.auth.ownerId, actorRole: req.auth.ownerType === "admin" ? "admin" : "user",
    action: "sos_alert", targetType: "ride", targetId: num(req.params.id),
    detail: `SOS on ride #${req.params.id}: ${message || "SOS pressed"}`,
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
  // Per-driver document checklist (v2.2, expiry-aware since v2.3): the
  // admin list shows CNIC / licence / vehicle ✓/✗ without opening each
  // driver's documents. An expired document does NOT count as approved.
  const drivers = [];
  for (const x of rows.rows) {
    const cl = await getDocChecklist(client, x.user_id);
    drivers.push({ ...x, doc_checklist: { cnic: cl.cnic, licence: cl.licence, vehicle: cl.vehicle, all: cl.all, expired: cl.expired, expires_soon: cl.expires_soon } });
  }
  res.json({ drivers });
});

app.post("/api/admin/drivers/:id/approve", requireAdmin, async (req, res) => {
  // Document verification gate (v2.2): CNIC + licence + vehicle must ALL
  // be approved before a driver can be activated. Fails with the missing
  // list so the owner knows exactly what is left.
  const checklist = await getDocChecklist(client, num(req.params.id));
  if (!checklist.all) {
    return res.status(400).json({
      error: `Driver ki documents verify nahi — missing: ${checklist.missing.join(", ")}. Pehle documents approve karein.`,
      missing_docs: checklist.missing,
      doc_checklist: { cnic: checklist.cnic, licence: checklist.licence, vehicle: checklist.vehicle },
    });
  }
  await client.execute({ sql: "UPDATE drivers SET status='approved', documents_status='approved' WHERE user_id = ?", args: [num(req.params.id)] });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "driver_approve", targetType: "driver", targetId: num(req.params.id), detail: "Driver documents approved" });
  await notify(client, { userId: num(req.params.id), role: "user", type: "driver_approved", params: {} });
  res.json({ status: "approved" });
});

app.post("/api/admin/drivers/:id/block", requireAdmin, async (req, res) => {
  await client.execute({ sql: "UPDATE drivers SET status='blocked', online=0 WHERE user_id = ?", args: [num(req.params.id)] });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "driver_block", targetType: "driver", targetId: num(req.params.id), detail: "Driver blocked" });
  await notify(client, { userId: num(req.params.id), role: "user", type: "driver_blocked", params: {} });
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
  const c = await client.execute({ sql: "SELECT * FROM complaints WHERE id = ?", args: [num(req.params.id)] });
  await client.execute({ sql: "UPDATE complaints SET status='resolved' WHERE id = ?", args: [num(req.params.id)] });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "complaint_resolve", targetType: "complaint", targetId: num(req.params.id), detail: "Complaint resolved" });
  if (c.rows.length && c.rows[0].user_id) {
    await notify(client, { userId: Number(c.rows[0].user_id), role: "user", type: "complaint_resolved", params: { id: num(req.params.id) } });
  }
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
  const pendingWithdrawals = await one("SELECT COUNT(*) AS n FROM withdrawals WHERE status = 'pending'");
  const openComplaints = await one("SELECT COUNT(*) AS n FROM complaints WHERE status = 'open'");
  const pendingDrivers = await one("SELECT COUNT(*) AS n FROM drivers WHERE status = 'pending'");
  const rev7d = await one("SELECT COALESCE(SUM(commission_charged), 0) AS n FROM rides WHERE status = 'completed' AND completed_at >= ?", [weekAgo]);
  const revToday = await one("SELECT COALESCE(SUM(commission_charged), 0) AS n FROM rides WHERE status = 'completed' AND completed_at >= ?", [dayAgo]);
  res.json({
    totals: { users, riders, drivers, drivers_online: driversOnline, rides_today: ridesToday, rides_total: ridesTotal, completed_today: completedToday },
    pending_topups: pendingTopups,
    pending_withdrawals: pendingWithdrawals,
    open_complaints: openComplaints,
    pending_drivers: pendingDrivers,
    platform_revenue_7d: rev7d,
    platform_revenue_today: revToday,
  });
});

// ---- Pilot live monitoring + pilot report (v2.2) ----
// Live board for the controlled pilot: who is in, what is happening right
// now, what needs the owner's attention. Admin-only.
app.get("/api/admin/pilot-status", requireAdmin, async (req, res) => {
  const s = await getSettings();
  const dayAgo = now() - 86400000;
  const one = async (sql, args = []) => Number((await client.execute({ sql, args })).rows[0].n);
  const rideRows = await client.execute({
    sql: "SELECT status, COUNT(*) AS n FROM rides WHERE created_at >= ? GROUP BY status",
    args: [dayAgo],
  });
  const ridesToday = { requested: 0, accepted: 0, ongoing: 0, completed: 0, cancelled: 0, failed: 0 };
  for (const r of rideRows.rows) if (r.status in ridesToday) ridesToday[r.status] = Number(r.n);
  // "Failed" bookings = cancelled + requests sitting unfulfilled for >1h.
  const staleRequested = await one("SELECT COUNT(*) AS n FROM rides WHERE status = 'requested' AND created_at < ?", [now() - 3600000]);
  ridesToday.failed = ridesToday.cancelled + staleRequested;
  const openSos = await client.execute({
    sql: "SELECT c.*, u.name AS user_name, u.phone AS user_phone FROM complaints c LEFT JOIN users u ON u.id = c.user_id WHERE c.status = 'open' AND c.kind = 'sos' ORDER BY c.created_at DESC LIMIT 20",
  });
  const refundRows = await client.execute({
    sql: "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'refund' AND created_at >= ?",
    args: [dayAgo],
  });
  const walletRows = await client.execute({
    sql: "SELECT u.role AS role, COALESCE(SUM(w.balance), 0) AS total FROM wallets w JOIN users u ON u.id = w.user_id GROUP BY u.role",
  });
  const wallets = { drivers: 0, riders: 0, total: 0 };
  for (const w of walletRows.rows) {
    const total = Number(w.total);
    if (w.role === "driver") wallets.drivers = total;
    else if (w.role === "rider") wallets.riders = total;
    wallets.total += total;
  }
  res.json({
    pilot_mode: String(s.pilot_mode) === "1",
    pilot_chunian_only: String(s.pilot_chunian_only) === "1",
    caps: { drivers: pilotCap("driver", s), riders: pilotCap("rider", s) },
    drivers: {
      whitelisted: await one("SELECT COUNT(*) AS n FROM pilot_whitelist WHERE role = 'driver' AND status IN ('pending','approved')"),
      signed_up: await one("SELECT COUNT(*) AS n FROM pilot_whitelist WHERE role = 'driver' AND status = 'approved'"),
      verified: await one("SELECT COUNT(*) AS n FROM drivers WHERE documents_status = 'approved'"),
      approved: await one("SELECT COUNT(*) AS n FROM drivers WHERE status = 'approved'"),
      online: await one("SELECT COUNT(*) AS n FROM drivers WHERE online = 1 AND status = 'approved'"),
      pending_approval: await one("SELECT COUNT(*) AS n FROM drivers WHERE status = 'pending'"),
    },
    riders: {
      whitelisted: await one("SELECT COUNT(*) AS n FROM pilot_whitelist WHERE role = 'rider' AND status IN ('pending','approved')"),
      signed_up: await one("SELECT COUNT(*) AS n FROM pilot_whitelist WHERE role = 'rider' AND status = 'approved'"),
    },
    rides_today: ridesToday,
    open_complaints: await one("SELECT COUNT(*) AS n FROM complaints WHERE status = 'open' AND kind = 'complaint'"),
    open_sos: openSos.rows,
    pending: {
      topups: await one("SELECT COUNT(*) AS n FROM topup_requests WHERE status = 'pending'"),
      withdrawals: await one("SELECT COUNT(*) AS n FROM withdrawals WHERE status = 'pending'"),
      refunds_today: Number(refundRows.rows[0].n),
      refunds_today_total: Number(refundRows.rows[0].total),
    },
    wallets,
  });
});

// Post-pilot report data (v2.2): completed rides, failed/cancelled bookings
// with reasons, ratings, complaints + feedback, financial totals, and a
// reconciliation check (wallet ledger vs expected from rides/transactions).
// Aggregates ONLY real data — it never invents feedback.
app.get("/api/admin/pilot-report", requireAdmin, async (req, res) => {
  const days = num(req.query.days, 7);
  const since = now() - days * 86400000;
  const one = async (sql, args = []) => Number((await client.execute({ sql, args })).rows[0].n);

  const rideAgg = await client.execute({
    sql: "SELECT status, COUNT(*) AS n, COALESCE(SUM(agreed_fare), 0) AS gross, COALESCE(SUM(commission_charged), 0) AS fees, COALESCE(SUM(tip_amount), 0) AS tips FROM rides WHERE created_at >= ? GROUP BY status",
    args: [since],
  });
  const byStatus = {};
  let completed = 0, grossFares = 0, commissionEarned = 0, tipsTotal = 0;
  for (const r of rideAgg.rows) {
    byStatus[r.status] = Number(r.n);
    if (r.status === "completed") {
      completed = Number(r.n);
      grossFares = Number(r.gross);
      commissionEarned = Number(r.fees);
      tipsTotal = Number(r.tips);
    }
  }
  const byVehicle = await client.execute({
    sql: "SELECT vehicle_type, COUNT(*) AS n, COALESCE(SUM(agreed_fare), 0) AS gross FROM rides WHERE status = 'completed' AND completed_at >= ? GROUP BY vehicle_type",
    args: [since],
  });
  const cancelled = await client.execute({
    sql: `SELECT r.*, u.name AS rider_name, d.name AS driver_name FROM rides r
          JOIN users u ON u.id = r.rider_id LEFT JOIN users d ON d.id = r.driver_id
          WHERE r.status = 'cancelled' AND r.created_at >= ? ORDER BY r.created_at DESC LIMIT 100`,
    args: [since],
  });
  const stale = await client.execute({
    sql: `SELECT r.*, u.name AS rider_name FROM rides r JOIN users u ON u.id = r.rider_id
          WHERE r.status = 'requested' AND r.created_at < ? AND r.created_at >= ? ORDER BY r.created_at DESC LIMIT 100`,
    args: [now() - 3600000, since],
  });
  const byDriver = await client.execute({
    sql: `SELECT u.id AS driver_id, u.name, AVG(r.rating_driver) AS avg_rating, COUNT(r.rating_driver) AS rating_count
          FROM rides r JOIN users u ON u.id = r.driver_id
          WHERE r.status = 'completed' AND r.rating_driver IS NOT NULL AND r.created_at >= ?
          GROUP BY u.id ORDER BY avg_rating DESC`,
    args: [since],
  });
  const ratings = await client.execute({
    sql: `SELECT r.id AS ride_id, r.rating_driver, r.rating_rider, ru.name AS rider_name, du.name AS driver_name, r.completed_at
          FROM rides r JOIN users ru ON ru.id = r.rider_id LEFT JOIN users du ON du.id = r.driver_id
          WHERE r.status = 'completed' AND (r.rating_driver IS NOT NULL OR r.rating_rider IS NOT NULL) AND r.created_at >= ?
          ORDER BY r.completed_at DESC LIMIT 100`,
    args: [since],
  });
  const complaints = await client.execute({
    sql: `SELECT c.*, u.name AS user_name FROM complaints c LEFT JOIN users u ON u.id = c.user_id
          WHERE c.created_at >= ? ORDER BY c.created_at DESC LIMIT 100`,
    args: [since],
  });
  const finRows = await client.execute({
    sql: "SELECT type, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM transactions WHERE created_at >= ? GROUP BY type",
    args: [since],
  });
  const finByType = {};
  for (const f of finRows.rows) finByType[f.type] = { count: Number(f.n), total: Number(f.total) };

  // ---- Reconciliation (all-time — ledger integrity, not just the period) ----
  const walletRows = await client.execute({
    sql: "SELECT w.user_id, w.balance, COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.user_id = w.user_id), 0) AS ledger_sum FROM wallets w",
  });
  const walletMismatches = walletRows.rows
    .filter((r) => Number(r.balance) !== Number(r.ledger_sum))
    .map((r) => ({ user_id: Number(r.user_id), wallet_balance: Number(r.balance), ledger_sum: Number(r.ledger_sum), difference: Number(r.balance) - Number(r.ledger_sum) }));
  const commTx = await one("SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE type = 'commission'");
  const commRides = await one("SELECT COALESCE(SUM(commission_charged), 0) AS n FROM rides WHERE status = 'completed'");
  // Top-ups: seeded demo starting balances live in the ledger (migrated
  // from wallet_tx) but were never top-up REQUESTS — compare non-demo
  // users only, on both sides.
  const topupTx = await one("SELECT COALESCE(SUM(t.amount), 0) AS n FROM transactions t JOIN users u ON u.id = t.user_id WHERE t.type = 'topup' AND u.demo = 0");
  const topupApproved = await one("SELECT COALESCE(SUM(r.amount), 0) AS n FROM topup_requests r JOIN users u ON u.id = r.driver_id WHERE r.status = 'approved' AND u.demo = 0");
  const wdNet = await one("SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE type IN ('withdrawal_hold','withdrawal_refund')");
  const wdExpected = -await one("SELECT COALESCE(SUM(amount), 0) AS n FROM withdrawals WHERE status IN ('pending','approved')");
  const refundTxCount = await one("SELECT COUNT(*) AS n FROM transactions WHERE type = 'refund'");
  const refundAuditCount = await one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'refund_credit'");
  const tipTxCount = await one("SELECT COUNT(*) AS n FROM transactions WHERE type = 'tip'");
  const checks = [
    { name: "wallet_vs_ledger", expected: 0, actual: walletMismatches.length, difference: walletMismatches.length, ok: walletMismatches.length === 0, detail: walletMismatches.length ? `${walletMismatches.length} wallet(s) differ from their ledger` : "Every wallet balance equals its transaction ledger sum" },
    { name: "commission", expected: -commRides, actual: commTx, difference: commTx - (-commRides), ok: commTx === -commRides, detail: `Commission debited Rs ${commTx} vs rides charged Rs ${commRides}` },
    { name: "topups", expected: topupApproved, actual: topupTx, difference: topupTx - topupApproved, ok: topupTx === topupApproved, detail: `Top-up credits Rs ${topupTx} vs approved requests Rs ${topupApproved} (non-demo users; seeded demo balances excluded)` },
    { name: "withdrawals", expected: wdExpected, actual: wdNet, difference: wdNet - wdExpected, ok: wdNet === wdExpected, detail: `Withdrawal ledger net Rs ${wdNet} vs expected Rs ${wdExpected}` },
    { name: "refunds", expected: refundAuditCount, actual: refundTxCount, difference: refundTxCount - refundAuditCount, ok: refundTxCount === refundAuditCount, detail: `${refundTxCount} refund transactions vs ${refundAuditCount} refund audit entries` },
    { name: "tips_not_in_wallet", expected: 0, actual: tipTxCount, difference: tipTxCount, ok: tipTxCount === 0, detail: "Tips are cash — none should appear in the wallet ledger" },
  ];
  const discrepancies = checks.filter((c) => !c.ok);

  res.json({
    days,
    generated_at: now(),
    rides: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), completed, by_status: byStatus, by_vehicle: byVehicle.rows },
    cancelled_bookings: cancelled.rows,
    failed_bookings: stale.rows,
    ratings_by_driver: byDriver.rows.map((r) => ({ driver_id: Number(r.driver_id), name: r.name, avg_rating: Number(r.avg_rating), rating_count: Number(r.rating_count) })),
    feedback: { ratings: ratings.rows, complaints: complaints.rows },
    complaints: {
      open: complaints.rows.filter((c) => c.status === "open").length,
      resolved: complaints.rows.filter((c) => c.status === "resolved").length,
    },
    financials: {
      gross_fares: grossFares,
      commission_earned: commissionEarned,
      tips: tipsTotal,
      by_transaction_type: finByType,
    },
    reconciliation: { checks, discrepancies, wallet_mismatches: walletMismatches },
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

// ---- Pilot whitelist (v2.2) — admin-only ----
// While pilot_mode is ON, ONLY these phones may sign up. Caps: 10 drivers,
// 20 riders (settings pilot_max_drivers / pilot_max_riders). Adding beyond
// a cap is rejected; signup re-checks the live count as a second layer.
app.get("/api/admin/pilot-whitelist", requireAdmin, async (req, res) => {
  const s = await getSettings();
  const rows = await client.execute({ sql: "SELECT * FROM pilot_whitelist ORDER BY role, created_at DESC" });
  const count = async (role, status) =>
    Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM pilot_whitelist WHERE role = ? AND status = ?", args: [role, status] })).rows[0].n);
  res.json({
    pilot_mode: String(s.pilot_mode) === "1",
    caps: { drivers: pilotCap("driver", s), riders: pilotCap("rider", s) },
    counts: {
      drivers_pending: await count("driver", "pending"), drivers_approved: await count("driver", "approved"),
      riders_pending: await count("rider", "pending"), riders_approved: await count("rider", "approved"),
    },
    whitelist: rows.rows,
  });
});

app.post("/api/admin/pilot-whitelist", requireAdmin, async (req, res) => {
  const { phone, role } = req.body || {};
  const wantRole = role === "driver" ? "driver" : "rider";
  const cleanPhone = normalizePhone(phone || "");
  if (!cleanPhone) return res.status(400).json({ error: "phone is required" });
  const s = await getSettings();
  const cap = pilotCap(wantRole, s);
  const existing = await client.execute({
    sql: "SELECT * FROM pilot_whitelist WHERE phone = ? AND role = ?",
    args: [cleanPhone, wantRole],
  });
  if (existing.rows.length && existing.rows[0].status !== "revoked") {
    return res.status(409).json({ error: "Is phone par whitelist entry pehle se hai" });
  }
  const live = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM pilot_whitelist WHERE role = ? AND status IN ('pending','approved')",
    args: [wantRole],
  });
  if (Number(live.rows[0].n) >= cap) {
    return res.status(400).json({
      error: wantRole === "driver"
        ? "Pilot driver limit poori ho gayi — mazeed drivers add nahi ho sakte"
        : "Pilot rider limit poori ho gayi — mazeed riders add nahi ho sakte",
    });
  }
  let entryId;
  if (existing.rows.length) {
    // Revoked entry re-invited: flip it back to pending.
    await client.execute({ sql: "UPDATE pilot_whitelist SET status='pending', added_by=?, created_at=? WHERE id=?", args: [req.auth.ownerId, now(), existing.rows[0].id] });
    entryId = Number(existing.rows[0].id);
  } else {
    const r = await client.execute({
      sql: "INSERT INTO pilot_whitelist(phone, role, status, added_by, created_at) VALUES (?, ?, 'pending', ?, ?)",
      args: [cleanPhone, wantRole, req.auth.ownerId, now()],
    });
    entryId = Number(r.lastInsertRowid);
  }
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "whitelist_add", targetType: "pilot_whitelist", targetId: entryId, detail: `Whitelisted ${cleanPhone} as ${wantRole} (pilot cap ${cap})` });
  res.json({ entry_id: entryId, phone: cleanPhone, role: wantRole, status: "pending" });
});

app.delete("/api/admin/pilot-whitelist/:id", requireAdmin, async (req, res) => {
  const row = await client.execute({ sql: "SELECT * FROM pilot_whitelist WHERE id = ?", args: [num(req.params.id)] });
  if (!row.rows.length) return res.status(404).json({ error: "whitelist entry not found" });
  const e = row.rows[0];
  await client.execute({ sql: "DELETE FROM pilot_whitelist WHERE id = ?", args: [num(req.params.id)] });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "whitelist_remove", targetType: "pilot_whitelist", targetId: num(req.params.id), detail: `Removed ${e.phone} (${e.role}) from the pilot whitelist` });
  res.json({ ok: true, removed: num(req.params.id) });
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

// Promo codes (v2.1) — discounts now apply in /api/fare and /api/rides.
// Percent or fixed, with optional date range and max_uses.
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

// Audit log with filters (v2.2): action type, actor (user/admin id),
// date range (epoch ms). Limit 500 rows per read; the CSV export below
// shares the same filter builder.
function auditFilterSql(req) {
  const { action, actor_id, from, to } = req.query || {};
  let sql = "SELECT * FROM audit_log WHERE 1=1";
  const args = [];
  if (action) { sql += " AND action = ?"; args.push(String(action)); }
  if (actor_id) { sql += " AND actor_id = ?"; args.push(num(actor_id)); }
  if (from) { sql += " AND created_at >= ?"; args.push(num(from)); }
  if (to) { sql += " AND created_at <= ?"; args.push(num(to)); }
  return { sql, args };
}
app.get("/api/admin/audit-log", requireAdmin, async (req, res) => {
  const { sql, args } = auditFilterSql(req);
  const rows = await client.execute({ sql: sql + " ORDER BY created_at DESC LIMIT 500", args });
  res.json({ audit_log: rows.rows });
});

// CSV export of the audit log (v2.2, admin-only): same filters as the
// list endpoint. Every financial mutation is in here — top-ups, withdrawals,
// refunds, ride settlements, tips, promo discounts, SOS alerts, pilot toggles.
app.get("/api/admin/audit-log/export", requireAdmin, async (req, res) => {
  const { sql, args } = auditFilterSql(req);
  const rows = await client.execute({ sql: sql + " ORDER BY created_at ASC LIMIT 5000", args });
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [["id", "created_at", "created_iso", "actor_id", "actor_role", "action", "target_type", "target_id", "detail"].join(",")];
  for (const a of rows.rows) {
    lines.push([a.id, a.created_at, new Date(Number(a.created_at)).toISOString(), a.actor_id, a.actor_role, a.action, a.target_type, a.target_id, a.detail].map(esc).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="chunian-ride-audit-log.csv"');
  res.send(lines.join("\n"));
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
  const allowed = ["rate_bike_per_km", "rate_rickshaw_per_km", "rate_car_per_km", "rate_ac_car_per_km", "min_bike", "min_rickshaw", "min_car", "min_ac_car", "commission_pct", "booking_fee", "sadapay_number", "jazzcash_number", "support_phone", "support_whatsapp", "min_topup", "min_withdrawal", "pilot_mode", "pilot_max_drivers", "pilot_max_riders", "pilot_chunian_only", "owner_name"];
  const before = await getSettings();
  const changed = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      let value = String(req.body[key]);
      // Pilot keys are validated: mode flags are "0"/"1", caps are
      // non-negative integers. A bad value is rejected, not stored.
      if (key === "pilot_mode" || key === "pilot_chunian_only") {
        if (value !== "0" && value !== "1") return res.status(400).json({ error: "pilot_mode must be 0 or 1" });
      }
      if (key === "pilot_max_drivers" || key === "pilot_max_riders") {
        const n = Math.floor(Number(value));
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "pilot cap must be a number" });
        value = String(n);
      }
      // v2.3: owner_name is editable from admin settings now — non-empty,
      // capped at 100 chars; an empty value is rejected, not stored.
      if (key === "owner_name") {
        value = value.trim().slice(0, 100);
        if (!value) return res.status(400).json({ error: "owner_name must not be empty" });
      }
      await client.execute({
        sql: "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        args: [key, value],
      });
      changed.push(`${key}=${value}`);
    }
  }
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "settings_change", targetType: "settings", targetId: null, detail: changed.join(", ") });
  // Pilot mode toggle gets its own audit entry (v2.2): turning public
  // registration on/off must always be traceable.
  if (req.body.pilot_mode !== undefined && String(before.pilot_mode) !== String(req.body.pilot_mode)) {
    await writeAudit(client, {
      actorId: req.auth.ownerId, actorRole: "admin", action: "pilot_mode_toggle",
      targetType: "settings", targetId: null,
      detail: `Pilot mode ${before.pilot_mode} -> ${req.body.pilot_mode} (${String(req.body.pilot_mode) === "1" ? "public signup CLOSED, whitelist only" : "public signup OPEN"})`,
    });
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

// ---- Withdrawals (v2.1) ----
// Driver requests cash out of the prepaid wallet. The amount is HELD
// (deducted from the wallet + ledger row "withdrawal_hold") at request
// time. Approve = the owner pays manually on JazzCash outside the app
// (no gateway); the hold simply stays deducted. Reject = the hold is
// auto-refunded to the wallet. Double approve/reject fails (status guard).
app.post("/api/drivers/me/withdraw", requireAuth, async (req, res) => {
  if (req.auth.ownerType !== "user" || req.auth.role !== "driver") {
    return res.status(403).json({ error: "Sirf driver apni withdrawal bhej sakta hai" });
  }
  const { amount, jazzcash_number, driver_id } = req.body || {};
  // A driver can only ever withdraw from their OWN wallet: a body driver_id
  // that does not match the session is rejected outright.
  if (driver_id != null && num(driver_id) !== req.auth.ownerId) {
    return res.status(403).json({ error: "Sirf apni withdrawal bhej sakte hain" });
  }
  const amt = Math.round(num(amount, 0));
  const s = await getSettings();
  const minW = Number(s.min_withdrawal || 100);
  const jazz = String(jazzcash_number || "").trim();
  if (amt < minW) return res.status(400).json({ error: "minimum withdrawal not met" });
  if (!jazz || jazz.replace(/\D/g, "").length < 10) return res.status(400).json({ error: "JazzCash number is required" });
  let out;
  try {
    out = await withTx(async (tx) => {
      const d = await tx.execute({ sql: "SELECT * FROM drivers WHERE user_id = ?", args: [req.auth.ownerId] });
      if (!d.rows.length) throw new Error("driver not found");
      const balRows = await tx.execute({ sql: "SELECT balance FROM wallets WHERE user_id = ?", args: [req.auth.ownerId] });
      const balance = balRows.rows.length ? Number(balRows.rows[0].balance) : 0;
      if (amt > balance) throw new Error("withdrawal amount is more than your wallet balance");
      const newBal = await adjustWallet(tx, req.auth.ownerId, -amt, {
        type: "withdrawal_hold",
        method: "JazzCash",
        note: `Withdrawal request — hold Rs ${amt} to JazzCash ${jazz}`,
      });
      const r = await tx.execute({
        sql: "INSERT INTO withdrawals(driver_id, amount, jazzcash_number, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
        args: [req.auth.ownerId, amt, jazz, now()],
      });
      const requestId = Number(r.lastInsertRowid);
      await writeAudit(tx, {
        actorId: req.auth.ownerId, actorRole: "driver", action: "withdrawal_request",
        targetType: "withdrawal", targetId: requestId,
        detail: `Withdrawal request Rs ${amt} to JazzCash ${jazz} (hold deducted from wallet)`,
      });
      return { request_id: requestId, wallet_balance: newBal };
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await notifyAdmins(client, { type: "withdrawal_requested", params: { name: req.auth.name || "", amount: amt, number: jazz } });
  res.json({ ...out, status: "pending", amount: amt, message: "Withdrawal request bhej di — amount wallet se hold kar di gayi hai." });
});

app.get("/api/drivers/me/withdrawals", requireAuth, async (req, res) => {
  if (req.auth.ownerType !== "user" || req.auth.role !== "driver") {
    return res.status(403).json({ error: "Sirf driver apni withdrawals dekh sakta hai" });
  }
  const rows = await client.execute({
    sql: "SELECT * FROM withdrawals WHERE driver_id = ? ORDER BY created_at DESC LIMIT 50",
    args: [req.auth.ownerId],
  });
  res.json({ withdrawals: rows.rows });
});

app.get("/api/admin/withdrawals", requireAdmin, async (req, res) => {
  const status = req.query.status || "";
  const sql = status
    ? "SELECT w.*, u.name AS driver_name, u.phone AS driver_phone FROM withdrawals w JOIN users u ON u.id = w.driver_id WHERE w.status = ? ORDER BY w.created_at DESC LIMIT 100"
    : "SELECT w.*, u.name AS driver_name, u.phone AS driver_phone FROM withdrawals w JOIN users u ON u.id = w.driver_id ORDER BY w.created_at DESC LIMIT 100";
  const args = status ? [status] : [];
  const rows = await client.execute({ sql, args });
  res.json({ withdrawals: rows.rows });
});

app.post("/api/admin/withdrawals/:id/approve", requireAdmin, async (req, res) => {
  try {
    const out = await approveWithdrawal(num(req.params.id), req.auth.ownerId);
    res.json({ status: "approved", ...out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/admin/withdrawals/:id/reject", requireAdmin, async (req, res) => {
  try {
    const out = await rejectWithdrawal(num(req.params.id), req.auth.ownerId, String((req.body || {}).reason || ""));
    res.json({ status: "rejected", ...out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Notifications (v2.1, in-app feed — no push) ----
// One feed per identity: a user sees role='user' rows for their own id,
// an admin sees role='admin' rows for their own admin id. The client
// renders localized title/body from the type + params.
app.get("/api/notifications", requireAuth, async (req, res) => {
  const role = req.auth.ownerType === "admin" ? "admin" : "user";
  const rows = await client.execute({
    sql: "SELECT id, type, params, ride_id, is_read, created_at FROM notifications WHERE user_id = ? AND role = ? ORDER BY created_at DESC LIMIT 50",
    args: [req.auth.ownerId, role],
  });
  const unread = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND role = ? AND is_read = 0",
    args: [req.auth.ownerId, role],
  });
  res.json({
    unread_count: Number(unread.rows[0].n),
    notifications: rows.rows.map((n) => ({
      id: n.id, type: n.type, params: JSON.parse(n.params || "{}"),
      ride_id: n.ride_id, is_read: Number(n.is_read), created_at: n.created_at,
    })),
  });
});

app.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
  const role = req.auth.ownerType === "admin" ? "admin" : "user";
  const r = await client.execute({
    sql: "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ? AND role = ?",
    args: [num(req.params.id), req.auth.ownerId, role],
  });
  if (Number(r.rowsAffected) !== 1) return res.status(404).json({ error: "notification not found" });
  res.json({ ok: true });
});

app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
  const role = req.auth.ownerType === "admin" ? "admin" : "user";
  const r = await client.execute({
    sql: "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND role = ? AND is_read = 0",
    args: [req.auth.ownerId, role],
  });
  res.json({ ok: true, marked: Number(r.rowsAffected) });
});

// ---- Refunds (v2.1, admin-only) ----
// Owner-initiated wallet credit. The optional idempotency_key makes a
// double-submit safe: the second call with the same key credits nothing.
app.post("/api/admin/refunds", requireAdmin, async (req, res) => {
  const { user_id, amount, reason, idempotency_key } = req.body || {};
  const amt = Math.round(num(amount, 0));
  if (!user_id || amt <= 0) return res.status(400).json({ error: "user_id and a refund amount are required" });
  try {
    const out = await createRefund(req.auth.ownerId, {
      userId: num(user_id), amount: amt,
      reason: String(reason || ""), idempotencyKey: idempotency_key ? String(idempotency_key) : null,
    });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Driver documents (v2.1) ----
// Photos are base64 data URLs stored in Turso (client downscales to
// max 1024px JPEG 0.8 before upload; server caps at ~1.5 MB, JPG/PNG
// only). The full data URL is visible ONLY to admins; the owning driver
// sees metadata (type/status) only; other users see nothing at all.
const DOC_TYPES = ["cnic_front", "cnic_back", "cnic", "licence", "vehicle", "other"];
// Required for driver activation (v2.2 gate): CNIC + licence + vehicle.
// "cnic" is a single CNIC photo; "cnic_front"+"cnic_back" is the legacy
// two-photo flow — either satisfies CNIC. "other" never counts.
const DOC_MIMES = ["image/jpeg", "image/png"];
const DOC_MAX_CHARS = 2100000; // ~1.5 MB of image bytes as base64

app.post("/api/drivers/me/documents", requireAuth, async (req, res) => {
  if (req.auth.ownerType !== "user" || req.auth.role !== "driver") {
    return res.status(403).json({ error: "Sirf driver apni documents upload kar sakta hai" });
  }
  const { doc_type, mime, data_url, expires_at } = req.body || {};
  if (!DOC_TYPES.includes(doc_type)) return res.status(400).json({ error: "invalid document type" });
  if (!DOC_MIMES.includes(mime)) return res.status(400).json({ error: "only JPG or PNG photos are allowed" });
  const dataUrl = String(data_url || "");
  if (!dataUrl.startsWith("data:image/") || dataUrl.length > DOC_MAX_CHARS) {
    return res.status(400).json({ error: "document is too large — max 1.5 MB" });
  }
  // v2.3: optional expiry (epoch ms). If given it must be a valid future date.
  let exp = null;
  if (expires_at != null && expires_at !== "") {
    exp = Number(expires_at);
    if (!Number.isFinite(exp) || exp <= now()) {
      return res.status(400).json({ error: "expires_at must be a future date" });
    }
  }
  const d = await client.execute({ sql: "SELECT * FROM drivers WHERE user_id = ?", args: [req.auth.ownerId] });
  if (!d.rows.length) return res.status(404).json({ error: "driver not found" });
  const out = await withTx(async (tx) => {
    await tx.execute({ sql: "DELETE FROM documents WHERE driver_id = ? AND doc_type = ?", args: [req.auth.ownerId, doc_type] });
    const r = await tx.execute({
      sql: "INSERT INTO documents(driver_id, doc_type, data_url, mime, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
      args: [req.auth.ownerId, doc_type, dataUrl, mime, exp, now()],
    });
    return { document_id: Number(r.lastInsertRowid) };
  });
  res.json({ ...out, doc_type, status: "pending", expires_at: exp, message: "Document upload ho gaya — approval ke liye bhej di." });
});

// Per-document expiry flags (v2.3): expired = expires_at is past;
// expires_soon = expires within 30 days. Shared by both document lists.
function withDocExpiryFlags(docs) {
  const t = now();
  return docs.map((d) => ({
    ...d,
    expired: d.expires_at != null && Number(d.expires_at) <= t,
    expires_soon: d.expires_at != null && Number(d.expires_at) > t && Number(d.expires_at) <= t + 30 * 86400000,
  }));
}

app.get("/api/drivers/me/documents", requireAuth, async (req, res) => {
  if (req.auth.ownerType !== "user" || req.auth.role !== "driver") {
    return res.status(403).json({ error: "Sirf driver apni documents dekh sakta hai" });
  }
  const rows = await client.execute({
    sql: "SELECT id, doc_type, mime, status, expires_at, created_at, reviewed_at FROM documents WHERE driver_id = ? ORDER BY doc_type",
    args: [req.auth.ownerId],
  });
  res.json({ documents: withDocExpiryFlags(rows.rows), doc_checklist: await getDocChecklist(client, req.auth.ownerId) });
});

app.get("/api/admin/drivers/:id/documents", requireAdmin, async (req, res) => {
  const rows = await client.execute({
    sql: "SELECT id, doc_type, mime, status, data_url, expires_at, created_at, reviewed_at FROM documents WHERE driver_id = ? ORDER BY doc_type",
    args: [num(req.params.id)],
  });
  res.json({ documents: withDocExpiryFlags(rows.rows), doc_checklist: await getDocChecklist(client, num(req.params.id)) });
});

app.get("/api/admin/documents/:id", requireAdmin, async (req, res) => {
  const rows = await client.execute({ sql: "SELECT * FROM documents WHERE id = ?", args: [num(req.params.id)] });
  if (!rows.rows.length) return res.status(404).json({ error: "document not found" });
  res.json({ document: rows.rows[0] });
});

app.post("/api/admin/documents/:id/approve", requireAdmin, async (req, res) => {
  const doc = await client.execute({ sql: "SELECT * FROM documents WHERE id = ?", args: [num(req.params.id)] });
  if (!doc.rows.length) return res.status(404).json({ error: "document not found" });
  const d = doc.rows[0];
  // v2.3: an already-expired document cannot be approved — the driver
  // must re-upload a fresh one.
  if (d.expires_at != null && Number(d.expires_at) <= now()) {
    return res.status(400).json({ error: "document has expired — ask the driver to re-upload" });
  }
  await withTx(async (tx) => {
    await tx.execute({ sql: "UPDATE documents SET status='approved', reviewed_at=? WHERE id=?", args: [now(), num(req.params.id)] });
    // Recompute the verification gate (v2.2): documents_status is
    // 'approved' only when CNIC + licence + vehicle are ALL approved.
    const cl = await getDocChecklist(tx, d.driver_id);
    await tx.execute({ sql: "UPDATE drivers SET documents_status=? WHERE user_id = ?", args: [cl.all ? "approved" : "pending", d.driver_id] });
  });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "document_approve", targetType: "document", targetId: num(req.params.id), detail: `Document ${d.doc_type} approved for driver user #${d.driver_id}` });
  await notify(client, { userId: Number(d.driver_id), role: "user", type: "doc_approved", params: { doc: d.doc_type } });
  res.json({ status: "approved" });
});

app.post("/api/admin/documents/:id/reject", requireAdmin, async (req, res) => {
  const doc = await client.execute({ sql: "SELECT * FROM documents WHERE id = ?", args: [num(req.params.id)] });
  if (!doc.rows.length) return res.status(404).json({ error: "document not found" });
  const d = doc.rows[0];
  await withTx(async (tx) => {
    await tx.execute({ sql: "UPDATE documents SET status='rejected', reviewed_at=? WHERE id=?", args: [now(), num(req.params.id)] });
    await tx.execute({ sql: "UPDATE drivers SET documents_status='pending' WHERE user_id = ?", args: [d.driver_id] });
  });
  await writeAudit(client, { actorId: req.auth.ownerId, actorRole: "admin", action: "document_reject", targetType: "document", targetId: num(req.params.id), detail: `Document ${d.doc_type} rejected for driver user #${d.driver_id}` });
  await notify(client, { userId: Number(d.driver_id), role: "user", type: "doc_rejected", params: { doc: d.doc_type } });
  res.json({ status: "rejected" });
});

app.get("/", (req, res) => res.sendFile(path.join(root, "public", "index.html")));

// Separate role pages (frontend agent builds admin.html / rider.html / driver.html).
app.get("/admin", (req, res) => res.sendFile(path.join(root, "public", "admin.html")));
app.get("/rider", (req, res) => res.sendFile(path.join(root, "public", "rider.html")));
app.get("/driver", (req, res) => res.sendFile(path.join(root, "public", "driver.html")));

// ---- Scheduled-ride reminders (v2.3) ----
// Sweep every 5 minutes (guarded — a failed sweep never crashes the
// server). The same sweep also runs lazily on ride-detail reads so a due
// reminder is not stuck waiting for the next tick.
setInterval(() => {
  runScheduledReminders().catch((e) => console.warn("[chunian-ride] scheduled-reminder sweep failed:", e.message));
}, 5 * 60 * 1000);

// JSON error handler — never leak a stack trace or an HTML error page to the app.
app.use((err, req, res, next) => {
  console.error("[chunian-ride] error:", err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Server error — dobara koshish karein" });
});

initDb()
  .then(() => ensureVapidKeys())
  .then(() => ensureSetupToken())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[chunian-ride] listening on ${PORT} (db: ${usingTurso ? "turso" : "local-sqlite"})`);
    });
  })
  .catch((err) => {
    console.error("[chunian-ride] failed to start:", err);
    process.exit(1);
  });
