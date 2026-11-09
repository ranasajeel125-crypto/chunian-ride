// Chunian Ride — authentication + authorisation.
// FREE login method: phone number + password (bcrypt-hashed server-side).
// No SMS OTP exists for free — every SMS provider charges per SMS, and
// Firebase phone auth needs the paid Blaze plan (card). So there is no OTP
// in this app by design; the password is the secret, and driver phones are
// additionally verified by the owner at document approval (launch pool is
// small and vetted).
// Sessions are server-side rows (revocable) carried in an HTTP-only cookie.
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { client } from "./db.mjs";

const SESSION_COOKIE = "cr_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
const BCRYPT_ROUNDS = 10;

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
export async function verifyPassword(password, hash) {
  if (!hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 6) {
    return "password kam az kam 6 harf (characters) ka hona chahiye";
  }
  if (password.length > 72) return "password 72 harf se zyada nahi ho sakta";
  return null;
}

export function normalizePhone(phone) {
  return String(phone || "").trim().replace(/[\s-]/g, "");
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function createSession(ownerType, ownerId, userAgent = "") {
  const id = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  await client.execute({
    sql: "INSERT INTO sessions(id, owner_type, owner_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [id, ownerType, ownerId, now, now + SESSION_TTL_MS, now, String(userAgent).slice(0, 200)],
  });
  return id;
}

export async function destroySession(sessionId) {
  if (!sessionId) return;
  await client.execute({ sql: "DELETE FROM sessions WHERE id = ?", args: [sessionId] });
}

export async function destroyAllSessionsFor(ownerType, ownerId) {
  await client.execute({
    sql: "DELETE FROM sessions WHERE owner_type = ? AND owner_id = ?",
    args: [ownerType, ownerId],
  });
}

export async function loadSession(req) {
  const cookies = parseCookies(req);
  const id = cookies[SESSION_COOKIE];
  if (!id) return null;
  const res = await client.execute({ sql: "SELECT * FROM sessions WHERE id = ?", args: [id] });
  if (!res.rows.length) return null;
  const s = res.rows[0];
  if (Number(s.expires_at) < Date.now()) {
    await destroySession(id);
    return null;
  }
  // Refresh last_seen at most once per hour (avoids a write per request).
  if (!s.last_seen_at || Date.now() - Number(s.last_seen_at) > 3600000) {
    await client.execute({
      sql: "UPDATE sessions SET last_seen_at = ? WHERE id = ?",
      args: [Date.now(), id],
    }).catch(() => {});
  }
  return { id: s.id, ownerType: s.owner_type, ownerId: Number(s.owner_id) };
}

export function setSessionCookie(res, req, sessionId) {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
    secure: !!secure,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

// ---- Middleware ----
// Attaches req.auth = { ownerType: 'user'|'admin', ownerId, role } or null.
export async function attachAuth(req, res, next) {
  try {
    const s = await loadSession(req);
    if (!s) { req.auth = null; return next(); }
    if (s.ownerType === "admin") {
      const r = await client.execute({ sql: "SELECT id, name, phone, role FROM admins WHERE id = ?", args: [s.ownerId] });
      if (!r.rows.length) { req.auth = null; return next(); }
      req.auth = { ownerType: "admin", ownerId: s.ownerId, role: r.rows[0].role, name: r.rows[0].name, phone: r.rows[0].phone };
    } else {
      const r = await client.execute({ sql: "SELECT id, name, phone, role, status FROM users WHERE id = ?", args: [s.ownerId] });
      if (!r.rows.length || r.rows[0].status === "suspended") { req.auth = null; return next(); }
      req.auth = { ownerType: "user", ownerId: s.ownerId, role: r.rows[0].role, name: r.rows[0].name, phone: r.rows[0].phone };
    }
    next();
  } catch (e) {
    req.auth = null;
    next();
  }
}

export function requireAuth(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: "Login zaroori hai — pehle login karein" });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: "Login zaroori hai — pehle login karein" });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: "Is kaam ki ijazat nahi hai" });
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: "Admin login zaroori hai" });
  if (req.auth.ownerType !== "admin") return res.status(403).json({ error: "Sirf admin kar sakta hai" });
  next();
}

// The caller must be the user themself (or an admin). userId comes from the
// URL/body the route already validated.
export function requireSelfOrAdmin(getUserId) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: "Login zaroori hai — pehle login karein" });
    const target = Number(getUserId(req));
    if (req.auth.ownerType === "admin") return next();
    if (req.auth.ownerType === "user" && req.auth.ownerId === target) return next();
    return res.status(403).json({ error: "Ye kaam sirf usi user ka hai" });
  };
}

// ---- Admin-setup rate limiting (in-memory; per IP) ----
// 5 failed setup-code attempts in 15 minutes -> 429. A successful setup
// clears the count. Separate from the login limiter: the setup endpoint
// has no phone to key on, and a 4-digit-PIN-era brute force must never
// become a 64-char-token brute force either.
const setupAttempts = new Map(); // ip -> { count, firstAt }
export function setupRateLimit(req, res, next) {
  const key = req.ip || "?";
  const entry = setupAttempts.get(key);
  if (entry && entry.count >= 5 && Date.now() - entry.firstAt < 15 * 60 * 1000) {
    return res.status(429).json({ error: "Bohat zyada ghalat koshishein — 15 minute baad dobara koshish karein" });
  }
  if (entry && Date.now() - entry.firstAt >= 15 * 60 * 1000) setupAttempts.delete(key);
  req._setupKey = key;
  next();
}
export function setupFailed(req) {
  const key = req._setupKey;
  if (!key) return;
  const entry = setupAttempts.get(key) || { count: 0, firstAt: Date.now() };
  entry.count += 1;
  setupAttempts.set(key, entry);
}
export function setupSucceeded(req) {
  if (req._setupKey) setupAttempts.delete(req._setupKey);
}
const loginAttempts = new Map(); // key -> { count, firstAt }
// v2.1: keyed by PHONE alone (not IP+phone). The old IP+phone key let a
// client whose egress IP rotates (mobile data, some proxies) dodge the
// limiter for its first several failures. Phone-only keying trips the
// limiter after 5 failures for that phone no matter which IP they come
// from. Trade-off (accepted by the owner): an attacker can lock a phone
// out for 15 minutes by failing 5 times — the account itself stays safe,
// and the real owner just waits 15 minutes.
export function loginRateLimit(req, res, next) {
  const key = normalizePhone((req.body && req.body.phone) || "");
  const entry = loginAttempts.get(key);
  if (entry && entry.count >= 5 && Date.now() - entry.firstAt < 15 * 60 * 1000) {
    return res.status(429).json({ error: "Bohat zyada ghalat koshishein — 15 minute baad dobara koshish karein" });
  }
  if (entry && Date.now() - entry.firstAt >= 15 * 60 * 1000) loginAttempts.delete(key);
  req._loginKey = key;
  next();
}
export function loginFailed(req) {
  const key = req._loginKey;
  if (!key) return;
  const entry = loginAttempts.get(key) || { count: 0, firstAt: Date.now() };
  entry.count += 1;
  loginAttempts.set(key, entry);
}
export function loginSucceeded(req) {
  if (req._loginKey) loginAttempts.delete(req._loginKey);
}
