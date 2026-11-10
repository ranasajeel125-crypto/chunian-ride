// Chunian Ride smoke test — boots the server on a scratch port with a
// scratch SQLite file and runs a full end-to-end pass, printing exact numbers.
// Phase 1: covers auth (signup/login/guards), the top-up approval flow,
// RBAC (403s), transactions (no double-credit / no double-completion),
// and a restart-persistence check on the same DB file.
// v2.1: version + PWA, promo discount in fare math, withdrawals (hold /
// approve / reject-refund with double-action guards), notifications for
// all three roles, admin refunds (idempotent), rider top-up, document
// photo upload (admin-only view), phone-only login rate limiting, and
// the privacy fix (no rider phone in driver requests).
// Usage: npm run smoke
import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, "data");
const dbFile = path.join(dataDir, "smoke.db");
if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
if (fs.existsSync(dbFile + "-journal")) fs.unlinkSync(dbFile + "-journal");

const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;
// NODE_TLS_REJECT_UNAUTHORIZED=0: the server's web-push sender (web-push)
// verifies TLS; the smoke test's fake push service uses a self-signed cert
// (scripts/push-test-cert.pem, 127.0.0.1 only, test-only). Test process only.
const env = { ...process.env, PORT: String(PORT), TURSO_DATABASE_URL: "file:./data/smoke.db", NODE_TLS_REJECT_UNAUTHORIZED: "0" };

let child = null;
let serverOut = "";
function startServer() {
  child = spawn("node", ["server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  serverOut = "";
  child.stdout.on("data", (d) => (serverOut += d));
  child.stderr.on("data", (d) => (serverOut += d));
  return child;
}
function stopServer() {
  if (child) { child.kill(); child = null; }
}
// The one-time setup code is printed ONCE to server stdout on first boot
// (and never again while its hash is stored). Extract it from captured logs.
function extractSetupToken(out) {
  const m = out.match(/ONE-TIME ADMIN SETUP CODE: ([0-9a-f]{64})/);
  return m ? m[1] : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cookie jar: login responses set cr_session; call() sends it back.
const jar = { rider: "", riderB: "", driver: "", admin: "" };
async function call(p, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  const who = opts.session;
  if (who && jar[who]) headers.Cookie = jar[who];
  const res = await fetch(BASE + p, { headers, ...opts, });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}
async function callRaw(p, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  const who = opts.session;
  if (who && jar[who]) headers.Cookie = jar[who];
  const res = await fetch(BASE + p, { headers, ...opts });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, setCookie: res.headers.getSetCookie() };
}
function saveCookie(who, setCookie) {
  if (setCookie && setCookie.length) jar[who] = setCookie[0].split(";")[0];
}
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};
async function expectFail(label, fn, wantStatus) {
  let got = null;
  try { await fn(); } catch (e) { const m = e.message.match(/HTTP (\d+)/); got = m ? Number(m[1]) : -1; }
  check(label, got === wantStatus, `got HTTP ${got}, want ${wantStatus}`);
}

async function waitForHealth() {
  for (let i = 0; i < 120; i++) {
    try { await call("/api/health"); return; } catch { await sleep(500); }
  }
  throw new Error("server did not start:\n" + serverOut);
}

async function main() {
  startServer();
  await waitForHealth();
  const health = await call("/api/health");
  check("health ok", health.ok === true, `db=${health.db}`);

  const places = await call("/api/places");
  check("8 places (from cities table)", places.places.length === 8);
  const pattoki = places.places.find((p) => p.name === "Pattoki");
  check("Pattoki = 14 km", pattoki.km === 14);

  // ---- Pilot mode defaults ON (v2.2) on a fresh DB ----
  // Public signup is closed and rides are Chunian City only until the
  // owner toggles pilot mode OFF. Intercity fares must fail while ON.
  const pilotSettings = await call("/api/settings");
  check("pilot_mode defaults to ON (1) on a fresh DB", String(pilotSettings.settings.pilot_mode) === "1", `pilot_mode=${pilotSettings.settings.pilot_mode}`);
  check("pilot caps default to 10 drivers / 20 riders", String(pilotSettings.settings.pilot_max_drivers) === "10" && String(pilotSettings.settings.pilot_max_riders) === "20");
  await expectFail("pilot lock: fare Chunian->Lahore -> 400 while pilot ON", () => call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Lahore", vehicle: "car" }) }), 400);
  await expectFail("pilot lock: fare Chunian->Pattoki -> 400 while pilot ON", () => call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Pattoki", vehicle: "car" }) }), 400);
  const bikeFarePilot = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Chunian City", vehicle: "bike", distance_km: 3 }) });
  check("pilot lock: Chunian->Chunian bike 3 km = Rs 50 minimum", bikeFarePilot.suggested_fare === 50, `got Rs ${bikeFarePilot.suggested_fare}`);
  await expectFail("pilot lock: non-whitelisted signup -> 403 while pilot ON", () => call("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "No Invite", phone: "0309-5555555", password: "noinvite", role: "rider" }) }), 403);

  // ---- Auth guards: nothing works without a session ----
  await expectFail("unauthenticated ride booking -> 401", () => call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: 1, pickup: "Chunian City", destination: "Pattoki", vehicle: "car" }) }), 401);
  await expectFail("unauthenticated wallet read -> 401", () => call("/api/drivers/3/wallet"), 401);
  await expectFail("unauthenticated admin rides -> 401", () => call("/api/admin/rides"), 401);
  await expectFail("signup without password -> 400", () => call("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "No Pass", phone: "0309-1111111", role: "rider" }) }), 400);

  // ---- Admin bootstrap: one-time setup token (v2.0 — the fixed PIN is gone) ----
  const setupNeeded = await call("/api/admin/setup-needed");
  check("admin setup needed on fresh DB", setupNeeded.setup_needed === true);
  // The token is generated once on first boot and logged to stdout.
  const setupToken = extractSetupToken(serverOut);
  check("one-time setup token generated + logged on first boot (64 hex chars)", typeof setupToken === "string" && /^[0-9a-f]{64}$/.test(setupToken || ""));
  check("no ADMIN_PIN / fixed PIN anywhere in boot log", !/ADMIN_PIN|1234/.test(serverOut.replace(/ONE-TIME ADMIN SETUP CODE: [0-9a-f]{64}/, "")));
  await expectFail("admin setup with wrong token -> 401", () => call("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin: "00".repeat(32), name: "Owner", phone: "03266040350", password: "ownerpass" }) }), 401);
  await expectFail("admin setup with old fixed PIN 1234 -> 401", () => call("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin: "1234", name: "Owner", phone: "03266040350", password: "ownerpass" }) }), 401);
  // Restart BEFORE setup: the stored token hash must survive a restart —
  // no new token may be generated, and the original token must still work.
  stopServer();
  await sleep(500);
  startServer();
  await waitForHealth();
  check("restart before setup generates NO new token (hash persisted)", extractSetupToken(serverOut) === null, serverOut.slice(0, 200));
  check("setup still needed after restart", (await call("/api/admin/setup-needed")).setup_needed === true);
  const setup = await callRaw("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin: setupToken, name: "Owner", phone: "03266040350", password: "ownerpass" }) });
  check("admin setup with one-time token creates owner", setup.status === 200 && setup.data.admin && setup.data.admin.role === "owner", JSON.stringify(setup.data));
  saveCookie("admin", setup.setCookie);
  check("admin setup-needed now false", (await call("/api/admin/setup-needed")).setup_needed === false);
  await expectFail("second admin setup -> 400 (token dead after use)", () => call("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin: setupToken, name: "Owner2", phone: "03266040351", password: "ownerpass" }) }), 400);
  await expectFail("setup with a used token -> 400 (admin exists)", () => call("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin: setupToken, name: "Owner2", phone: "03266040351", password: "ownerpass" }) }), 400);
  const adminLoginBad = await callRaw("/api/admin/login", { method: "POST", body: JSON.stringify({ phone: "03266040350", password: "wrongpass" }) });
  check("admin login with wrong password -> 401", adminLoginBad.status === 401);
  // Login rate limit (dummy phone — the real admin phone stays usable).
  for (let i = 0; i < 5; i++) await callRaw("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0300-0000001", password: "wrong" }) });
  const locked = await callRaw("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0300-0000001", password: "wrong" }) });
  check("6th failed login in 15 min -> 429 rate limit", locked.status === 429, `got ${locked.status}`);

  // ---- Pilot OFF toggle (v2.2) — the rest of the legacy flow needs
  // intercity fares, so the owner-equivalent toggle runs here first.
  // BOTH flags go off: pilot_chunian_only alone also locks the area.
  // The toggle must write its own audit entry.
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ pilot_mode: "0", pilot_chunian_only: "0" }), session: "admin" });
  const pilotOff = await call("/api/settings");
  check("pilot mode + chunian-only toggled OFF via admin settings", String(pilotOff.settings.pilot_mode) === "0" && String(pilotOff.settings.pilot_chunian_only) === "0");
  const auditPilotOff = await call("/api/admin/audit-log?action=pilot_mode_toggle", { session: "admin" });
  check("pilot toggle writes a pilot_mode_toggle audit entry", auditPilotOff.audit_log.some((a) => a.action === "pilot_mode_toggle" && a.detail.includes("0")), JSON.stringify(auditPilotOff.audit_log.map((a) => a.action)));

  // Fare (pilot OFF): Chunian -> Pattoki, 14 km, car @ Rs 70/km = Rs 980.
  const fare = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Pattoki", vehicle: "car" }) });
  check("car fare Chunian->Pattoki = Rs 980", fare.suggested_fare === 980, `got Rs ${fare.suggested_fare}`);
  const bikeFare = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Chunian City", vehicle: "bike", distance_km: 3 }) });
  check("bike 3 km = Rs 50 minimum", bikeFare.suggested_fare === 50, `got Rs ${bikeFare.suggested_fare}`);
  const lahore = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Lahore", vehicle: "car" }) });
  check("car fare Chunian->Lahore = Rs 6230 (89 km)", lahore.suggested_fare === 6230, `got Rs ${lahore.suggested_fare}`);

  // AC Car (approved rate Rs 85/km, min Rs 200): no fare-logic change needed —
  // fareFor() already reads rate_${vehicle}_per_km / min_${vehicle}.
  const acLahore = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Lahore", vehicle: "ac_car" }) });
  check("AC Car fare Chunian->Lahore = Rs 7565 (85 x 89 km)", acLahore.suggested_fare === 7565, `got Rs ${acLahore.suggested_fare}`);
  const acShort = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Chunian City", vehicle: "ac_car", distance_km: 2 }) });
  check("AC Car 2 km = Rs 200 minimum (85 x 2 = 170 < 200)", acShort.suggested_fare === 200, `got Rs ${acShort.suggested_fare}`);
  const ac3km = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Chunian City", vehicle: "ac_car", distance_km: 3 }) });
  check("AC Car 3 km = Rs 255 (85 x 3, above the Rs 200 minimum)", ac3km.suggested_fare === 255, `got Rs ${ac3km.suggested_fare}`);
  await expectFail("unknown vehicle rejected -> 400", () => call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Lahore", vehicle: "helicopter" }) }), 400);

  // ---- Rider signup + login ----
  const riderRes = await callRaw("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Smoke Rider", phone: "0309-9999999", password: "riderpass", role: "rider" }) });
  check("rider signup with password", riderRes.status === 200 && !!riderRes.data.user.id, `id=${riderRes.data.user && riderRes.data.user.id}`);
  saveCookie("rider", riderRes.setCookie);
  const rider = riderRes.data.user;
  await expectFail("duplicate phone signup -> 409", () => call("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Copy", phone: "0309-9999999", password: "otherpass", role: "rider" }) }), 409);
  const riderLoginBad = await callRaw("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0309-9999999", password: "wrongpass" }) });
  check("rider login with wrong password -> 401", riderLoginBad.status === 401);
  const riderLogin = await callRaw("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0309-9999999", password: "riderpass" }) });
  check("rider login with right password", riderLogin.status === 200);
  saveCookie("rider", riderLogin.setCookie);
  const me = await call("/api/auth/me", { session: "rider" });
  check("session restores via /api/auth/me", me.user && me.user.id === rider.id, `id=${me.user && me.user.id}`);

  // Wallet (self): balance + transactions for the logged-in user.
  const myWallet = await call("/api/wallet/me", { session: "rider" });
  check("GET /api/wallet/me returns balance + transactions", typeof myWallet.balance === "number" && Array.isArray(myWallet.transactions), `balance=${myWallet.balance}, tx=${myWallet.transactions.length}`);
  check("new rider wallet starts at Rs 0", myWallet.balance === 0, `got Rs ${myWallet.balance}`);
  await expectFail("admin session cannot use /api/wallet/me -> 403", () => call("/api/wallet/me", { session: "admin" }), 403);
  await expectFail("unauthenticated /api/wallet/me -> 401", () => call("/api/wallet/me"), 401);

  // Second rider (for 403 tests).
  const riderBRes = await callRaw("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Smoke Rider B", phone: "0309-8888888", password: "riderbpass", role: "rider" }) });
  saveCookie("riderB", riderBRes.setCookie);
  const riderB = riderBRes.data.user;

  // Driver login: demo account Usman (0301-0000003) — first login claims it.
  const driverLogin = await callRaw("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0301-0000003", password: "driverpass" }) });
  check("demo driver first login claims the account", driverLogin.status === 200 && driverLogin.data.claimed === true);
  saveCookie("driver", driverLogin.setCookie);
  const driverUser = driverLogin.data.user;

  // Book a ride: rider proposes Rs 900 (below suggested 980).
  const ride = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.id, pickup: "Chunian City", destination: "Pattoki", vehicle: "car", proposed_fare: 900 }), session: "rider" });
  check("ride requested", !!ride.ride_id, `ride #${ride.ride_id}, offers=${ride.offers_created}`);
  check("2 car drivers offered", ride.offers_created === 2, `got ${ride.offers_created}`);

  const detail = await call(`/api/rides/${ride.ride_id}`, { session: "rider" });
  const offer = detail.offers.find((o) => o.status === "pending");
  check("offer fare = suggested Rs 980 (not the lowball 900)", offer.fare === 980, `got Rs ${offer.fare}`);
  const driverId = offer.driver_id;
  check("offer driver is the logged-in demo driver", driverId === driverUser.id, `driverId=${driverId}`);

  // Rating guard: a ride that has not finished cannot be rated.
  await expectFail("rating a requested ride -> 400", () => call(`/api/rides/${ride.ride_id}/rate`, { method: "POST", body: JSON.stringify({ by: "rider", stars: 5 }), session: "rider" }), 400);

  // RBAC: another rider cannot read this ride; another driver cannot act as Usman.
  await expectFail("other rider cannot read this ride -> 403", () => call(`/api/rides/${ride.ride_id}`, { session: "riderB" }), 403);
  await expectFail("driver cannot counter-offer as another driver -> 403", () => call(`/api/rides/${ride.ride_id}/counter`, { method: "POST", body: JSON.stringify({ driver_id: 999001, fare: 950 }), session: "driver" }), 403);

  // Driver sees the request with rider-proposed fare before accepting.
  const reqs = await call(`/api/drivers/${driverId}/requests`, { session: "driver" });
  check("driver sees request with proposed fare Rs 900", reqs.requests.some((r) => r.id === ride.ride_id && r.proposed_fare === 900));

  // Driver counter-offers Rs 950, rider accepts it.
  const counter = await call(`/api/rides/${ride.ride_id}/counter`, { method: "POST", body: JSON.stringify({ driver_id: driverId, fare: 950 }), session: "driver" });
  check("counter-offer created", !!counter.offer_id, `offer #${counter.offer_id} @ Rs 950`);
  const accepted = await call(`/api/rides/${ride.ride_id}/offers/${counter.offer_id}/accept`, { method: "POST", body: "{}" , session: "rider" });
  check("rider picks counter-offer, agreed fare Rs 950", accepted.agreed_fare === 950, `got Rs ${accepted.agreed_fare}`);

  // Wallet before.
  const walletBefore = await call(`/api/drivers/${driverId}/wallet`, { session: "driver" });
  const balBefore = walletBefore.wallet_balance;

  // Start, then complete WITHOUT cash -> must fail.
  await call(`/api/rides/${ride.ride_id}/start`, { method: "POST", body: "{}", session: "driver" });
  let noCashBlocked = false;
  try { await call(`/api/rides/${ride.ride_id}/complete`, { method: "POST", body: JSON.stringify({ cash_received: false }), session: "driver" }); } catch { noCashBlocked = true; }
  check("complete without cash confirmation is blocked", noCashBlocked);

  // Complete with cash: fare 950, commission 12% = 114 + Rs 20 fee = Rs 134.
  const done = await call(`/api/rides/${ride.ride_id}/complete`, { method: "POST", body: JSON.stringify({ cash_received: true }), session: "driver" });
  check("trip completed, platform take = Rs 134 (114 + 20)", done.platform_take === 134, `got Rs ${done.platform_take}`);
  check("driver kept Rs 816", done.driver_kept === 816, `got Rs ${done.driver_kept}`);
  check("wallet deducted by Rs 134", done.driver_wallet_balance === balBefore - 134, `${balBefore} -> ${done.driver_wallet_balance}`);

  // Double completion is impossible (transaction-guarded status check).
  await expectFail("second completion of the same ride -> 400", () => call(`/api/rides/${ride.ride_id}/complete`, { method: "POST", body: JSON.stringify({ cash_received: true }), session: "driver" }), 400);

  // Rating + history + share + SOS.
  const rated = await call(`/api/rides/${ride.ride_id}/rate`, { method: "POST", body: JSON.stringify({ by: "rider", stars: 5 }), session: "rider" });
  check("rating a completed ride works", rated.rated === true && rated.stars === 5, JSON.stringify(rated));
  const hist = await call(`/api/rides?rider_id=${rider.id}`, { session: "rider" });
  check("ride history shows completed ride", hist.rides.some((r) => r.id === ride.ride_id && r.status === "completed"));
  const share = await call(`/api/rides/${ride.ride_id}/share`);
  check("share link returned", share.url.includes(`/api/rides`) === false && share.url.includes("?ride="), share.url);
  const sos = await call(`/api/rides/${ride.ride_id}/sos`, { method: "POST", body: JSON.stringify({ message: "smoke SOS" }), session: "rider" });
  check("SOS returns Police 15 / Rescue 1122", sos.police === "15" && sos.rescue === "1122");

  // In-ride chat: rider sends, driver reads; driver replies, rider reads.
  const chat1 = await call(`/api/rides/${ride.ride_id}/messages`, { method: "POST", body: JSON.stringify({ sender_id: rider.id, sender_role: "rider", message: "Assalam-o-Alaikum, main pickup par khara hoon." }), session: "rider" });
  check("rider chat message sent", !!chat1.message_id, `id=${chat1.message_id}`);
  const chatAsDriver = await call(`/api/rides/${ride.ride_id}/messages`, { session: "driver" });
  check("driver can read ride chat", chatAsDriver.messages.some((m) => m.message.includes("pickup par")));
  const chat2 = await call(`/api/rides/${ride.ride_id}/messages`, { method: "POST", body: JSON.stringify({ sender_id: driverId, sender_role: "driver", message: "5 minute mein aa raha hoon." }), session: "driver" });
  check("driver chat reply sent", !!chat2.message_id);
  const chatAsRider = await call(`/api/rides/${ride.ride_id}/messages`, { session: "rider" });
  check("rider can read driver reply", chatAsRider.messages.length === 2, `got ${chatAsRider.messages.length}`);
  await expectFail("chat is private to the ride's rider/driver -> 403 for another rider", () => call(`/api/rides/${ride.ride_id}/messages`, { session: "riderB" }), 403);

  // Live location: driver posts GPS, ride detail carries it.
  const loc = await call(`/api/drivers/${driverId}/location`, { method: "POST", body: JSON.stringify({ lat: 30.97, lng: 74.03 }), session: "driver" });
  check("driver location posted", loc.ok === true);
  const detail2 = await call(`/api/rides/${ride.ride_id}`, { session: "rider" });
  check("ride detail carries live driver location", detail2.driver_location && detail2.driver_location.lat === 30.97, JSON.stringify(detail2.driver_location));

  // No fake ratings: a demo driver with no completed-ride rating has count 0.
  const allDrivers = await call("/api/admin/drivers", { session: "admin" });
  const hassan = allDrivers.drivers.find((x) => x.name === "Hassan Ali");
  check("unrated demo driver shows no fake rating (count 0)", !!hassan && hassan.rating_count === 0, `count=${hassan && hassan.rating_count}`);

  // Driver earnings (today): the smoke ride (Rs 950, fee Rs 134) PLUS the
  // seeded demo ride for the same driver (Usman, Rs 980, fee Rs 138, ~23.5h ago).
  const earn = await call(`/api/drivers/${driverId}/earnings?days=1`, { session: "driver" });
  check("driver earnings today: 2 rides, kept Rs 1658", earn.rides === 2 && earn.driver_kept === 1658, JSON.stringify(earn));

  // ---- Top-up approval flow (G2 fix) ----
  // Below-minimum top-up is rejected outright.
  await expectFail("top-up below Rs 500 minimum -> 400", () => call(`/api/drivers/${driverId}/topup`, { method: "POST", body: JSON.stringify({ amount: 100, method: "JazzCash", tid: "SMOKE-LOW" }), session: "driver" }), 400);
  // A top-up request does NOT change the balance — it stays pending.
  const topReq = await call(`/api/drivers/${driverId}/topup`, { method: "POST", body: JSON.stringify({ amount: 500, method: "JazzCash", tid: "SMOKE-TID-1" }), session: "driver" });
  check("top-up creates a PENDING request", topReq.status === "pending" && !!topReq.request_id, JSON.stringify(topReq));
  const walletAfterReq = await call(`/api/drivers/${driverId}/wallet`, { session: "driver" });
  check("balance UNCHANGED while top-up is pending", walletAfterReq.wallet_balance === balBefore - 134, `balance Rs ${walletAfterReq.wallet_balance}`);
  check("driver sees the pending request", walletAfterReq.pending_topups.some((t) => t.id === topReq.request_id && t.status === "pending"));
  const pendingList = await call("/api/admin/topups?status=pending", { session: "admin" });
  check("admin sees the pending top-up", pendingList.topups.some((t) => t.id === topReq.request_id && t.tid === "SMOKE-TID-1"));
  // Approve: credits exactly once.
  const approved = await call(`/api/admin/topups/${topReq.request_id}/approve`, { method: "POST", body: "{}", session: "admin" });
  check("top-up approved, wallet +Rs 500", approved.status === "approved" && approved.wallet_balance === balBefore - 134 + 500, `balance Rs ${approved.wallet_balance}`);
  await expectFail("approving the same top-up twice -> 400 (no double-credit)", () => call(`/api/admin/topups/${topReq.request_id}/approve`, { method: "POST", body: "{}", session: "admin" }), 400);
  const walletAfterApprove = await call(`/api/drivers/${driverId}/wallet`, { session: "driver" });
  check("balance still exactly +500 after double-approve attempt", walletAfterApprove.wallet_balance === balBefore - 134 + 500, `balance Rs ${walletAfterApprove.wallet_balance}`);
  // Reject: credits nothing.
  const topReq2 = await call(`/api/drivers/${driverId}/topup`, { method: "POST", body: JSON.stringify({ amount: 500, method: "JazzCash", tid: "SMOKE-TID-2" }), session: "driver" });
  const rejected = await call(`/api/admin/topups/${topReq2.request_id}/reject`, { method: "POST", body: JSON.stringify({ reason: "TID not found in JazzCash" }), session: "admin" });
  check("top-up rejected", rejected.status === "rejected");
  const walletAfterReject = await call(`/api/drivers/${driverId}/wallet`, { session: "driver" });
  check("balance unchanged after reject", walletAfterReject.wallet_balance === balBefore - 134 + 500, `balance Rs ${walletAfterReject.wallet_balance}`);
  const audit = await call("/api/admin/audit-log", { session: "admin" });
  check("audit log records top-up approve + reject", audit.audit_log.some((a) => a.action === "topup_approve") && audit.audit_log.some((a) => a.action === "topup_reject"));

  // Admin: settings change takes effect immediately.
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ rate_car_per_km: 80 }), session: "admin" });
  const fare2 = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Pattoki", vehicle: "car" }) });
  check("admin rate change applies immediately (car 80/km -> Rs 1120)", fare2.suggested_fare === 1120, `got Rs ${fare2.suggested_fare}`);
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ rate_car_per_km: 70 }), session: "admin" });
  // v2.3 (integration): owner_name is editable from admin settings now.
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ owner_name: "Chunian Ride Test" }), session: "admin" });
  const settingsAfterOwner = await call("/api/settings");
  check("admin owner_name change persists", settingsAfterOwner.settings.owner_name === "Chunian Ride Test", `got ${settingsAfterOwner.settings.owner_name}`);
  await expectFail("admin owner_name empty is rejected (400)", () => call("/api/admin/settings", { method: "POST", body: JSON.stringify({ owner_name: "   " }), session: "admin" }), 400);
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ owner_name: "Chunian Ride" }), session: "admin" });

  const report = await call("/api/admin/reports?days=7", { session: "admin" });
  check("7-day report counts the completed ride", report.rides >= 1 && report.platform_revenue >= 134, `rides=${report.rides}, revenue=Rs ${report.platform_revenue}`);
  const profit = await call("/api/admin/profit?avg_fare=300&monthly_cost=60000", { session: "admin" });
  check("profit calculator: break-even 36 rides/day at 12%+20 on Rs 300", profit.break_even_rides_per_day === 36, `got ${profit.break_even_rides_per_day}/day`);
  check("profit labelled estimates only", profit.estimates_only === true);

  // Admin foundation: users list + suspend/reactivate.
  const users = await call("/api/admin/users", { session: "admin" });
  check("admin users list includes riders + drivers", users.users.some((u) => u.id === rider.id) && users.users.some((u) => u.id === driverId));
  await call(`/api/admin/users/${riderB.id}/suspend`, { method: "POST", body: "{}", session: "admin" });
  const suspendedLogin = await callRaw("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0309-8888888", password: "riderbpass" }) });
  check("suspended user cannot log in -> 403", suspendedLogin.status === 403, `got ${suspendedLogin.status}`);
  await call(`/api/admin/users/${riderB.id}/reactivate`, { method: "POST", body: "{}", session: "admin" });
  const reactivatedLogin = await callRaw("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0309-8888888", password: "riderbpass" }) });
  check("reactivated user can log in again", reactivatedLogin.status === 200);

  // Promo codes (foundation).
  const promo = await call("/api/admin/promo-codes", { method: "POST", body: JSON.stringify({ code: "SMOKE10", discount_type: "percent", discount_value: 10 }), session: "admin" });
  check("promo code created", !!promo.promo_id && promo.code === "SMOKE10", JSON.stringify(promo));
  const promos = await call("/api/admin/promo-codes", { session: "admin" });
  check("promo code listed", promos.promo_codes.some((p) => p.code === "SMOKE10"));

  // ---- Admin overview (dashboard) ----
  // At this point: 8 users (6 demo + 2 riders), 3 riders, 5 drivers (all
  // online), 3 rides total (2 seeded + smoke), 3 completed (fees 138+26+134
  // = Rs 298 in the last 7 days), 1 open SOS complaint, 0 pending top-ups
  // (both reviewed), 0 pending drivers.
  const ov = await call("/api/admin/overview", { session: "admin" });
  const ovNums = [ov.totals.users, ov.totals.riders, ov.totals.drivers, ov.totals.drivers_online, ov.totals.rides_today, ov.totals.rides_total, ov.totals.completed_today, ov.pending_topups, ov.open_complaints, ov.pending_drivers, ov.platform_revenue_7d, ov.platform_revenue_today];
  check("admin overview returns all fields as numbers", ovNums.every((n) => typeof n === "number"), JSON.stringify(ov));
  check("overview totals: 8 users / 3 riders / 5 drivers / 5 online", ov.totals.users === 8 && ov.totals.riders === 3 && ov.totals.drivers === 5 && ov.totals.drivers_online === 5, JSON.stringify(ov.totals));
  check("overview rides: 3 total, >= 2 today/completed", ov.totals.rides_total === 3 && ov.totals.rides_today >= 2 && ov.totals.completed_today >= 2, JSON.stringify(ov.totals));
  check("overview revenue 7d = Rs 298 (138 + 26 + 134)", ov.platform_revenue_7d === 298, `got Rs ${ov.platform_revenue_7d}`);
  check("overview: 1 open complaint, 0 pending top-ups/drivers", ov.open_complaints === 1 && ov.pending_topups === 0 && ov.pending_drivers === 0, `complaints=${ov.open_complaints}, topups=${ov.pending_topups}, drivers=${ov.pending_drivers}`);
  await expectFail("rider cannot read admin overview -> 403", () => call("/api/admin/overview", { session: "rider" }), 403);
  await expectFail("unauthenticated admin overview -> 401", () => call("/api/admin/overview"), 401);

  // ---- Admin cities CRUD ----
  const city = await call("/api/admin/cities", { method: "POST", body: JSON.stringify({ name: "Smoke City", lat: 31.1, lng: 74.2, km_from_chunian: 25, note: "smoke test city" }), session: "admin" });
  check("city created", !!city.city && city.city.id && city.city.name === "Smoke City", JSON.stringify(city.city));
  const cities = await call("/api/admin/cities", { session: "admin" });
  check("city list contains the new city", cities.cities.some((c) => c.id === city.city.id && c.name === "Smoke City"), `total ${cities.cities.length}`);
  const deact = await call(`/api/admin/cities/${city.city.id}/deactivate`, { method: "POST", body: "{}", session: "admin" });
  check("city deactivated", deact.active === 0, JSON.stringify(deact));
  const citiesOff = await call("/api/admin/cities", { session: "admin" });
  check("deactivated city shows active=0", citiesOff.cities.find((c) => c.id === city.city.id).active === 0);
  const act = await call(`/api/admin/cities/${city.city.id}/activate`, { method: "POST", body: "{}", session: "admin" });
  check("city re-activated", act.active === 1, JSON.stringify(act));
  await expectFail("duplicate city name -> 409", () => call("/api/admin/cities", { method: "POST", body: JSON.stringify({ name: "Smoke City", lat: 31.1, lng: 74.2 }), session: "admin" }), 409);
  await expectFail("city with invalid lat/lng -> 400", () => call("/api/admin/cities", { method: "POST", body: JSON.stringify({ name: "Bad City", lat: "xx", lng: 74.2 }), session: "admin" }), 400);
  await expectFail("rider cannot create a city -> 403", () => call("/api/admin/cities", { method: "POST", body: JSON.stringify({ name: "Nope City", lat: 31, lng: 74 }), session: "rider" }), 403);

  // The fixed PIN is dead — the old header no longer works.
  await expectFail("old X-Admin-Pin header no longer grants admin -> 401", () => fetch(BASE + "/api/admin/rides", { headers: { "X-Admin-Pin": "1234" } }).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }), 401);

  // Seed data present.
  const drivers = await call("/api/admin/drivers", { session: "admin" });
  check("5 seeded demo drivers (incl. AC Car)", drivers.drivers.length === 5, drivers.drivers.map((d) => d.name).join(", "));
  const aliRaza = drivers.drivers.find((x) => x.name === "Ali Raza");
  check("AC Car demo driver seeded (Ali Raza, Toyota Corolla GLi, online)", !!aliRaza && aliRaza.vehicle_type === "ac_car" && aliRaza.plate === "DEMO-ACC-01" && aliRaza.online === 1, JSON.stringify(aliRaza && { vehicle_type: aliRaza.vehicle_type, plate: aliRaza.plate, online: aliRaza.online }));
  const allRides = await call("/api/admin/rides", { session: "admin" });
  check("2 seeded demo rides + smoke ride present", allRides.rides.length >= 3, `total ${allRides.rides.length}`);

  // --- inDrive features (2026-11-07): scheduled rides + tips ---
  // Scheduled ride: 2 days ahead, stored + shown to driver + rider.
  const schedTime = Date.now() + 2 * 86400000;
  const schedRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.id, pickup: "Chunian City", destination: "Kasur", vehicle: "car", proposed_fare: 3000, scheduled_for: schedTime }), session: "rider" });
  check("scheduled ride created", !!schedRide.ride_id && schedRide.scheduled_for === schedTime, `ride #${schedRide.ride_id}`);
  const schedDetail = await call(`/api/rides/${schedRide.ride_id}`, { session: "rider" });
  check("scheduled ride stores its time", schedDetail.ride.scheduled_for === schedTime, `got ${schedDetail.ride.scheduled_for}`);
  const schedReqs = await call(`/api/drivers/${driverId}/requests`, { session: "driver" });
  check("driver sees scheduled ride with its time", schedReqs.requests.some((r) => r.id === schedRide.ride_id && r.scheduled_for === schedTime));
  let schedPastBlocked = false;
  try { await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.id, pickup: "Chunian City", destination: "Kasur", vehicle: "car", proposed_fare: 3000, scheduled_for: Date.now() - 60000 }), session: "rider" }); } catch { schedPastBlocked = true; }
  check("scheduled ride in the past is rejected", schedPastBlocked);
  let schedFarBlocked = false;
  try { await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.id, pickup: "Chunian City", destination: "Kasur", vehicle: "car", proposed_fare: 3000, scheduled_for: Date.now() + 8 * 86400000 }), session: "rider" }); } catch { schedFarBlocked = true; }
  check("scheduled ride more than 7 days ahead is rejected", schedFarBlocked);

  // Tip: on the completed smoke ride (fare Rs 950, fee Rs 134 already charged).
  let tipEarlyBlocked = false;
  try { await call(`/api/rides/${schedRide.ride_id}/tip`, { method: "POST", body: JSON.stringify({ rider_id: rider.id, amount: 50 }), session: "rider" }); } catch { tipEarlyBlocked = true; }
  check("tip on a non-completed ride is rejected", tipEarlyBlocked);
  // Rating guard on a cancelled ride: cancel the scheduled ride, then rate it.
  const cancelledSched = await call(`/api/rides/${schedRide.ride_id}/cancel`, { method: "POST", body: "{}", session: "rider" });
  check("scheduled ride cancelled for the rating-guard test", cancelledSched.status === "cancelled");
  await expectFail("rating a cancelled ride -> 400", () => call(`/api/rides/${schedRide.ride_id}/rate`, { method: "POST", body: JSON.stringify({ by: "rider", stars: 5 }), session: "rider" }), 400);
  const tipRes = await call(`/api/rides/${ride.ride_id}/tip`, { method: "POST", body: JSON.stringify({ rider_id: rider.id, amount: 50 }), session: "rider" });
  check("tip Rs 50 added, 0% commission on tip", tipRes.tip === 50 && tipRes.commission_on_tip === 0, JSON.stringify(tipRes));
  const tippedRide = await call(`/api/rides/${ride.ride_id}`, { session: "rider" });
  check("ride receipt shows tip Rs 50", tippedRide.ride.tip_amount === 50, `got ${tippedRide.ride.tip_amount}`);
  const walletAfterTip = await call(`/api/drivers/${driverId}/wallet`, { session: "driver" });
  check("tip is cash — prepaid wallet balance unchanged by tip", walletAfterTip.wallet_balance === balBefore - 134 + 500, `balance Rs ${walletAfterTip.wallet_balance}`);
  let tipTwiceBlocked = false;
  try { await call(`/api/rides/${ride.ride_id}/tip`, { method: "POST", body: JSON.stringify({ rider_id: rider.id, amount: 20 }), session: "rider" }); } catch { tipTwiceBlocked = true; }
  check("second tip on the same ride is rejected", tipTwiceBlocked);
  const earn2 = await call(`/api/drivers/${driverId}/earnings?days=1`, { session: "driver" });
  check("earnings include tips Rs 50, driver kept +Rs 50", earn2.tips === 50 && earn2.driver_kept === 1658 + 50, JSON.stringify(earn2));
  const hist2 = await call(`/api/rides?rider_id=${rider.id}`, { session: "rider" });
  check("rider history shows the tip on the completed ride", hist2.rides.some((r) => r.id === ride.ride_id && r.tip_amount === 50));

  // ---- Setup rate limit (separate fresh-DB server, port 3457) ----
  // 5 wrong setup codes -> 401 each; 6th rapid attempt -> 429; even the
  // correct code is then blocked until the 15-minute window passes.
  {
    const rateDb = path.join(dataDir, "smoke-rate.db");
    if (fs.existsSync(rateDb)) fs.unlinkSync(rateDb);
    const rateEnv = { ...process.env, PORT: "3457", TURSO_DATABASE_URL: "file:./data/smoke-rate.db" };
    const rateChild = spawn("node", ["server/index.mjs"], { cwd: root, env: rateEnv, stdio: ["ignore", "pipe", "pipe"] });
    let rateOut = "";
    rateChild.stdout.on("data", (d) => (rateOut += d));
    rateChild.stderr.on("data", (d) => (rateOut += d));
    const rateBase = "http://127.0.0.1:3457";
    try {
      for (let i = 0; i < 120; i++) {
        try { const r = await fetch(rateBase + "/api/health"); if (r.ok) break; } catch {}
        await sleep(500);
      }
      const rateToken = extractSetupToken(rateOut);
      check("rate-limit server generated its own setup token", typeof rateToken === "string" && /^[0-9a-f]{64}$/.test(rateToken || ""));
      const rateCall = async (pin) => {
        const r = await fetch(rateBase + "/api/admin/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, name: "Owner", phone: "03266040350", password: "ownerpass" }) });
        return r.status;
      };
      let statuses = [];
      for (let i = 0; i < 5; i++) statuses.push(await rateCall("11".repeat(32)));
      check("5 wrong setup codes -> 401 each", statuses.every((x) => x === 401), statuses.join(","));
      const sixth = await rateCall("22".repeat(32));
      check("6th rapid wrong setup code -> 429 rate limit", sixth === 429, `got ${sixth}`);
      const blockedReal = await rateCall(rateToken);
      check("correct token also blocked while rate-limited -> 429", blockedReal === 429, `got ${blockedReal}`);
    } finally {
      rateChild.kill();
      await sleep(300);
      if (fs.existsSync(rateDb)) fs.unlinkSync(rateDb);
      if (fs.existsSync(rateDb + "-journal")) fs.unlinkSync(rateDb + "-journal");
    }
  }

  // Static pages.
  const page = await fetch(BASE + "/");
  check("homepage HTTP 200", page.status === 200);
  // Separate role pages: the frontend agent creates these HTML files in
  // parallel — if one is not present yet, SKIP (do not fail) and say so.
  async function checkRolePage(route, file) {
    if (!fs.existsSync(path.join(root, "public", file))) {
      console.log(`SKIP  ${route} — public/${file} not present yet (frontend agent still building it)`);
      return;
    }
    const r = await fetch(BASE + route);
    const t = await r.text();
    check(`${route} returns 200 with HTML`, r.status === 200 && /<html/i.test(t), `HTTP ${r.status}`);
  }
  await checkRolePage("/admin", "admin.html");
  await checkRolePage("/rider", "rider.html");
  await checkRolePage("/driver", "driver.html");
  const pageText = await page.text();
  // Redesign (2026-11-08): index.html is now a landing page — "Version 1"
  // wording and the booking form moved to /rider. The exit note stays.
  check("landing page mentions Uber/Careem exit note + AC Car + role links", pageText.includes("30 Apr 2024") && pageText.includes("AC Car") && pageText.includes("/rider") && pageText.includes("/driver"));
  if (fs.existsSync(path.join(root, "public", "rider.html"))) {
    const riderPage = await (await fetch(BASE + "/rider")).text();
    check("rider page has scheduled-ride inputs + tip box + password field", riderPage.includes("sched-date") && riderPage.includes("sched-time") && riderPage.includes("tip-box") && riderPage.includes("rider-password"));
  } else {
    console.log("SKIP  rider-page feature markers — public/rider.html not present yet");
  }
  // Redesign (2026-11-08): public/app.js was split by the frontend agent
  // into rider.js / driver.js / admin.js (+ shared.js); the old function
  // names adminSetup/reviewTopup were renamed in the rewrite, but the
  // features (counter buttons, tips, scheduled rides, admin setup,
  // top-up review) still exist under the new names.
  const riderJs = await (await fetch(BASE + "/rider.js")).text();
  const driverJs = await (await fetch(BASE + "/driver.js")).text();
  const adminJs = await (await fetch(BASE + "/admin.js")).text();
  check("split app JS keeps counter buttons + tip + scheduled + admin setup + top-up review", driverJs.includes("setCounter") && riderJs.includes("addTip") && riderJs.includes("scheduled_for") && adminJs.includes("/api/admin/setup") && adminJs.includes("/api/admin/topups?status=pending"));
  const css = await (await fetch(BASE + "/style.css?v=4")).text();
  check("served style.css has quick-btn + tip-box styles", css.includes(".quick-btn") && css.includes(".tip-box"));

  // ---- Restart persistence (local file): stop, restart on the SAME DB ----
  const rideIdKept = ride.ride_id;
  const balanceKept = balBefore - 134 + 500;
  const riderCookieKept = jar.rider;
  stopServer();
  await sleep(500);
  startServer();
  await waitForHealth();
  const health2 = await call("/api/health");
  check("server restarts cleanly on the same DB (migrations re-run)", health2.ok === true, `db=${health2.db}`);
  const rideAfterRestart = await call(`/api/rides/${rideIdKept}`, { session: "rider" });
  check("ride record survives restart", rideAfterRestart.ride && rideAfterRestart.ride.id === rideIdKept && rideAfterRestart.ride.status === "completed");
  const walletAfterRestart = await call(`/api/drivers/${driverId}/wallet`, { session: "driver" });
  check("wallet balance survives restart", walletAfterRestart.wallet_balance === balanceKept, `balance Rs ${walletAfterRestart.wallet_balance}`);
  // The pre-restart session cookie still works — sessions live in the DB.
  const meAfterRestart = await fetch(BASE + "/api/auth/me", { headers: { Cookie: riderCookieKept } });
  const meData = await meAfterRestart.json().catch(() => ({}));
  check("session cookie survives restart (sessions are in the DB)", meAfterRestart.status === 200 && meData.user && meData.user.id === rider.id);
  const topupsAfterRestart = await call("/api/admin/topups", { session: "admin" });
  check("top-up requests survive restart", topupsAfterRestart.topups.some((t) => t.id === topReq.request_id && t.status === "approved"));

  // ================= v2.2 =================
  const health21 = await call("/api/health");
  check("version is 2.5.0", health21.version === "2.5.0", `got ${health21.version}`);

  // ---- PWA ----
  const manifestRes = await fetch(BASE + "/manifest.json");
  const manifest = await manifestRes.json().catch(() => ({}));
  check("manifest.json serves 200 + valid JSON (Chunian Ride)", manifestRes.status === 200 && manifest.name === "Chunian Ride" && manifest.short_name === "ChunianRide");
  check("manifest has 192 + 512 icons", Array.isArray(manifest.icons) && manifest.icons.some((i) => i.sizes === "192x192") && manifest.icons.some((i) => i.sizes === "512x512"));
  check("manifest display standalone + theme #0D1748", manifest.display === "standalone" && manifest.theme_color === "#0D1748");
  check("icon 192 serves 200", (await fetch(BASE + "/icons/icon-192.png")).status === 200);
  check("icon 512 serves 200", (await fetch(BASE + "/icons/icon-512.png")).status === 200);
  const swRes = await fetch(BASE + "/sw.js");
  const swText = await swRes.text();
  check("sw.js serves 200 with versioned cache chunian-ride-v2.5.0", swRes.status === 200 && swText.includes("chunian-ride-v2.5.0"));
  const landing21 = await (await fetch(BASE + "/")).text();
  check("landing footer says v2.5 + links manifest", landing21.includes("Chunian Ride v2.5") && landing21.includes("/manifest.json"));

  const riderPage21 = await (await fetch(BASE + "/rider")).text();
  check("rider page has promo input + notification bell + rider top-up card", riderPage21.includes("promo-code") && riderPage21.includes("notif-bell") && riderPage21.includes("rider-topup-amount"));
  // v2.4: GPS must start only on a real tap — no silent load-time call
  // (it burned the one-shot permission prompt), and a denial must show
  // the settings hint + a Retry button instead of a dead end.
  const riderJs24 = await (await fetch(BASE + "/rider.js")).text();
  check("rider.js v2.4 GPS: no silent load-time request, tap calls getCurrentPosition, denial has retry", !riderJs24.includes("requestGpsPickup(true)") && riderJs24.includes("function requestGpsPickup()") && riderJs24.includes("showGpsDenied") && riderJs24.includes("gps-retry"));
  // v2.5.0: toast() must show only ONE toast at a time — repeated GPS
  // denials used to stack identical red banners (six on the owner's phone).
  const sharedJs241 = await (await fetch(BASE + "/shared.js")).text();
  check("toast() replaces previous toast (no stacking)", sharedJs241.includes("box.replaceChildren()"));
  check("rider.js GPS denial shows inline hint only, no error toast", !riderJs24.includes('toast(t("gps_denied")'));
  const driverPage21 = await (await fetch(BASE + "/driver")).text();
  check("driver page has withdrawal form + documents card + bell", driverPage21.includes("withdraw-amount") && driverPage21.includes("docs-list") && driverPage21.includes("notif-bell"));
  const adminPage21 = await (await fetch(BASE + "/admin")).text();
  check("admin page has withdrawals section + refund form + bell", adminPage21.includes("sec-withdrawals") && adminPage21.includes("refund-user") && adminPage21.includes("notif-bell"));
  const sharedJs21 = await (await fetch(BASE + "/shared.js")).text();
  check("shared.js registers the service worker + has notification templates", sharedJs21.includes("navigator.serviceWorker.register") && sharedJs21.includes("NOTIF_TEMPLATES"));

  // ---- Promo discount in fare math ----
  await call("/api/admin/promo-codes", { method: "POST", body: JSON.stringify({ code: "V21PCT", discount_type: "percent", discount_value: 10 }), session: "admin" });
  const farePct = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Pattoki", vehicle: "car", promo_code: "V21PCT" }) });
  check("fare with 10% promo: base 980, discount 98, final 882", farePct.base_fare === 980 && farePct.discount_amount === 98 && farePct.suggested_fare === 882, JSON.stringify(farePct));
  await call("/api/admin/promo-codes", { method: "POST", body: JSON.stringify({ code: "V21FIX", discount_type: "fixed", discount_value: 200 }), session: "admin" });
  const fareFix = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Pattoki", vehicle: "car", promo_code: "V21FIX" }) });
  check("fare with fixed Rs 200 promo: base 980, discount 200, final 780", fareFix.base_fare === 980 && fareFix.discount_amount === 200 && fareFix.suggested_fare === 780, JSON.stringify(fareFix));
  await call("/api/admin/promo-codes", { method: "POST", body: JSON.stringify({ code: "V21EXP", discount_type: "percent", discount_value: 10, valid_from: Date.now() - 86400000, valid_to: Date.now() - 1000 }), session: "admin" });
  await expectFail("expired promo rejected in fare -> 400", () => call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Pattoki", vehicle: "car", promo_code: "V21EXP" }) }), 400);
  await expectFail("unknown promo code -> 400", () => call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Pattoki", vehicle: "car", promo_code: "NOPE99" }) }), 400);
  await call("/api/admin/promo-codes", { method: "POST", body: JSON.stringify({ code: "V21ONE", discount_type: "percent", discount_value: 10, max_uses: 1 }), session: "admin" });

  // The discount must land in the FINAL ride fare, not just the estimate.
  const promoRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.id, pickup: "Chunian City", destination: "Pattoki", vehicle: "car", proposed_fare: 882, promo_code: "V21PCT" }), session: "rider" });
  check("promo ride booked: discount 98 stored on the ride", promoRide.discount_amount === 98 && promoRide.suggested_fare === 882 && promoRide.promo_code === "V21PCT", JSON.stringify(promoRide));
  // Privacy: driver requests must NOT expose the rider's phone number.
  const openReqs = await call(`/api/drivers/${driverId}/requests`, { session: "driver" });
  check("driver requests API exposes NO rider phone numbers", openReqs.requests.length > 0 && openReqs.requests.every((r) => !("rider_phone" in r)), `requests=${openReqs.requests.length}`);
  const promoDetail = await call(`/api/rides/${promoRide.ride_id}`, { session: "rider" });
  const promoOffer = promoDetail.offers.find((o) => o.status === "pending");
  check("seeded offer carries the discounted fare Rs 882", promoOffer && promoOffer.fare === 882, `got ${promoOffer && promoOffer.fare}`);
  const promoAccepted = await call(`/api/rides/${promoRide.ride_id}/offers/${promoOffer.id}/accept`, { method: "POST", body: "{}", session: "rider" });
  check("promo ride accepted at discounted fare Rs 882", promoAccepted.agreed_fare === 882, `got ${promoAccepted.agreed_fare}`);
  await call(`/api/rides/${promoRide.ride_id}/start`, { method: "POST", body: "{}", session: "driver" });
  const promoDone = await call(`/api/rides/${promoRide.ride_id}/complete`, { method: "POST", body: JSON.stringify({ cash_received: true }), session: "driver" });
  check("promo ride completed: fare 882, platform take 126 (106 + 20), kept 756", promoDone.platform_take === 126 && promoDone.fare === 882 && promoDone.driver_kept === 756, JSON.stringify(promoDone));
  // Fixed promo ride: offer must be the discounted 780 (cancelled after, not completed).
  const fixRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.id, pickup: "Chunian City", destination: "Pattoki", vehicle: "car", proposed_fare: 780, promo_code: "V21FIX" }), session: "rider" });
  const fixDetail = await call(`/api/rides/${fixRide.ride_id}`, { session: "rider" });
  const fixOffer = fixDetail.offers.find((o) => o.status === "pending");
  check("fixed-promo ride offer = Rs 780", fixOffer && fixOffer.fare === 780, `got ${fixOffer && fixOffer.fare}`);
  await call(`/api/rides/${fixRide.ride_id}/cancel`, { method: "POST", body: "{}", session: "rider" });
  // Max-uses: V21ONE works once, then fails.
  const oneRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.id, pickup: "Chunian City", destination: "Pattoki", vehicle: "car", proposed_fare: 882, promo_code: "V21ONE" }), session: "rider" });
  check("max-uses=1 promo books once", !!oneRide.ride_id);
  await expectFail("max-uses promo second booking -> 400", () => call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.id, pickup: "Chunian City", destination: "Pattoki", vehicle: "car", proposed_fare: 882, promo_code: "V21ONE" }), session: "rider" }), 400);
  await call(`/api/rides/${oneRide.ride_id}/cancel`, { method: "POST", body: "{}", session: "rider" });

  // ---- Withdrawals (v2.1) — hold / approve / reject-refund, double-action guards ----
  const wBal0 = (await call(`/api/drivers/${driverId}/wallet`, { session: "driver" })).wallet_balance;
  const w1 = await call("/api/drivers/me/withdraw", { method: "POST", body: JSON.stringify({ amount: 1000, jazzcash_number: "0301-0000003" }), session: "driver" });
  check("withdrawal request created (pending, hold)", w1.status === "pending" && !!w1.request_id, JSON.stringify(w1));
  const wBal1 = (await call(`/api/drivers/${driverId}/wallet`, { session: "driver" })).wallet_balance;
  check("withdrawal hold deducts Rs 1000 from wallet", wBal1 === wBal0 - 1000, `${wBal0} -> ${wBal1}`);
  await expectFail("rider cannot call driver withdrawal endpoint -> 403", () => call("/api/drivers/me/withdraw", { method: "POST", body: JSON.stringify({ amount: 100, jazzcash_number: "0309-9999999" }), session: "rider" }), 403);
  await expectFail("driver cannot withdraw for another driver -> 403", () => call("/api/drivers/me/withdraw", { method: "POST", body: JSON.stringify({ amount: 100, jazzcash_number: "0301-0000003", driver_id: 999001 }), session: "driver" }), 403);
  await expectFail("withdrawal above balance -> 400", () => call("/api/drivers/me/withdraw", { method: "POST", body: JSON.stringify({ amount: 999999, jazzcash_number: "0301-0000003" }), session: "driver" }), 400);
  await expectFail("withdrawal below Rs 100 minimum -> 400", () => call("/api/drivers/me/withdraw", { method: "POST", body: JSON.stringify({ amount: 50, jazzcash_number: "0301-0000003" }), session: "driver" }), 400);
  const wList = await call("/api/admin/withdrawals?status=pending", { session: "admin" });
  check("admin sees pending withdrawal", wList.withdrawals.some((w) => w.id === w1.request_id && w.amount === 1000));
  const wApprove = await call(`/api/admin/withdrawals/${w1.request_id}/approve`, { method: "POST", body: "{}", session: "admin" });
  check("withdrawal approved, hold stays deducted (owner pays manually)", wApprove.status === "approved" && wApprove.wallet_balance === wBal1, `balance Rs ${wApprove.wallet_balance}`);
  await expectFail("double-approve of withdrawal -> 400", () => call(`/api/admin/withdrawals/${w1.request_id}/approve`, { method: "POST", body: "{}", session: "admin" }), 400);
  const wBal2 = (await call(`/api/drivers/${driverId}/wallet`, { session: "driver" })).wallet_balance;
  check("balance unchanged after double-approve attempt", wBal2 === wBal1, `balance Rs ${wBal2}`);
  const w2 = await call("/api/drivers/me/withdraw", { method: "POST", body: JSON.stringify({ amount: 500, jazzcash_number: "0301-0000003" }), session: "driver" });
  const wBal3 = (await call(`/api/drivers/${driverId}/wallet`, { session: "driver" })).wallet_balance;
  check("second withdrawal holds Rs 500", wBal3 === wBal2 - 500, `${wBal2} -> ${wBal3}`);
  const wReject = await call(`/api/admin/withdrawals/${w2.request_id}/reject`, { method: "POST", body: JSON.stringify({ reason: "test reject" }), session: "admin" });
  check("withdrawal rejected, hold refunded", wReject.status === "rejected" && wReject.wallet_balance === wBal2, `balance Rs ${wReject.wallet_balance}`);
  await expectFail("double-reject of withdrawal -> 400", () => call(`/api/admin/withdrawals/${w2.request_id}/reject`, { method: "POST", body: JSON.stringify({ reason: "again" }), session: "admin" }), 400);
  const wBal4 = (await call(`/api/drivers/${driverId}/wallet`, { session: "driver" })).wallet_balance;
  check("balance unchanged after double-reject attempt", wBal4 === wBal2, `balance Rs ${wBal4}`);
  const myW = await call("/api/drivers/me/withdrawals", { session: "driver" });
  check("driver sees own withdrawal history (2 requests)", myW.withdrawals.length === 2, `got ${myW.withdrawals.length}`);
  await expectFail("rider cannot list driver withdrawals -> 403", () => call("/api/drivers/me/withdrawals", { session: "rider" }), 403);
  await expectFail("driver cannot use admin withdrawal list -> 403", () => call("/api/admin/withdrawals", { session: "driver" }), 403);

  // ---- Notifications (v2.1) — rider, driver AND admin feeds ----
  const riderNotifs = await call("/api/notifications", { session: "rider" });
  const riderTypes = riderNotifs.notifications.map((n) => n.type);
  check("rider feed has offer_received + ride_started + ride_completed + scheduled_booked", riderTypes.includes("offer_received") && riderTypes.includes("ride_started") && riderTypes.includes("ride_completed") && riderTypes.includes("scheduled_booked"), riderTypes.join(","));
  check("rider unread count > 0", riderNotifs.unread_count > 0, `unread=${riderNotifs.unread_count}`);
  const driverNotifs = await call("/api/notifications", { session: "driver" });
  const driverTypes = driverNotifs.notifications.map((n) => n.type);
  check("driver feed has ride_accepted + trip_completed + tip_received + scheduled_request", driverTypes.includes("ride_accepted") && driverTypes.includes("trip_completed") && driverTypes.includes("tip_received") && driverTypes.includes("scheduled_request"), driverTypes.join(","));
  check("driver feed has topup_approved + topup_rejected + withdrawal_approved + withdrawal_rejected", driverTypes.includes("topup_approved") && driverTypes.includes("topup_rejected") && driverTypes.includes("withdrawal_approved") && driverTypes.includes("withdrawal_rejected"), driverTypes.join(","));
  const adminNotifs = await call("/api/notifications", { session: "admin" });
  const adminTypes = adminNotifs.notifications.map((n) => n.type);
  check("admin feed has topup_requested + withdrawal_requested", adminTypes.includes("topup_requested") && adminTypes.includes("withdrawal_requested"), adminTypes.join(","));
  check("admin unread count > 0", adminNotifs.unread_count > 0, `unread=${adminNotifs.unread_count}`);
  const riderUnreadBefore = riderNotifs.unread_count;
  const firstRiderNotif = riderNotifs.notifications.find((n) => n.is_read === 0);
  if (firstRiderNotif) {
    await call(`/api/notifications/${firstRiderNotif.id}/read`, { method: "POST", body: "{}", session: "rider" });
    const after = await call("/api/notifications", { session: "rider" });
    check("mark one read drops rider unread count by 1", after.unread_count === riderUnreadBefore - 1, `${riderUnreadBefore} -> ${after.unread_count}`);
  } else {
    check("mark one read drops rider unread count by 1", false, "no unread rider notification found");
  }
  await call("/api/notifications/read-all", { method: "POST", body: "{}", session: "driver" });
  const driverAfterAll = await call("/api/notifications", { session: "driver" });
  check("read-all clears driver unread count", driverAfterAll.unread_count === 0, `unread=${driverAfterAll.unread_count}`);
  await expectFail("unauthenticated notifications -> 401", () => call("/api/notifications"), 401);
  const adminNotifId = adminNotifs.notifications[0] && adminNotifs.notifications[0].id;
  if (adminNotifId) {
    await expectFail("rider cannot mark an admin notification read -> 404", () => call(`/api/notifications/${adminNotifId}/read`, { method: "POST", body: "{}", session: "rider" }), 404);
  }
  // Complaint resolve -> complainant gets complaint_resolved.
  const complaints = await call("/api/admin/complaints", { session: "admin" });
  const openComplaint = complaints.complaints.find((c) => c.status === "open");
  if (openComplaint) {
    await call(`/api/admin/complaints/${openComplaint.id}/resolve`, { method: "POST", body: "{}", session: "admin" });
    const riderNotifs3 = await call("/api/notifications", { session: "rider" });
    check("rider gets complaint_resolved notification", riderNotifs3.notifications.some((n) => n.type === "complaint_resolved"), `complaint #${openComplaint.id}`);
  } else {
    check("rider gets complaint_resolved notification", false, "no open complaint found");
  }

  // ---- Refunds (v2.1, admin-only, idempotent) ----
  const riderBalBefore = (await call("/api/wallet/me", { session: "rider" })).balance;
  const refundKey = "smoke-refund-" + Date.now();
  const refund = await call("/api/admin/refunds", { method: "POST", body: JSON.stringify({ user_id: rider.id, amount: 200, reason: "smoke refund", idempotency_key: refundKey }), session: "admin" });
  check("refund credits rider wallet +Rs 200", refund.ok === true && refund.wallet_balance === riderBalBefore + 200, `balance ${riderBalBefore} -> ${refund.wallet_balance}`);
  const refundDup = await call("/api/admin/refunds", { method: "POST", body: JSON.stringify({ user_id: rider.id, amount: 200, reason: "smoke refund", idempotency_key: refundKey }), session: "admin" });
  check("same idempotency key returns duplicate, no second credit", refundDup.duplicate === true && refundDup.wallet_balance === riderBalBefore + 200, JSON.stringify(refundDup));
  const riderBalAfter = (await call("/api/wallet/me", { session: "rider" })).balance;
  check("rider balance unchanged after duplicate refund", riderBalAfter === riderBalBefore + 200, `balance Rs ${riderBalAfter}`);
  const riderNotifs2 = await call("/api/notifications", { session: "rider" });
  check("rider gets refund_credited notification", riderNotifs2.notifications.some((n) => n.type === "refund_credited"));
  await expectFail("rider cannot issue a refund -> 403", () => call("/api/admin/refunds", { method: "POST", body: JSON.stringify({ user_id: rider.id, amount: 100, reason: "nope" }), session: "rider" }), 403);
  await expectFail("refund to unknown user -> 400", () => call("/api/admin/refunds", { method: "POST", body: JSON.stringify({ user_id: 999001, amount: 100, reason: "nope" }), session: "admin" }), 400);

  // ---- Rider wallet top-up (v2.1) ----
  const rTop = await call("/api/topup", { method: "POST", body: JSON.stringify({ amount: 500, method: "JazzCash", tid: "SMOKE-RIDER-TID" }), session: "rider" });
  check("rider top-up creates a pending request", rTop.status === "pending" && !!rTop.request_id, JSON.stringify(rTop));
  const riderWalletMid = await call("/api/wallet/me", { session: "rider" });
  check("rider balance unchanged while top-up pending", riderWalletMid.balance === riderBalBefore + 200, `balance Rs ${riderWalletMid.balance}`);
  check("rider wallet shows pending top-up", riderWalletMid.pending_topups.some((t) => t.id === rTop.request_id));
  const adminTopups2 = await call("/api/admin/topups?status=pending", { session: "admin" });
  check("admin queue shows the rider top-up too", adminTopups2.topups.some((t) => t.id === rTop.request_id));
  const rTopApprove = await call(`/api/admin/topups/${rTop.request_id}/approve`, { method: "POST", body: "{}", session: "admin" });
  check("rider top-up approved, wallet +Rs 500", rTopApprove.wallet_balance === riderBalBefore + 200 + 500, `balance Rs ${rTopApprove.wallet_balance}`);
  await expectFail("double-approve of rider top-up -> 400", () => call(`/api/admin/topups/${rTop.request_id}/approve`, { method: "POST", body: "{}", session: "admin" }), 400);
  const riderWalletFinal = await call("/api/wallet/me", { session: "rider" });
  check("rider balance still exactly +500 after double-approve", riderWalletFinal.balance === riderBalBefore + 200 + 500, `balance Rs ${riderWalletFinal.balance}`);
  await expectFail("rider top-up below minimum -> 400", () => call("/api/topup", { method: "POST", body: JSON.stringify({ amount: 100, method: "JazzCash", tid: "SMOKE-LOW2" }), session: "rider" }), 400);
  await expectFail("unauthenticated top-up -> 401", () => call("/api/topup", { method: "POST", body: JSON.stringify({ amount: 500, method: "JazzCash", tid: "X" }) }), 401);

  // ---- New driver registration + documents + approval (v2.2 gate) ----
  // The v2.2 document gate: a driver can only be approved once CNIC +
  // licence + vehicle documents are ALL approved. Approve-before-docs
  // must fail with the missing list.
  const newDriverRes = await callRaw("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Smoke Driver 2", phone: "0309-7777777", password: "driver2pass", role: "driver" }) });
  check("second driver signs up", newDriverRes.status === 200 && !!newDriverRes.data.user.id, `id=${newDriverRes.data.user && newDriverRes.data.user.id}`);
  saveCookie("driver2", newDriverRes.setCookie);
  const newDriver = newDriverRes.data.user;
  const reg = await call("/api/drivers/register", { method: "POST", body: JSON.stringify({ user_id: newDriver.id, vehicle_type: "bike", vehicle_model: "Honda CD 70", plate: "SMOKE-2", cnic: "35202-1111111-1", licence: "LIC-2", vehicle_reg: "REG-2" }), session: "driver2" });
  check("driver registration submitted (pending)", reg.status === "pending", JSON.stringify(reg));
  const approveEarly = await callRaw(`/api/admin/drivers/${newDriver.id}/approve`, { method: "POST", body: "{}", session: "admin" });
  check("approve with missing documents -> 400 listing CNIC, licence, vehicle", approveEarly.status === 400 && Array.isArray(approveEarly.data.missing_docs) && approveEarly.data.missing_docs.length === 3, JSON.stringify(approveEarly.data));
  const onlineEarly = await callRaw(`/api/drivers/${newDriver.id}/online`, { method: "POST", body: JSON.stringify({ online: true }), session: "driver2" });
  check("unapproved driver cannot go online -> 403", onlineEarly.status === 403, `got ${onlineEarly.status}`);

  // ---- Document photo upload (v2.1) — base64 in Turso, admin-only view ----
  const tinyJpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgKKKK+eP2E//Z";
  const docTypes = ["cnic_front", "cnic_back", "licence", "vehicle"];
  const docIds = {};
  for (const dt of docTypes) {
    const up = await call("/api/drivers/me/documents", { method: "POST", body: JSON.stringify({ doc_type: dt, mime: "image/jpeg", data_url: tinyJpeg }), session: "driver2" });
    check(`driver uploads ${dt} (pending)`, up.status === "pending" && !!up.document_id, JSON.stringify(up));
    docIds[dt] = up.document_id;
  }
  const myDocs = await call("/api/drivers/me/documents", { session: "driver2" });
  check("driver sees own document metadata (no data URL)", myDocs.documents.length === 4 && myDocs.documents.every((d) => !("data_url" in d)), JSON.stringify(myDocs.documents.map((d) => d.doc_type)));
  check("doc checklist: nothing verified yet", myDocs.doc_checklist && myDocs.doc_checklist.all === false && myDocs.doc_checklist.missing.length === 3, JSON.stringify(myDocs.doc_checklist));
  await expectFail("rider cannot fetch driver documents -> 403", () => call(`/api/admin/drivers/${newDriver.id}/documents`, { session: "rider" }), 403);
  await expectFail("driver A cannot fetch driver B documents -> 403", () => call(`/api/admin/drivers/${newDriver.id}/documents`, { session: "driver" }), 403);
  await expectFail("unauthenticated document fetch -> 401", () => call(`/api/admin/drivers/${newDriver.id}/documents`), 401);
  const adminDocs = await call(`/api/admin/drivers/${newDriver.id}/documents`, { session: "admin" });
  check("admin fetches driver documents WITH data URL", adminDocs.documents.length === 4 && adminDocs.documents.every((d) => d.data_url === tinyJpeg), `docs=${adminDocs.documents.length}`);
  for (const dt of docTypes) {
    const docApprove = await call(`/api/admin/documents/${docIds[dt]}/approve`, { method: "POST", body: "{}", session: "admin" });
    check(`admin approves ${dt}`, docApprove.status === "approved");
  }
  const myDocs2 = await call("/api/drivers/me/documents", { session: "driver2" });
  check("driver sees all documents approved + checklist all true", myDocs2.documents.every((d) => d.status === "approved") && myDocs2.doc_checklist.all === true, JSON.stringify(myDocs2.doc_checklist));
  const adminDrivers2 = await call("/api/admin/drivers", { session: "admin" });
  const d2row = adminDrivers2.drivers.find((x) => x.user_id === newDriver.id);
  check("admin drivers list shows the doc checklist (all true)", !!d2row && d2row.doc_checklist && d2row.doc_checklist.all === true, JSON.stringify(d2row && d2row.doc_checklist));
  await call(`/api/admin/drivers/${newDriver.id}/approve`, { method: "POST", body: "{}", session: "admin" });
  const d2Notifs = await call("/api/notifications", { session: "driver2" });
  check("new driver gets driver_approved notification", d2Notifs.notifications.some((n) => n.type === "driver_approved"), d2Notifs.notifications.map((n) => n.type).join(","));
  // Re-upload licence (replaces the approved row with a pending one), then reject it.
  const doc2 = await call("/api/drivers/me/documents", { method: "POST", body: JSON.stringify({ doc_type: "licence", mime: "image/jpeg", data_url: tinyJpeg }), session: "driver2" });
  const docReject = await call(`/api/admin/documents/${doc2.document_id}/reject`, { method: "POST", body: "{}", session: "admin" });
  check("admin rejects document", docReject.status === "rejected");
  await expectFail("document with bad mime -> 400", () => call("/api/drivers/me/documents", { method: "POST", body: JSON.stringify({ doc_type: "cnic_back", mime: "image/gif", data_url: tinyJpeg }), session: "driver2" }), 400);
  await expectFail("oversize document -> 400", () => call("/api/drivers/me/documents", { method: "POST", body: JSON.stringify({ doc_type: "cnic_back", mime: "image/jpeg", data_url: "data:image/jpeg;base64," + "A".repeat(2100000) }), session: "driver2" }), 400);
  await expectFail("rider cannot upload documents -> 403", () => call("/api/drivers/me/documents", { method: "POST", body: JSON.stringify({ doc_type: "cnic_front", mime: "image/jpeg", data_url: tinyJpeg }), session: "rider" }), 403);
  const d2Notifs2 = await call("/api/notifications", { session: "driver2" });
  check("driver gets doc_approved + doc_rejected notifications", d2Notifs2.notifications.some((n) => n.type === "doc_approved") && d2Notifs2.notifications.some((n) => n.type === "doc_rejected"), d2Notifs2.notifications.map((n) => n.type).join(","));

  // ---- Security (v2.1) ----
  // Phone-only rate limiting: 6 wrong logins for the same phone from
  // ROTATING IPs must still trip the limiter (the old IP+phone key would
  // let each IP have its own 5 attempts).
  for (let i = 0; i < 5; i++) {
    await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.0.0.${i + 1}` }, body: JSON.stringify({ phone: "0300-0000002", password: "wrong" }) });
  }
  const sixthRotating = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.0.0.99" }, body: JSON.stringify({ phone: "0300-0000002", password: "wrong" }) });
  check("phone-only rate limit: 6th wrong login from a NEW IP -> 429", sixthRotating.status === 429, `got ${sixthRotating.status}`);
  // Role confusion + session requirements.
  await expectFail("rider token on driver-only endpoint -> 403", () => call(`/api/drivers/${driverId}/wallet`, { session: "rider" }), 403);
  await expectFail("driver token on admin endpoint -> 403", () => call("/api/admin/withdrawals", { session: "driver" }), 403);
  await expectFail("admin token on driver-only endpoint -> 403", () => call("/api/drivers/me/withdrawals", { session: "admin" }), 403);
  await expectFail("unauthenticated withdrawals -> 401", () => call("/api/drivers/me/withdrawals"), 401);
  await expectFail("unauthenticated documents -> 401", () => call("/api/drivers/me/documents"), 401);
  await expectFail("unauthenticated admin withdrawals -> 401", () => call("/api/admin/withdrawals"), 401);

  // ================= Phase 3 — CONTROLLED PILOT LAUNCH (v2.2) =================
  // Toggle pilot ON (it was OFF for the legacy flow above) — both flags.
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ pilot_mode: "1", pilot_chunian_only: "1" }), session: "admin" });
  const pilotOn = await call("/api/settings");
  check("pilot mode toggled back ON", String(pilotOn.settings.pilot_mode) === "1" && String(pilotOn.settings.pilot_chunian_only) === "1");
  const auditPilotOn = await call("/api/admin/audit-log?action=pilot_mode_toggle", { session: "admin" });
  check("second pilot toggle also audited", auditPilotOn.audit_log.length >= 2, `entries=${auditPilotOn.audit_log.length}`);

  // ---- Whitelist: add / duplicate / RBAC / caps (both layers) ----
  const wlRider = await call("/api/admin/pilot-whitelist", { method: "POST", body: JSON.stringify({ phone: "0309-6666666", role: "rider" }), session: "admin" });
  check("whitelist add: pilot rider", wlRider.status === "pending" && wlRider.phone === "03096666666", JSON.stringify(wlRider));
  const wlDriver = await call("/api/admin/pilot-whitelist", { method: "POST", body: JSON.stringify({ phone: "0309-6666667", role: "driver" }), session: "admin" });
  check("whitelist add: pilot driver", wlDriver.status === "pending" && wlDriver.phone === "03096666667", JSON.stringify(wlDriver));
  await expectFail("duplicate whitelist add -> 409", () => call("/api/admin/pilot-whitelist", { method: "POST", body: JSON.stringify({ phone: "0309-6666667", role: "driver" }), session: "admin" }), 409);
  await expectFail("rider cannot add to whitelist -> 403", () => call("/api/admin/pilot-whitelist", { method: "POST", body: JSON.stringify({ phone: "0309-6666660", role: "rider" }), session: "rider" }), 403);
  await expectFail("unauthenticated whitelist list -> 401", () => call("/api/admin/pilot-whitelist"), 401);
  const wlList = await call("/api/admin/pilot-whitelist", { session: "admin" });
  check("whitelist list shows caps 10/20 + counts", wlList.caps.drivers === 10 && wlList.caps.riders === 20 && wlList.whitelist.length === 2, JSON.stringify(wlList.caps));

  // Whitelisted signup works; the entry flips to approved.
  const pRiderRes = await callRaw("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Pilot Rider", phone: "0309-6666666", password: "pilotrider", role: "rider" }) });
  check("whitelisted rider signs up", pRiderRes.status === 200 && !!pRiderRes.data.user.id, `id=${pRiderRes.data.user && pRiderRes.data.user.id}`);
  saveCookie("pilotRider", pRiderRes.setCookie);
  const pilotRider = pRiderRes.data.user;
  const pDriverRes = await callRaw("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Pilot Driver", phone: "0309-6666667", password: "pilotdriver", role: "driver" }) });
  check("whitelisted driver signs up", pDriverRes.status === 200 && !!pDriverRes.data.user.id, `id=${pDriverRes.data.user && pDriverRes.data.user.id}`);
  saveCookie("pilotDriver", pDriverRes.setCookie);
  const pilotDriver = pDriverRes.data.user;

  // Caps — add layer: a second driver whitelisted first, then cap lowered.
  await call("/api/admin/pilot-whitelist", { method: "POST", body: JSON.stringify({ phone: "0309-6666668", role: "driver" }), session: "admin" });
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ pilot_max_drivers: 1 }), session: "admin" });
  await expectFail("whitelist add beyond driver cap -> 400", () => call("/api/admin/pilot-whitelist", { method: "POST", body: JSON.stringify({ phone: "0309-6666660", role: "driver" }), session: "admin" }), 400);
  await expectFail("signup beyond live driver cap -> 403", () => call("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Pilot Driver B", phone: "0309-6666668", password: "pilotdriverb", role: "driver" }) }), 403);
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ pilot_max_drivers: 10 }), session: "admin" });
  await call("/api/admin/pilot-whitelist", { method: "POST", body: JSON.stringify({ phone: "0309-6666669", role: "rider" }), session: "admin" });
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ pilot_max_riders: 1 }), session: "admin" });
  await expectFail("whitelist add beyond rider cap -> 400", () => call("/api/admin/pilot-whitelist", { method: "POST", body: JSON.stringify({ phone: "0309-6666661", role: "rider" }), session: "admin" }), 400);
  await expectFail("signup beyond live rider cap -> 403", () => call("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Pilot Rider B", phone: "0309-6666669", password: "pilotriderb", role: "rider" }) }), 403);
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ pilot_max_riders: 20 }), session: "admin" });

  // ---- Document gate (pilot driver) + legacy online gate ----
  const pReg = await call("/api/drivers/register", { method: "POST", body: JSON.stringify({ user_id: pilotDriver.id, vehicle_type: "bike", vehicle_model: "Honda CD 70", plate: "PILOT-01", cnic: "35202-6666666-1", licence: "LIC-PILOT", vehicle_reg: "REG-PILOT" }), session: "pilotDriver" });
  check("pilot driver registration submitted (pending)", pReg.status === "pending", JSON.stringify(pReg));
  const pApproveEarly = await callRaw(`/api/admin/drivers/${pilotDriver.id}/approve`, { method: "POST", body: "{}", session: "admin" });
  check("pilot driver approve with missing docs -> 400", pApproveEarly.status === 400 && pApproveEarly.data.missing_docs && pApproveEarly.data.missing_docs.length === 3, JSON.stringify(pApproveEarly.data));
  // A driver approved BEFORE the gate (demo Hassan Ali) cannot go online
  // until his documents are verified.
  const allDrv = await call("/api/admin/drivers", { session: "admin" });
  const hassanRow = allDrv.drivers.find((x) => x.name === "Hassan Ali");
  const hassanLogin = await callRaw("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0301-0000004", password: "hassanpass" }) });
  check("demo driver Hassan logs in (claims account)", hassanLogin.status === 200 && hassanLogin.data.claimed === true);
  saveCookie("hassan", hassanLogin.setCookie);
  const hassanOnline = await callRaw(`/api/drivers/${hassanRow.user_id}/online`, { method: "POST", body: JSON.stringify({ online: true }), session: "hassan" });
  check("legacy approved driver without verified docs cannot go online -> 403", hassanOnline.status === 403, `got ${hassanOnline.status}`);
  // Pilot driver: upload + approve all four documents, then approve + online.
  const pDocIds = {};
  for (const dt of ["cnic_front", "cnic_back", "licence", "vehicle"]) {
    const up = await call("/api/drivers/me/documents", { method: "POST", body: JSON.stringify({ doc_type: dt, mime: "image/jpeg", data_url: tinyJpeg }), session: "pilotDriver" });
    pDocIds[dt] = up.document_id;
  }
  for (const dt of ["cnic_front", "cnic_back", "licence", "vehicle"]) {
    await call(`/api/admin/documents/${pDocIds[dt]}/approve`, { method: "POST", body: "{}", session: "admin" });
  }
  const pDocs = await call("/api/drivers/me/documents", { session: "pilotDriver" });
  check("pilot driver doc checklist all true", pDocs.doc_checklist && pDocs.doc_checklist.all === true, JSON.stringify(pDocs.doc_checklist));
  const pApprove = await callRaw(`/api/admin/drivers/${pilotDriver.id}/approve`, { method: "POST", body: "{}", session: "admin" });
  check("pilot driver approve with all docs approved -> 200", pApprove.status === 200, `got ${pApprove.status}`);
  const pOnline = await callRaw(`/api/drivers/${pilotDriver.id}/online`, { method: "POST", body: JSON.stringify({ online: true, lat: 30.9667, lng: 74.0333 }), session: "pilotDriver" });
  check("verified pilot driver goes online -> 200", pOnline.status === 200, `got ${pOnline.status}`);

  // ---- Chunian-only lock at ride-create time (fare was checked at the top) ----
  await expectFail("pilot lock: ride Chunian->Lahore -> 400", () => call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, pickup: "Chunian City", destination: "Lahore", vehicle: "bike", proposed_fare: 6000 }), session: "pilotRider" }), 400);
  await expectFail("pilot lock: ride Chunian->Pattoki -> 400", () => call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, pickup: "Chunian City", destination: "Pattoki", vehicle: "bike", proposed_fare: 300 }), session: "pilotRider" }), 400);

  // ---- Pilot ride E2E (bike, Chunian City -> Chunian City, 3 km, Rs 50) ----
  const pTop = await call(`/api/drivers/${pilotDriver.id}/topup`, { method: "POST", body: JSON.stringify({ amount: 500, method: "JazzCash", tid: "PILOT-TID-1" }), session: "pilotDriver" });
  check("pilot driver top-up request created", pTop.status === "pending" && !!pTop.request_id, JSON.stringify(pTop));
  const pTopApprove = await call(`/api/admin/topups/${pTop.request_id}/approve`, { method: "POST", body: "{}", session: "admin" });
  check("pilot top-up approved, wallet Rs 500", pTopApprove.wallet_balance === 500, `balance Rs ${pTopApprove.wallet_balance}`);
  const pRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, pickup: "Chunian City", destination: "Chunian City", vehicle: "bike", distance_km: 3, proposed_fare: 50 }), session: "pilotRider" });
  check("pilot ride booked (Chunian->Chunian)", !!pRide.ride_id && pRide.suggested_fare === 50, JSON.stringify(pRide));
  check("pilot ride seeded offers from online bike drivers", pRide.offers_created >= 1, `offers=${pRide.offers_created}`);
  const pDetail = await call(`/api/rides/${pRide.ride_id}`, { session: "pilotRider" });
  const pOffer = pDetail.offers.find((o) => o.driver_id === pilotDriver.id && o.status === "pending");
  check("pilot driver has a seeded offer at Rs 50", !!pOffer && pOffer.fare === 50, JSON.stringify(pOffer));
  const pAccepted = await call(`/api/rides/${pRide.ride_id}/offers/${pOffer.id}/accept`, { method: "POST", body: "{}", session: "pilotRider" });
  check("pilot ride accepted at Rs 50", pAccepted.agreed_fare === 50, `got Rs ${pAccepted.agreed_fare}`);
  await call(`/api/rides/${pRide.ride_id}/start`, { method: "POST", body: "{}", session: "pilotDriver" });
  const pDone = await call(`/api/rides/${pRide.ride_id}/complete`, { method: "POST", body: JSON.stringify({ cash_received: true }), session: "pilotDriver" });
  check("pilot ride completed: fare 50, platform take 26 (6 + 20), kept 24", pDone.platform_take === 26 && pDone.fare === 50 && pDone.driver_kept === 24, JSON.stringify(pDone));
  check("pilot driver wallet 500 - 26 = 474", pDone.driver_wallet_balance === 474, `balance Rs ${pDone.driver_wallet_balance}`);
  const pRated = await call(`/api/rides/${pRide.ride_id}/rate`, { method: "POST", body: JSON.stringify({ by: "rider", stars: 5 }), session: "pilotRider" });
  check("pilot ride rated 5 stars", pRated.rated === true && pRated.stars === 5);
  const pTip = await call(`/api/rides/${pRide.ride_id}/tip`, { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, amount: 20 }), session: "pilotRider" });
  check("pilot tip Rs 20 recorded, 0% commission", pTip.tip === 20 && pTip.commission_on_tip === 0, JSON.stringify(pTip));

  // ---- SOS ride: start, SOS, then cancel with a reason ----
  const pRide2 = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, pickup: "Chunian City", destination: "Chunian City", vehicle: "bike", distance_km: 3, proposed_fare: 50 }), session: "pilotRider" });
  const pDetail2 = await call(`/api/rides/${pRide2.ride_id}`, { session: "pilotRider" });
  const pOffer2 = pDetail2.offers.find((o) => o.driver_id === pilotDriver.id && o.status === "pending");
  await call(`/api/rides/${pRide2.ride_id}/offers/${pOffer2.id}/accept`, { method: "POST", body: "{}", session: "pilotRider" });
  await call(`/api/rides/${pRide2.ride_id}/start`, { method: "POST", body: "{}", session: "pilotDriver" });
  const pSos = await call(`/api/rides/${pRide2.ride_id}/sos`, { method: "POST", body: JSON.stringify({ message: "pilot SOS test" }), session: "pilotRider" });
  check("pilot SOS returns Police 15 / Rescue 1122", pSos.police === "15" && pSos.rescue === "1122");
  const adminNotifsPilot = await call("/api/notifications", { session: "admin" });
  check("admin feed has the sos_alert notification", adminNotifsPilot.notifications.some((n) => n.type === "sos_alert" && n.ride_id === pRide2.ride_id), adminNotifsPilot.notifications.map((n) => n.type).join(","));
  const pCancel = await call(`/api/rides/${pRide2.ride_id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Pilot test cancel" }), session: "pilotRider" });
  check("pilot ride cancelled with reason", pCancel.status === "cancelled");

  // ---- Withdrawal (reject -> auto-refund) + refund on the pilot accounts ----
  const pW = await call("/api/drivers/me/withdraw", { method: "POST", body: JSON.stringify({ amount: 100, jazzcash_number: "03096666667" }), session: "pilotDriver" });
  check("pilot withdrawal request created (hold)", pW.status === "pending" && !!pW.request_id, JSON.stringify(pW));
  const pWBal = (await call(`/api/drivers/${pilotDriver.id}/wallet`, { session: "pilotDriver" })).wallet_balance;
  check("pilot withdrawal hold: 474 - 100 = 374", pWBal === 374, `balance Rs ${pWBal}`);
  const pWReject = await call(`/api/admin/withdrawals/${pW.request_id}/reject`, { method: "POST", body: JSON.stringify({ reason: "pilot test reject" }), session: "admin" });
  check("pilot withdrawal rejected, hold refunded to 474", pWReject.wallet_balance === 474, `balance Rs ${pWReject.wallet_balance}`);
  const pRefund = await call("/api/admin/refunds", { method: "POST", body: JSON.stringify({ user_id: pilotRider.id, amount: 50, reason: "pilot test refund", idempotency_key: "pilot-refund-1" }), session: "admin" });
  check("pilot refund credits rider wallet +Rs 50", pRefund.ok === true && pRefund.wallet_balance === 50, JSON.stringify(pRefund));

  // ---- Pilot live board ----
  const pStatus = await call("/api/admin/pilot-status", { session: "admin" });
  check("pilot-status: mode ON, caps 10/20", pStatus.pilot_mode === true && pStatus.caps.drivers === 10 && pStatus.caps.riders === 20, JSON.stringify(pStatus.caps));
  check("pilot-status: drivers whitelisted >= 2, signed up >= 1, verified >= 1, online >= 1", pStatus.drivers.whitelisted >= 2 && pStatus.drivers.signed_up >= 1 && pStatus.drivers.verified >= 1 && pStatus.drivers.online >= 1, JSON.stringify(pStatus.drivers));
  check("pilot-status: riders whitelisted >= 2, signed up >= 1", pStatus.riders.whitelisted >= 2 && pStatus.riders.signed_up >= 1, JSON.stringify(pStatus.riders));
  check("pilot-status: rides today completed >= 1, open SOS >= 1", pStatus.rides_today.completed >= 1 && pStatus.open_sos.length >= 1, JSON.stringify({ rides_today: pStatus.rides_today, open_sos: pStatus.open_sos.length }));
  check("pilot-status: pending top-ups 0, driver wallets > 0", pStatus.pending.topups === 0 && pStatus.wallets.drivers > 0, JSON.stringify({ pending: pStatus.pending, wallets: pStatus.wallets }));
  await expectFail("rider cannot read pilot-status -> 403", () => call("/api/admin/pilot-status", { session: "pilotRider" }), 403);

  // ---- Pilot report + reconciliation (must be zero discrepancies) ----
  const pReport = await call("/api/admin/pilot-report?days=7", { session: "admin" });
  check("pilot-report: completed rides >= 1, commission earned >= 26", pReport.rides.completed >= 1 && pReport.financials.commission_earned >= 26, JSON.stringify({ completed: pReport.rides.completed, commission: pReport.financials.commission_earned }));
  check("pilot-report: pilot driver rated 5.0", (pReport.ratings_by_driver || []).some((x) => x.driver_id === pilotDriver.id && Number(x.avg_rating) === 5), JSON.stringify(pReport.ratings_by_driver));
  const pCancelled = (pReport.cancelled_bookings || []).find((r) => r.id === pRide2.ride_id);
  check("pilot-report: cancelled ride carries its reason", !!pCancelled && pCancelled.cancel_reason === "Pilot test cancel", JSON.stringify(pCancelled));
  check("pilot-report: reconciliation has ZERO discrepancies", (pReport.reconciliation.discrepancies || []).length === 0 && (pReport.reconciliation.checks || []).every((c) => c.ok), JSON.stringify(pReport.reconciliation.checks));
  await expectFail("rider cannot read pilot-report -> 403", () => call("/api/admin/pilot-report", { session: "pilotRider" }), 403);

  // ---- Financial audit completeness + filters + CSV export ----
  const auditAll = await call("/api/admin/audit-log", { session: "admin" });
  const auditActions = new Set(auditAll.audit_log.map((a) => a.action));
  const needActions = ["topup_request", "topup_approve", "topup_reject", "withdrawal_request", "withdrawal_approve", "withdrawal_reject", "refund_credit", "ride_settlement", "tip_recorded", "promo_applied", "sos_alert", "pilot_mode_toggle", "whitelist_add", "driver_approve"];
  check("audit log contains every financial action type", needActions.every((a) => auditActions.has(a)), `missing: ${needActions.filter((a) => !auditActions.has(a)).join(",")}`);
  const auditSettle = await call("/api/admin/audit-log?action=ride_settlement", { session: "admin" });
  check("audit filter by action returns only ride_settlement rows", auditSettle.audit_log.length >= 1 && auditSettle.audit_log.every((a) => a.action === "ride_settlement"), `rows=${auditSettle.audit_log.length}`);
  const csvRes = await fetch(BASE + "/api/admin/audit-log/export", { headers: { Cookie: jar.admin } });
  const csvText = await csvRes.text();
  check("audit CSV export: 200 + text/csv + all key actions", csvRes.status === 200 && (csvRes.headers.get("content-type") || "").includes("text/csv") && ["ride_settlement", "topup_request", "sos_alert", "pilot_mode_toggle"].every((a) => csvText.includes(a)), `HTTP ${csvRes.status}`);
  await expectFail("rider cannot export audit CSV -> 403", () => fetch(BASE + "/api/admin/audit-log/export", { headers: { Cookie: jar.pilotRider } }).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }), 403);

  // ---- Admin page carries the pilot section + audit filters ----
  const adminPagePilot = await (await fetch(BASE + "/admin")).text();
  check("admin page has pilot section + whitelist + audit filters", adminPagePilot.includes("sec-pilot") && adminPagePilot.includes("pilot-whitelist-out") && adminPagePilot.includes("audit-filter-action"));

  // ================= v2.3 =================
  // All v2.3 tests run on the pilot accounts (pilot mode is ON, bike,
  // Chunian City -> Chunian City) so nothing after them depends on state.
  const health23 = await call("/api/health");
  check("v2.5.0 health version is 2.5.0", health23.version === "2.5.0", `got ${health23.version}`);
  // Valid Web Push subscription keys for the subscribe tests: web-push
  // rejects anything else at send time (p256dh must be a 65-byte P-256
  // point, auth 16 bytes) — a made-up key string never reaches the wire.
  const { publicKey: testEcdhPub } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const testP256dh = Buffer.from(testEcdhPub.export({ type: "spki", format: "der" })).subarray(-65).toString("base64url");
  const testAuth = randomBytes(16).toString("base64url");
  const settings23 = await call("/api/settings");
  check("vapid_private_key is NOT exposed via /api/settings", !("vapid_private_key" in settings23.settings) && typeof settings23.settings.vapid_public_key === "string", `public key len=${String(settings23.settings.vapid_public_key || "").length}`);

  // ---- D-1 driver accept (happy path + second-accept + wrong-driver) ----
  const daRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, pickup: "Chunian City", destination: "Chunian City", vehicle: "bike", distance_km: 3, proposed_fare: 50 }), session: "pilotRider" });
  check("v2.3 ride booked for driver-accept test", !!daRide.ride_id, `ride #${daRide.ride_id}`);
  const daDetail = await call(`/api/rides/${daRide.ride_id}`, { session: "pilotRider" });
  const daOffer = daDetail.offers.find((o) => o.driver_id === pilotDriver.id && o.status === "pending");
  check("seeded offer carries expires_at = created_at + 240000 (4 min TTL)", !!daOffer && daOffer.expires_at === daOffer.created_at + 240000, JSON.stringify(daOffer));
  check("ride detail returns server_time_ms", typeof daDetail.server_time_ms === "number", `server_time_ms=${daDetail.server_time_ms}`);
  const pdNotifs = await call("/api/notifications", { session: "pilotDriver" });
  const nrr = pdNotifs.notifications.filter((n) => n.type === "new_ride_request" && n.ride_id === daRide.ride_id);
  check("new_ride_request notification created once for the driver", nrr.length === 1, `got ${nrr.length}`);
  check("new_ride_request params carry pickup/destination/vehicle/proposed fare", !!nrr[0] && nrr[0].params.pickup === "Chunian City" && nrr[0].params.destination === "Chunian City" && nrr[0].params.vehicle_type === "bike" && nrr[0].params.proposed_fare === 50 && nrr[0].params.ride_id === daRide.ride_id, JSON.stringify(nrr[0] && nrr[0].params));
  await call(`/api/rides/${daRide.ride_id}`, { session: "pilotDriver" });
  await call(`/api/drivers/${pilotDriver.id}/requests`, { session: "pilotDriver" });
  const pdNotifs2 = await call("/api/notifications", { session: "pilotDriver" });
  check("re-reading the ride does not re-notify (still exactly 1)", pdNotifs2.notifications.filter((n) => n.type === "new_ride_request" && n.ride_id === daRide.ride_id).length === 1);
  const daAccepted = await call(`/api/rides/${daRide.ride_id}/offers/${daOffer.id}/accept-driver`, { method: "POST", body: "{}", session: "pilotDriver" });
  check("driver accepts own offer, ride accepted at Rs 50", daAccepted.agreed_fare === 50 && daAccepted.driver_id === pilotDriver.id && daAccepted.accepted_by === "driver", JSON.stringify(daAccepted));
  await expectFail("second accept of the same offer (rider path) -> 400", () => call(`/api/rides/${daRide.ride_id}/offers/${daOffer.id}/accept`, { method: "POST", body: "{}", session: "pilotRider" }), 400);
  await expectFail("driver re-accept of the same offer -> 400", () => call(`/api/rides/${daRide.ride_id}/offers/${daOffer.id}/accept-driver`, { method: "POST", body: "{}", session: "pilotDriver" }), 400);
  const prNotifs = await call("/api/notifications", { session: "pilotRider" });
  check("rider notified ride_accepted after driver-accept", prNotifs.notifications.some((n) => n.type === "ride_accepted" && n.ride_id === daRide.ride_id));
  const daDetail2 = await call(`/api/rides/${daRide.ride_id}`, { session: "pilotRider" });
  check("other pending offers auto-declined on driver-accept", daDetail2.offers.filter((o) => o.driver_id !== pilotDriver.id).every((o) => o.status === "declined"), JSON.stringify(daDetail2.offers.map((o) => o.status)));

  // Driver cannot accept ANOTHER driver's offer.
  const daRide2 = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, pickup: "Chunian City", destination: "Chunian City", vehicle: "bike", distance_km: 3, proposed_fare: 50 }), session: "pilotRider" });
  const daDetail3 = await call(`/api/rides/${daRide2.ride_id}`, { session: "pilotRider" });
  const ahmedOffer = daDetail3.offers.find((o) => o.driver_id !== pilotDriver.id && o.status === "pending");
  check("second ride has another driver's seeded offer", !!ahmedOffer, JSON.stringify(daDetail3.offers.map((o) => o.driver_id)));
  if (ahmedOffer) {
    await expectFail("driver cannot accept another driver's offer -> 403", () => call(`/api/rides/${daRide2.ride_id}/offers/${ahmedOffer.id}/accept-driver`, { method: "POST", body: "{}", session: "pilotDriver" }), 403);
    await expectFail("rider (non-driver role) cannot use accept-driver -> 403", () => call(`/api/rides/${daRide2.ride_id}/offers/${ahmedOffer.id}/accept-driver`, { method: "POST", body: "{}", session: "pilotRider" }), 403);
  }

  // ---- Real pickup distance ----
  await call(`/api/drivers/${pilotDriver.id}/location`, { method: "POST", body: JSON.stringify({ lat: 30.97, lng: 74.03 }), session: "pilotDriver" });
  const reqs23 = await call(`/api/drivers/${pilotDriver.id}/requests`, { session: "pilotDriver" });
  const reqRide = reqs23.requests.find((r) => r.id === daRide2.ride_id);
  check("driver requests carry pickup_distance_km + eta + server_time_ms", !!reqRide && typeof reqRide.pickup_distance_km === "number" && reqRide.pickup_eta_min >= 1 && typeof reqs23.server_time_ms === "number", JSON.stringify(reqRide));
  check("place pickup + live driver GPS: distance ~0.48 km, eta 1 min, estimated=true", !!reqRide && reqRide.pickup_distance_km > 0.3 && reqRide.pickup_distance_km < 0.7 && reqRide.pickup_eta_min === 1 && reqRide.pickup_distance_estimated === true, JSON.stringify(reqRide));
  const detDriver = await call(`/api/rides/${daRide2.ride_id}`, { session: "pilotDriver" });
  check("ride detail carries pickup distance for the browsing driver", typeof detDriver.pickup_distance_km === "number" && detDriver.pickup_eta_min === 1, JSON.stringify({ km: detDriver.pickup_distance_km, eta: detDriver.pickup_eta_min }));
  const gpsRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, pickup: "Current location", destination: "Chunian City", vehicle: "bike", distance_km: 3, proposed_fare: 50, pickup_lat: 30.98, pickup_lng: 74.05 }), session: "pilotRider" });
  check("ride booked with GPS pickup coords", !!gpsRide.ride_id, `ride #${gpsRide.ride_id}`);
  const gpsDetail = await call(`/api/rides/${gpsRide.ride_id}`, { session: "pilotDriver" });
  check("GPS pickup coords stored + used for distance (estimated=false)", gpsDetail.ride.pickup_lat === 30.98 && gpsDetail.ride.pickup_lng === 74.05 && gpsDetail.pickup_distance_estimated === false && typeof gpsDetail.pickup_distance_km === "number" && gpsDetail.pickup_distance_km > 1, JSON.stringify({ lat: gpsDetail.ride.pickup_lat, km: gpsDetail.pickup_distance_km, est: gpsDetail.pickup_distance_estimated }));
  await call(`/api/rides/${gpsRide.ride_id}/cancel`, { method: "POST", body: "{}", session: "pilotRider" });
  await call(`/api/rides/${daRide2.ride_id}/cancel`, { method: "POST", body: "{}", session: "pilotRider" });

  // ---- WebRTC call signalling (on the driver-accepted ride) ----
  const sig = await call(`/api/rides/${daRide.ride_id}/call-signal`, { method: "POST", body: JSON.stringify({ kind: "offer", payload: { sdp: "smoke-sdp" } }), session: "pilotRider" });
  check("rider posts call signal (offer)", !!sig.signal_id, `id=${sig.signal_id}`);
  const sigs = await call(`/api/rides/${daRide.ride_id}/call-signal?after=0`, { session: "pilotDriver" });
  check("driver polls call signals, sees rider offer with payload", sigs.signals.some((s) => s.id === sig.signal_id && s.kind === "offer" && s.payload.sdp === "smoke-sdp"), JSON.stringify(sigs.signals));
  const sigsAfter = await call(`/api/rides/${daRide.ride_id}/call-signal?after=${sig.signal_id}`, { session: "pilotDriver" });
  check("call-signal ?after filters to newer signals only", sigsAfter.signals.length === 0, `got ${sigsAfter.signals.length}`);
  const sigAns = await call(`/api/rides/${daRide.ride_id}/call-signal`, { method: "POST", body: JSON.stringify({ kind: "answer", payload: { sdp: "smoke-answer" } }), session: "pilotDriver" });
  check("driver posts call signal (answer)", !!sigAns.signal_id);
  const sigsRider = await call(`/api/rides/${daRide.ride_id}/call-signal?after=${sig.signal_id}`, { session: "pilotRider" });
  check("rider polls and sees the driver answer", sigsRider.signals.some((s) => s.kind === "answer" && s.payload.sdp === "smoke-answer"));
  await expectFail("non-participant cannot post call signal -> 403", () => call(`/api/rides/${daRide.ride_id}/call-signal`, { method: "POST", body: JSON.stringify({ kind: "offer", payload: {} }), session: "rider" }), 403);
  await expectFail("non-participant cannot poll call signals -> 403", () => call(`/api/rides/${daRide.ride_id}/call-signal?after=0`, { session: "rider" }), 403);
  await expectFail("bad call-signal kind -> 400", () => call(`/api/rides/${daRide.ride_id}/call-signal`, { method: "POST", body: JSON.stringify({ kind: "bogus", payload: {} }), session: "pilotRider" }), 400);
  await expectFail("call signal on requested (not active) ride -> 403", () => call(`/api/rides/${daRide2.ride_id}/call-signal`, { method: "POST", body: JSON.stringify({ kind: "offer", payload: {} }), session: "pilotRider" }), 403);

  // ---- Chat v2.3: ?after/&limit + unread count (on the active ride) ----
  const chat23a = await call(`/api/rides/${daRide.ride_id}/messages`, { method: "POST", body: JSON.stringify({ sender_id: pilotRider.id, sender_role: "rider", message: "v23 chat test" }), session: "pilotRider" });
  check("v2.3 chat post on active ride", !!chat23a.message_id, `id=${chat23a.message_id}`);
  const chat23driver = await call(`/api/rides/${daRide.ride_id}/messages?after=0&limit=50`, { session: "pilotDriver" });
  check("chat GET returns unread_count=1 for the driver", chat23driver.unread_count === 1 && chat23driver.messages.some((m) => m.message === "v23 chat test"), JSON.stringify(chat23driver));
  const chat23driver2 = await call(`/api/rides/${daRide.ride_id}/messages`, { session: "pilotDriver" });
  check("second chat fetch marks read (unread_count=0)", chat23driver2.unread_count === 0, `got ${chat23driver2.unread_count}`);
  const chat23after = await call(`/api/rides/${daRide.ride_id}/messages?after=${chat23a.message_id}`, { session: "pilotDriver" });
  check("chat ?after filters to newer messages only", chat23after.messages.length === 0, `got ${chat23after.messages.length}`);
  await expectFail("chat message over 500 chars -> 400", () => call(`/api/rides/${daRide.ride_id}/messages`, { method: "POST", body: JSON.stringify({ sender_id: pilotRider.id, sender_role: "rider", message: "x".repeat(501) }), session: "pilotRider" }), 400);

  // ---- Live location + navigation E2E (v2.3, simulated GPS) ----
  // Independent haversine (same formula as the server) to verify the
  // server's numbers instead of trusting them.
  function haversineKmTest(a, b) {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const la1 = (a.lat * Math.PI) / 180;
    const la2 = (b.lat * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // Navigation data the rider client needs (public/rider.js showTrip):
  // ride pickup/destination names resolvable via /api/places, driver_location
  // with lat/lng/updated_at, and status accepted/ongoing.
  const places23 = await call("/api/places");
  const destCity = places23.places.find((p) => p.name === "Chunian City");
  check("places API returns destination coordinates for navigation", !!destCity && destCity.lat === 30.9667 && destCity.lng === 74.0333, JSON.stringify(destCity));
  const navRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, pickup: "Current location", destination: "Chunian City", vehicle: "bike", distance_km: 3, proposed_fare: 50, pickup_lat: 30.98, pickup_lng: 74.05 }), session: "pilotRider" });
  check("navigation ride booked with GPS pickup", !!navRide.ride_id, `ride #${navRide.ride_id}`);
  const navDetail = await call(`/api/rides/${navRide.ride_id}`, { session: "pilotRider" });
  check("navigation data present: GPS pickup + destination coords + status requested", navDetail.ride.pickup_lat === 30.98 && navDetail.ride.pickup_lng === 74.05 && navDetail.ride.status === "requested" && destCity.lat === 30.9667 && destCity.lng === 74.0333, JSON.stringify({ pickup: [navDetail.ride.pickup_lat, navDetail.ride.pickup_lng], dest: [destCity.lat, destCity.lng] }));
  // Counter-offer carries the same 4-minute expiry as seeded offers, and
  // the rider gets an offer_received notification for it.
  const navCounter = await call(`/api/rides/${navRide.ride_id}/counter`, { method: "POST", body: JSON.stringify({ driver_id: pilotDriver.id, fare: 55 }), session: "pilotDriver" });
  check("counter-offer created on navigation ride", !!navCounter.offer_id, `offer #${navCounter.offer_id}`);
  const navDetail2 = await call(`/api/rides/${navRide.ride_id}`, { session: "pilotDriver" });
  const navCounterOffer = navDetail2.offers.find((o) => o.id === navCounter.offer_id);
  check("counter-offer carries expires_at = created_at + 240000", !!navCounterOffer && navCounterOffer.expires_at === navCounterOffer.created_at + 240000, JSON.stringify(navCounterOffer));
  const prNotifsNav = await call("/api/notifications", { session: "pilotRider" });
  check("rider gets offer_received for the counter-offer", prNotifsNav.notifications.some((n) => n.type === "offer_received" && n.ride_id === navRide.ride_id && n.params.fare === 55));
  // Driver moves: far (Pattoki) -> near (Chunian). Distance must track the
  // move and match an independent haversine computation.
  await call(`/api/drivers/${pilotDriver.id}/location`, { method: "POST", body: JSON.stringify({ lat: 31.0247, lng: 73.8528 }), session: "pilotDriver" });
  const reqsFar = await call(`/api/drivers/${pilotDriver.id}/requests`, { session: "pilotDriver" });
  const farRide = reqsFar.requests.find((r) => r.id === navRide.ride_id);
  const expectedFar = haversineKmTest({ lat: 31.0247, lng: 73.8528 }, { lat: 30.98, lng: 74.05 });
  check("driver far from GPS pickup: distance matches independent haversine", !!farRide && Math.abs(farRide.pickup_distance_km - Math.round(expectedFar * 100) / 100) < 0.01 && farRide.pickup_distance_km > 10, JSON.stringify({ got: farRide && farRide.pickup_distance_km, expected: Math.round(expectedFar * 100) / 100 }));
  check("far driver ETA follows 25 km/h formula", !!farRide && farRide.pickup_eta_min === Math.max(1, Math.round((farRide.pickup_distance_km / 25) * 60)), `eta=${farRide && farRide.pickup_eta_min}`);
  await call(`/api/drivers/${pilotDriver.id}/location`, { method: "POST", body: JSON.stringify({ lat: 30.97, lng: 74.03 }), session: "pilotDriver" });
  const reqsNear = await call(`/api/drivers/${pilotDriver.id}/requests`, { session: "pilotDriver" });
  const nearRide = reqsNear.requests.find((r) => r.id === navRide.ride_id);
  const expectedNear = haversineKmTest({ lat: 30.97, lng: 74.03 }, { lat: 30.98, lng: 74.05 });
  check("driver moves closer: distance DROPS and matches haversine", !!nearRide && !!farRide && nearRide.pickup_distance_km < farRide.pickup_distance_km && Math.abs(nearRide.pickup_distance_km - Math.round(expectedNear * 100) / 100) < 0.01, JSON.stringify({ far: farRide.pickup_distance_km, near: nearRide.pickup_distance_km, expectedNear: Math.round(expectedNear * 100) / 100 }));
  await call(`/api/rides/${navRide.ride_id}/cancel`, { method: "POST", body: "{}", session: "pilotRider" });

  // Accept race: rider-accept and driver-accept fired at the same time on
  // the same ride — exactly one must win, the other must fail 400.
  const raceRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, pickup: "Chunian City", destination: "Chunian City", vehicle: "bike", distance_km: 3, proposed_fare: 50 }), session: "pilotRider" });
  const raceDetail = await call(`/api/rides/${raceRide.ride_id}`, { session: "pilotRider" });
  const raceDriverOffer = raceDetail.offers.find((o) => o.driver_id === pilotDriver.id && o.status === "pending");
  const raceOtherOffer = raceDetail.offers.find((o) => o.driver_id !== pilotDriver.id && o.status === "pending");
  check("race ride has two pending offers (one per driver)", !!raceDriverOffer && !!raceOtherOffer, JSON.stringify(raceDetail.offers.map((o) => o.driver_id)));
  const [raceA, raceB] = await Promise.all([
    callRaw(`/api/rides/${raceRide.ride_id}/offers/${raceOtherOffer.id}/accept`, { method: "POST", body: "{}", session: "pilotRider" }),
    callRaw(`/api/rides/${raceRide.ride_id}/offers/${raceDriverOffer.id}/accept-driver`, { method: "POST", body: "{}", session: "pilotDriver" }),
  ]);
  const raceStatuses = [raceA.status, raceB.status].sort();
  check("accept race: exactly one accept wins (200), the other fails (400)", raceStatuses[0] === 200 && raceStatuses[1] === 400, `statuses=${raceA.status},${raceB.status}`);
  const raceDetail2 = await call(`/api/rides/${raceRide.ride_id}`, { session: "pilotRider" });
  check("accept race: ride accepted exactly once, one offer accepted", raceDetail2.ride.status === "accepted" && raceDetail2.offers.filter((o) => o.status === "accepted").length === 1 && raceDetail2.offers.filter((o) => o.status === "declined").length === 1, JSON.stringify({ status: raceDetail2.ride.status, offers: raceDetail2.offers.map((o) => o.status) }));
  await call(`/api/rides/${raceRide.ride_id}/cancel`, { method: "POST", body: "{}", session: "pilotRider" });

  // Live driver_location on the accepted ride (daRide), then the full
  // status chain accepted -> ongoing -> completed with fresh fixes.
  // rider.js treats a fix as fresh iff updated_at is <180s old.
  await call(`/api/drivers/${pilotDriver.id}/location`, { method: "POST", body: JSON.stringify({ lat: 30.975, lng: 74.04 }), session: "pilotDriver" });
  const detFresh = await call(`/api/rides/${daRide.ride_id}`, { session: "pilotRider" });
  check("rider sees fresh driver_location on accepted ride", detFresh.driver_location && detFresh.driver_location.lat === 30.975 && detFresh.driver_location.lng === 74.04 && detFresh.ride.status === "accepted" && detFresh.ride.driver_id === pilotDriver.id, JSON.stringify(detFresh.driver_location));
  check("driver_location updated_at is fresh (<180s old, rider.js rule)", detFresh.driver_location && detFresh.driver_location.updated_at != null && Date.now() - detFresh.driver_location.updated_at < 180000, `age=${detFresh.driver_location ? Date.now() - detFresh.driver_location.updated_at : "n/a"}ms`);
  await call(`/api/rides/${daRide.ride_id}/start`, { method: "POST", body: "{}", session: "pilotDriver" });
  await call(`/api/drivers/${pilotDriver.id}/location`, { method: "POST", body: JSON.stringify({ lat: 30.98, lng: 74.05 }), session: "pilotDriver" });
  const detOngoing = await call(`/api/rides/${daRide.ride_id}`, { session: "pilotRider" });
  check("ride transitions accepted -> ongoing", detOngoing.ride.status === "ongoing", `status=${detOngoing.ride.status}`);
  check("driver_location tracks the move during ongoing ride (fresh)", detOngoing.driver_location && detOngoing.driver_location.lat === 30.98 && detOngoing.driver_location.lng === 74.05 && Date.now() - detOngoing.driver_location.updated_at < 180000, JSON.stringify(detOngoing.driver_location));
  const daDone = await call(`/api/rides/${daRide.ride_id}/complete`, { method: "POST", body: JSON.stringify({ cash_received: true }), session: "pilotDriver" });
  check("driver-accepted ride completes: fare 50, take 26, kept 24, wallet 448", daDone.platform_take === 26 && daDone.driver_kept === 24 && daDone.driver_wallet_balance === 448, JSON.stringify(daDone));
  const detDone = await call(`/api/rides/${daRide.ride_id}`, { session: "pilotRider" });
  check("ride transitions ongoing -> completed", detDone.ride.status === "completed", `status=${detDone.ride.status}`);

  // Stale-location case: a driver who never posted GPS has updated_at null,
  // so rider.js must treat the fix as NOT fresh (driver_loc_missing).
  const adminRides23 = await call("/api/admin/rides", { session: "admin" });
  const seededAhmed = adminRides23.rides.find((r) => r.driver_name === "Ahmed Raza" && r.status === "completed");
  check("seeded Ahmed Raza completed ride exists for the stale test", !!seededAhmed, `ride #${seededAhmed && seededAhmed.id}`);
  if (seededAhmed) {
    const staleDet = await call(`/api/rides/${seededAhmed.id}`, { session: "admin" });
    check("driver who never posted GPS: driver_location.updated_at is null (stale)", staleDet.driver_location && staleDet.driver_location.updated_at == null, JSON.stringify(staleDet.driver_location));
  }

  // Admin chat is read-only: can read, cannot post.
  const chatAdmin = await call(`/api/rides/${daRide.ride_id}/messages`, { session: "admin" });
  check("admin can read ride chat (read-only)", chatAdmin.messages.length >= 1 && chatAdmin.unread_count === 0, `messages=${chatAdmin.messages.length}`);
  await expectFail("admin cannot post to ride chat -> 403", () => call(`/api/rides/${daRide.ride_id}/messages`, { method: "POST", body: JSON.stringify({ sender_id: 1, sender_role: "rider", message: "admin hi" }), session: "admin" }), 403);

  // ---- Web push end-to-end (local fake push service, HTTPS) ----
  // A tiny local HTTPS server plays the push service: it records the
  // payload and answers 410 Gone, which must delete the subscription.
  // HTTPS is required because web-push always sends over TLS (an http://
  // endpoint fails with an SSL error before any byte is sent). The server
  // trusts the self-signed test cert via NODE_TLS_REJECT_UNAUTHORIZED=0
  // (see env above); the cert is test-only, 127.0.0.1 only.
  {
    const pushHits = [];
    const pushServer = https.createServer(
      { key: fs.readFileSync(path.join(root, "scripts", "push-test-key.pem")), cert: fs.readFileSync(path.join(root, "scripts", "push-test-cert.pem")) },
      (req, res) => {
        // Web Push payloads are ENCRYPTED (RFC 8291 aes128gcm): the service
        // only ever sees ciphertext + headers, never the plaintext JSON.
        // With aes128gcm the salt/key travel IN the body (16B salt + 4B
        // record size + 1B key length + 65B sender key + ciphertext) and
        // there are no Encryption/Crypto-Key headers (those belong to the
        // older aesgcm encoding). Record the shape, not the plaintext.
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => { const buf = Buffer.concat(chunks); pushHits.push({ url: req.url, headers: req.headers, bodyLen: buf.length, bodyB64: buf.toString("base64") }); res.writeHead(410); res.end(); });
      }
    );
    await new Promise((resolve) => pushServer.listen(3459, "127.0.0.1", resolve));
    try {
      const localSub = await call("/api/push/subscribe", { method: "POST", body: JSON.stringify({ endpoint: "https://127.0.0.1:3459/push/v23", keys: { p256dh: testP256dh, auth: testAuth } }), session: "pilotRider" });
      check("push subscribe accepts https://127.0.0.1 (local test endpoint)", localSub.ok === true, JSON.stringify(localSub));
      // Trigger a real notification for the rider: a counter-offer on a
      // fresh ride notifies the rider (offer_received) -> notify() fires
      // a web push to the local fake service.
      const pushRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, pickup: "Chunian City", destination: "Chunian City", vehicle: "bike", distance_km: 3, proposed_fare: 50 }), session: "pilotRider" });
      await call(`/api/rides/${pushRide.ride_id}/counter`, { method: "POST", body: JSON.stringify({ driver_id: pilotDriver.id, fare: 55 }), session: "pilotDriver" });
      await sleep(2500);
      check("fake push service received the notification push", pushHits.length >= 1, `hits=${pushHits.length}`);
      const hit0 = pushHits[0] || {};
      const hitHeaders = hit0.headers || {};
      // RFC 8291 aes128gcm body layout: [0..15] salt, [16..19] record size,
      // [20] sender-key length (65), [21..85] sender key, [86..] ciphertext.
      const hitBuf = hit0.bodyB64 ? Buffer.from(hit0.bodyB64, "base64") : null;
      check("push request is a real encrypted Web Push message (aes128gcm + RFC 8291 body layout)", !!hitBuf && hitBuf.length > 86 && String(hitHeaders["content-encoding"] || "") === "aes128gcm" && hitBuf[20] === 65, JSON.stringify({ encoding: hitHeaders["content-encoding"], bodyLen: hitBuf && hitBuf.length, keyLenByte: hitBuf && hitBuf[20] }));
      await call(`/api/rides/${pushRide.ride_id}/cancel`, { method: "POST", body: "{}", session: "pilotRider" });
      const unsubLocal = await call("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: "https://127.0.0.1:3459/push/v23" }), session: "pilotRider" });
      check("410 from the push service deleted the subscription (unsubscribe removes 0)", unsubLocal.ok === true && unsubLocal.removed === 0, JSON.stringify(unsubLocal));
    } finally {
      await new Promise((resolve) => pushServer.close(resolve));
    }
  }

  // ---- Web push (VAPID) ----
  const pubKey = await call("/api/push/public-key", { session: "pilotRider" });
  check("push public key returned (VAPID, base64url, 87 chars)", typeof pubKey.public_key === "string" && pubKey.public_key.length === 87, `len=${pubKey.public_key && pubKey.public_key.length}`);
  await expectFail("push subscribe without endpoint -> 400", () => call("/api/push/subscribe", { method: "POST", body: JSON.stringify({ keys: { p256dh: "x", auth: "y" } }), session: "pilotRider" }), 400);
  await expectFail("push subscribe with garbage keys -> 400", () => call("/api/push/subscribe", { method: "POST", body: JSON.stringify({ endpoint: "https://example.com/push/bad", keys: { p256dh: "not-a-key", auth: "short" } }), session: "pilotRider" }), 400);
  const sub = await call("/api/push/subscribe", { method: "POST", body: JSON.stringify({ endpoint: "https://example.com/push/smoke-v23", keys: { p256dh: testP256dh, auth: testAuth } }), session: "pilotRider" });
  check("push subscribe upserts", sub.ok === true && sub.subscribed === true, JSON.stringify(sub));
  const subAgain = await call("/api/push/subscribe", { method: "POST", body: JSON.stringify({ endpoint: "https://example.com/push/smoke-v23", keys: { p256dh: testP256dh, auth: testAuth } }), session: "pilotRider" });
  check("push re-subscribe same endpoint is idempotent", subAgain.ok === true, JSON.stringify(subAgain));
  const unsub = await call("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: "https://example.com/push/smoke-v23" }), session: "pilotRider" });
  check("push unsubscribe removes the subscription", unsub.ok === true && unsub.removed === 1, JSON.stringify(unsub));
  await expectFail("unauthenticated push public-key -> 401", () => call("/api/push/public-key"), 401);
  await expectFail("admin session cannot subscribe for push -> 403", () => call("/api/push/subscribe", { method: "POST", body: JSON.stringify({ endpoint: "https://example.com/push/x", keys: { p256dh: "x", auth: "y" } }), session: "admin" }), 403);

  // ---- Scheduled-ride reminder (ride due in 20 min, lazy sweep on read) ----
  const remRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: pilotRider.id, pickup: "Chunian City", destination: "Chunian City", vehicle: "bike", distance_km: 3, proposed_fare: 50, scheduled_for: Date.now() + 20 * 60000 }), session: "pilotRider" });
  check("scheduled ride within 30 min booked", !!remRide.ride_id, `ride #${remRide.ride_id}`);
  await call(`/api/rides/${remRide.ride_id}`, { session: "pilotRider" });
  const remNotifs = await call("/api/notifications", { session: "pilotRider" });
  check("scheduled_ride_reminder sent once for ride due in 20 min", remNotifs.notifications.filter((n) => n.type === "scheduled_ride_reminder" && n.ride_id === remRide.ride_id).length === 1, remNotifs.notifications.map((n) => n.type).join(","));
  await call(`/api/rides/${remRide.ride_id}`, { session: "pilotRider" });
  const remNotifs2 = await call("/api/notifications", { session: "pilotRider" });
  check("reminder not duplicated on re-read", remNotifs2.notifications.filter((n) => n.type === "scheduled_ride_reminder" && n.ride_id === remRide.ride_id).length === 1);
  await call(`/api/rides/${remRide.ride_id}/cancel`, { method: "POST", body: "{}", session: "pilotRider" });

  // ---- Document expiry ----
  const expUp = await call("/api/drivers/me/documents", { method: "POST", body: JSON.stringify({ doc_type: "licence", mime: "image/jpeg", data_url: tinyJpeg, expires_at: Date.now() + 60000 }), session: "pilotDriver" });
  check("document upload accepts a future expires_at", expUp.status === "pending" && !!expUp.document_id, JSON.stringify(expUp));
  await expectFail("document upload with a past expires_at -> 400", () => call("/api/drivers/me/documents", { method: "POST", body: JSON.stringify({ doc_type: "licence", mime: "image/jpeg", data_url: tinyJpeg, expires_at: Date.now() - 1000 }), session: "pilotDriver" }), 400);
  const expAdminDocs = await call(`/api/admin/drivers/${pilotDriver.id}/documents`, { session: "admin" });
  const expDoc = expAdminDocs.documents.find((d) => d.id === expUp.document_id);
  check("admin document list shows expires_at + expires_soon=true + expired=false", !!expDoc && expDoc.expires_at != null && expDoc.expires_soon === true && expDoc.expired === false, JSON.stringify(expDoc));
  await call(`/api/admin/documents/${expUp.document_id}/approve`, { method: "POST", body: "{}", session: "admin" });
  const expUp2 = await call("/api/drivers/me/documents", { method: "POST", body: JSON.stringify({ doc_type: "licence", mime: "image/jpeg", data_url: tinyJpeg, expires_at: Date.now() + 2000 }), session: "pilotDriver" });
  await call(`/api/admin/documents/${expUp2.document_id}/approve`, { method: "POST", body: "{}", session: "admin" });
  await sleep(3000);
  const expDocs2 = await call("/api/drivers/me/documents", { session: "pilotDriver" });
  check("expired document blocks the checklist (licence no longer counts)", expDocs2.doc_checklist.all === false && expDocs2.doc_checklist.missing.includes("licence"), JSON.stringify(expDocs2.doc_checklist));
  const expOnline = await callRaw(`/api/drivers/${pilotDriver.id}/online`, { method: "POST", body: JSON.stringify({ online: true }), session: "pilotDriver" });
  check("driver with an expired document cannot go online -> 403", expOnline.status === 403, `got ${expOnline.status}`);
  const expAdminDocs2 = await call(`/api/admin/drivers/${pilotDriver.id}/documents`, { session: "admin" });
  const expDoc2 = expAdminDocs2.documents.find((d) => d.id === expUp2.document_id);
  check("admin document list flags the expired document", !!expDoc2 && expDoc2.expired === true, JSON.stringify(expDoc2));
  // Approving a document that expired while pending must fail.
  const expUp3 = await call("/api/drivers/me/documents", { method: "POST", body: JSON.stringify({ doc_type: "licence", mime: "image/jpeg", data_url: tinyJpeg, expires_at: Date.now() + 2000 }), session: "pilotDriver" });
  await sleep(3000);
  await expectFail("approving an already-expired document -> 400", () => call(`/api/admin/documents/${expUp3.document_id}/approve`, { method: "POST", body: "{}", session: "admin" }), 400);

  // ---- Client error logging ----
  const ce = await callRaw("/api/client-error", { method: "POST", body: JSON.stringify({ message: "smoke client error", stack: "Error: smoke\n at test", url: "/rider", user_agent: "smoke-agent" }), session: "pilotRider" });
  check("client error posted -> 201", ce.status === 201 && ce.data.ok === true, `got ${ce.status}`);
  const ceList = await call("/api/admin/client-errors", { session: "admin" });
  check("admin lists client errors (latest first)", ceList.client_errors.some((e) => e.message === "smoke client error" && e.url === "/rider"), `total=${ceList.client_errors.length}`);
  const ceLong = await callRaw("/api/client-error", { method: "POST", body: JSON.stringify({ message: "y".repeat(2500), stack: "z".repeat(5000) }), session: "pilotRider" });
  check("over-long client error is truncated, not rejected -> 201", ceLong.status === 201, `got ${ceLong.status}`);
  const ceList2 = await call("/api/admin/client-errors", { session: "admin" });
  const ceLongRow = ceList2.client_errors.find((e) => e.message === "y".repeat(2000));
  check("stored client error message truncated to 2000 chars, stack to 4000", !!ceLongRow && ceLongRow.stack.length === 4000, `stack len=${ceLongRow && ceLongRow.stack.length}`);
  await expectFail("rider cannot list client errors -> 403", () => call("/api/admin/client-errors", { session: "pilotRider" }), 403);
  await expectFail("client error without message -> 400", () => call("/api/client-error", { method: "POST", body: JSON.stringify({ message: "" }), session: "pilotRider" }), 400);
  await expectFail("unauthenticated client error -> 401", () => call("/api/client-error", { method: "POST", body: JSON.stringify({ message: "x" }) }), 401);

  // ---- Google sign-in (v2.5, free OAuth 2.0) ----
  // Own fresh-DB server (port 3457) + a local fake Google (port 3459) so
  // the full authorization-code flow runs without real Google credentials.
  // The stub answers by code: "rider-code" -> Google Rider,
  // "driver-code" -> Google Driver, "driver-code-2" -> Google Driver 2.
  {
    const gDb = path.join(dataDir, "smoke-google.db");
    if (fs.existsSync(gDb)) fs.unlinkSync(gDb);
    if (fs.existsSync(gDb + "-journal")) fs.unlinkSync(gDb + "-journal");
    const fakeGoogle = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/token" && req.method === "POST") {
          const params = new URLSearchParams(body);
          fakeGoogle.lastToken = { code: params.get("code"), redirect_uri: params.get("redirect_uri") };
          const code = params.get("code") || "";
          const access = code === "driver-code" ? "tok-driver-code" : code === "driver-code-2" ? "tok-driver-code-2" : "tok-rider-code";
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ access_token: access, token_type: "Bearer", expires_in: 3600 }));
        }
        if (req.url === "/userinfo") {
          const tok = (req.headers.authorization || "").replace("Bearer ", "");
          const who = tok === "tok-driver-code"
            ? { sub: "google-sub-driver", email: "googledriver@example.com", name: "Google Driver" }
            : tok === "tok-driver-code-2"
              ? { sub: "google-sub-driver2", email: "googledriver2@example.com", name: "Google Driver 2" }
              : { sub: "google-sub-rider", email: "googlerider@example.com", name: "Google Rider" };
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(who));
        }
        res.writeHead(404); res.end();
      });
    });
    await new Promise((r) => fakeGoogle.listen(3459, "127.0.0.1", r));
    const gBase = "http://127.0.0.1:3457";
    const waitHealthy = async (base) => {
      for (let i = 0; i < 120; i++) {
        try { const r = await fetch(base + "/api/health"); if (r.ok) return true; } catch {}
        await sleep(500);
      }
      return false;
    };
    const gCall = async (p, opts = {}) => {
      const headers = { "Content-Type": "application/json" };
      if (opts.cookie) headers.Cookie = opts.cookie;
      const res = await fetch(gBase + p, { headers, method: opts.method || "GET", body: opts.body, redirect: "manual" });
      const text = await res.text();
      let data = {};
      try { data = JSON.parse(text); } catch {}
      return { status: res.status, data, text, location: res.headers.get("location"), setCookie: res.headers.getSetCookie() };
    };
    const gCookie = (r) => (r.setCookie && r.setCookie[0] ? r.setCookie[0].split(";")[0] : "");
    const startGoogle = async (role, source, code) => {
      const s = await gCall(`/api/auth/google?role=${role}&source=${source}`);
      check(`google start (${role}/${source}) -> 302 to accounts.google.com`, s.status === 302 && (s.location || "").startsWith("https://accounts.google.com/o/oauth2/v2/auth"), `got ${s.status} ${s.location}`);
      const loc = new URL(s.location);
      check("google start carries client_id + local redirect_uri", loc.searchParams.get("client_id") === "test-client-id.apps.googleusercontent.com" && loc.searchParams.get("redirect_uri") === `${gBase}/api/auth/google/callback`, loc.searchParams.get("redirect_uri"));
      const state = loc.searchParams.get("state");
      check("google start carries a 64-hex state", /^[0-9a-f]{64}$/.test(state || ""));
      return gCall(`/api/auth/google/callback?code=${code}&state=${state}`);
    };
    let gChild = null;
    try {
      // Phase 1: Google NOT configured — button hidden, start rejected.
      // Admin is set up here (fresh DB prints the one-time token once);
      // the session survives the phase-2 restart (same DB file).
      const gEnvOff = { ...process.env, PORT: "3457", TURSO_DATABASE_URL: "file:./data/smoke-google.db" };
      delete gEnvOff.GOOGLE_CLIENT_ID; delete gEnvOff.GOOGLE_CLIENT_SECRET;
      gChild = spawn("node", ["server/index.mjs"], { cwd: root, env: gEnvOff, stdio: ["ignore", "pipe", "pipe"] });
      let gOut = "";
      gChild.stdout.on("data", (d) => (gOut += d));
      gChild.stderr.on("data", (d) => (gOut += d));
      check("google server (unconfigured) boots", await waitHealthy(gBase));
      const off = await gCall("/api/auth/google?role=rider");
      check("google start without credentials -> 503", off.status === 503, `got ${off.status}`);
      const offSettings = await gCall("/api/settings");
      check("google_login_enabled is false when unconfigured", offSettings.data.google_login_enabled === false);
      const riderHtml = await gCall("/rider");
      check("rider page carries the Google button markup", riderHtml.status === 200 && riderHtml.text.includes('id="btn-google"') && riderHtml.text.includes("google_continue"));
      const driverHtml = await gCall("/driver");
      check("driver page carries the Google button markup", driverHtml.status === 200 && driverHtml.text.includes('id="btn-google"'));
      const adminHtml = await gCall("/admin");
      check("admin page has NO Google button (phone+password only)", adminHtml.status === 200 && !adminHtml.text.includes('id="btn-google"'));
      const assetlinks = await gCall("/.well-known/assetlinks.json");
      check("assetlinks.json served with package + cert fingerprint", assetlinks.status === 200 && assetlinks.text.includes("com.chunianride.app") && assetlinks.text.includes("19a11c27e7cc613271faec139ba9290140e576c5f95b50f24d3996eb9aab3e6a"), `got ${assetlinks.status}`);
      const gToken = extractSetupToken(gOut);
      check("google server generated its own setup token", typeof gToken === "string" && /^[0-9a-f]{64}$/.test(gToken || ""));
      const gSetup = await gCall("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin: gToken, name: "Owner", phone: "03266040350", password: "ownerpass" }) });
      check("google server admin setup works", gSetup.status === 200, `got ${gSetup.status}`);
      const gAdminCookie = gCookie(gSetup);
      gChild.kill(); gChild = null; await sleep(300);

      // Phase 2: Google configured (dummy client id/secret — NOT real
      // credentials) against the fake Google stub. Pilot is ON by default.
      const gEnv = {
        ...process.env, PORT: "3457", TURSO_DATABASE_URL: "file:./data/smoke-google.db",
        GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "test-secret-not-real",
        GOOGLE_TOKEN_URL: "http://127.0.0.1:3459/token",
        GOOGLE_USERINFO_URL: "http://127.0.0.1:3459/userinfo",
      };
      gChild = spawn("node", ["server/index.mjs"], { cwd: root, env: gEnv, stdio: ["ignore", "pipe", "pipe"] });
      gOut = "";
      gChild.stdout.on("data", (d) => (gOut += d));
      gChild.stderr.on("data", (d) => (gOut += d));
      check("google server (configured) boots", await waitHealthy(gBase));
      const onSettings = await gCall("/api/settings");
      check("google_login_enabled is true when configured", onSettings.data.google_login_enabled === true);
      await gCall("/api/admin/pilot-whitelist", { method: "POST", body: JSON.stringify({ phone: "0309-7777777", role: "rider" }), cookie: gAdminCookie });

      // Forged callback (bad state) fails before any Google call.
      const badCb = await gCall("/api/auth/google/callback?code=rider-code&state=" + "0".repeat(64));
      check("callback with unknown state -> 302 to rider with google_error", badCb.status === 302 && (badCb.location || "").includes("/rider?google_error="), `got ${badCb.status} ${badCb.location}`);

      // New rider: callback -> phone step -> pilot 403 -> whitelist -> create.
      const cb1 = await startGoogle("rider", "web", "rider-code");
      check("token exchange sent the right code + redirect_uri to Google", fakeGoogle.lastToken && fakeGoogle.lastToken.code === "rider-code" && fakeGoogle.lastToken.redirect_uri === `${gBase}/api/auth/google/callback`, JSON.stringify(fakeGoogle.lastToken));
      check("new rider callback -> 302 to /google-phone with token", cb1.status === 302 && (cb1.location || "").startsWith("/google-phone?token="), `got ${cb1.status} ${cb1.location}`);
      const pendToken = new URL(cb1.location, gBase).searchParams.get("token");
      const pendBad = await gCall("/api/auth/google/pending?token=badtoken");
      check("pending lookup with bad token -> 404", pendBad.status === 404, `got ${pendBad.status}`);
      const pend = await gCall(`/api/auth/google/pending?token=${pendToken}`);
      check("pending lookup returns Google name/email/role", pend.status === 200 && pend.data.name === "Google Rider" && pend.data.email === "googlerider@example.com" && pend.data.role === "rider", JSON.stringify(pend.data));
      const phoneNoWl = await gCall("/api/auth/google/phone", { method: "POST", body: JSON.stringify({ token: pendToken, phone: "0309-7777778" }) });
      check("google phone step with non-whitelisted phone -> 403 pilot message", phoneNoWl.status === 403 && (phoneNoWl.data.error || "").includes("whitelist"), `got ${phoneNoWl.status} ${JSON.stringify(phoneNoWl.data)}`);
      const phoneOk = await gCall("/api/auth/google/phone", { method: "POST", body: JSON.stringify({ token: pendToken, phone: "0309-7777777" }) });
      check("google phone step with whitelisted phone -> 200 + redirect /rider + session", phoneOk.status === 200 && phoneOk.data.redirect === "/rider" && !!gCookie(phoneOk), JSON.stringify(phoneOk.data));
      const gRiderCookie = gCookie(phoneOk);
      const meG = await gCall("/api/auth/me", { cookie: gRiderCookie });
      check("google-created rider session restores (phone + name from Google)", meG.status === 200 && meG.data.user && meG.data.user.phone === "03097777777" && meG.data.user.name === "Google Rider" && meG.data.user.role === "rider", JSON.stringify(meG.data.user));
      const pendGone = await gCall(`/api/auth/google/pending?token=${pendToken}`);
      check("pending token is single-use (gone after phone step)", pendGone.status === 404, `got ${pendGone.status}`);

      // Returning Google rider: straight to /rider, no phone step.
      const cb2 = await startGoogle("rider", "web", "rider-code");
      check("returning google rider callback -> 302 straight to /rider", cb2.status === 302 && cb2.location === "/rider" && !!gCookie(cb2), `got ${cb2.status} ${cb2.location}`);

      // Google-only account can add a phone password, then log in with it.
      const pwSet = await gCall("/api/auth/change-password", { method: "POST", body: JSON.stringify({ current: "", next: "googlepass123" }), cookie: gRiderCookie });
      check("google rider sets a password via change-password", pwSet.status === 200, `got ${pwSet.status} ${JSON.stringify(pwSet.data)}`);
      const pwLogin = await gCall("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0309-7777777", password: "googlepass123" }) });
      check("phone+password login still works for the google-created rider", pwLogin.status === 200 && !!gCookie(pwLogin), `got ${pwLogin.status}`);

      // Driver: link an existing driver account with its phone password.
      const claim = await gCall("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0301-0000001", password: "driverpass1" }) });
      check("demo driver 0301-0000001 claims account with a password", claim.status === 200 && claim.data.claimed === true, `got ${claim.status}`);
      const cbD = await startGoogle("driver", "web", "driver-code");
      check("driver callback -> 302 to /google-phone", cbD.status === 302 && (cbD.location || "").startsWith("/google-phone?token="), `got ${cbD.status} ${cbD.location}`);
      const dToken = new URL(cbD.location, gBase).searchParams.get("token");
      const linkBadPw = await gCall("/api/auth/google/phone", { method: "POST", body: JSON.stringify({ token: dToken, phone: "0301-0000001", password: "wrongpass" }) });
      check("driver link with wrong phone password -> 401", linkBadPw.status === 401, `got ${linkBadPw.status}`);
      const linkOk = await gCall("/api/auth/google/phone", { method: "POST", body: JSON.stringify({ token: dToken, phone: "0301-0000001", password: "driverpass1" }) });
      check("driver link with right password -> 200 + redirect /driver + session", linkOk.status === 200 && linkOk.data.redirect === "/driver" && !!gCookie(linkOk), JSON.stringify(linkOk.data));
      const meD = await gCall("/api/auth/me", { cookie: gCookie(linkOk) });
      check("linked driver session restores as driver", meD.status === 200 && meD.data.user && meD.data.user.role === "driver", JSON.stringify(meD.data.user));

      // Driver: a NEW driver account via Google is refused (owner-created only).
      const cbD2 = await startGoogle("driver", "web", "driver-code-2");
      const dToken2 = new URL(cbD2.location, gBase).searchParams.get("token");
      const dNew = await gCall("/api/auth/google/phone", { method: "POST", body: JSON.stringify({ token: dToken2, phone: "0309-7777779" }) });
      check("new driver via google -> 403 owner-created only", dNew.status === 403 && (dNew.data.error || "").includes("owner"), `got ${dNew.status} ${JSON.stringify(dNew.data)}`);

      // APK return trip: callback -> done page -> return exchanges the token.
      const cbApk = await startGoogle("rider", "apk", "rider-code");
      check("apk-source callback -> 302 to /auth/google/done with token", cbApk.status === 302 && (cbApk.location || "").startsWith("/auth/google/done?token="), `got ${cbApk.status} ${cbApk.location}`);
      const doneToken = new URL(cbApk.location, gBase).searchParams.get("token");
      const done = await gCall(`/auth/google/done?token=${doneToken}`);
      check("done page renders with a return link", done.status === 200 && done.text.includes("/auth/google/return?token=") && done.text.includes("Google login ho gaya"), `got ${done.status}`);
      const ret = await gCall(`/auth/google/return?token=${doneToken}`);
      check("return exchanges the token for a session + redirects /rider", ret.status === 302 && ret.location === "/rider" && !!gCookie(ret), `got ${ret.status} ${ret.location} cookie=${!!gCookie(ret)}`);
      const ret2 = await gCall(`/auth/google/return?token=${doneToken}`);
      check("login token is single-use (second return -> google_error)", ret2.status === 302 && (ret2.location || "").includes("google_error"), `got ${ret2.status} ${ret2.location}`);

      // No secrets in the repo: the client secret appears only as an env
      // reference, and no Google-issued secret formats are present.
      const secretFiles = ["server/index.mjs", "server/db.mjs", "server/auth.mjs", "public/shared.js", "public/rider.js", "public/driver.js", "public/rider.html", "public/driver.html", "public/google-phone.html"];
      let secretLeak = "";
      for (const f of secretFiles) {
        const src = fs.readFileSync(path.join(root, f), "utf8");
        if (/GOCSPX-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{10,}/.test(src)) secretLeak = f;
      }
      check("no Google-issued secret strings in the repo", secretLeak === "", `leak in ${secretLeak}`);
      const idxSrc = fs.readFileSync(path.join(root, "server/index.mjs"), "utf8");
      const secretRefs = idxSrc.split("\n").filter((l) => l.includes("GOOGLE_CLIENT_SECRET") && !l.trim().startsWith("//"));
      check("GOOGLE_CLIENT_SECRET appears only as process.env reference", secretRefs.length > 0 && secretRefs.every((l) => l.includes("process.env.GOOGLE_CLIENT_SECRET")), JSON.stringify(secretRefs));
    } finally {
      if (gChild) { gChild.kill(); await sleep(300); }
      try { fakeGoogle.close(); } catch {}
      if (fs.existsSync(gDb)) fs.unlinkSync(gDb);
      if (fs.existsSync(gDb + "-journal")) fs.unlinkSync(gDb + "-journal");
    }
  }

  // ---- Offer expiry (separate fresh-DB server, port 3458, TTL 3s) ----
  {
    const expDb = path.join(dataDir, "smoke-v23.db");
    if (fs.existsSync(expDb)) fs.unlinkSync(expDb);
    const expEnv = { ...process.env, PORT: "3458", TURSO_DATABASE_URL: "file:./data/smoke-v23.db", OFFER_TTL_MS: "3000" };
    const expChild = spawn("node", ["server/index.mjs"], { cwd: root, env: expEnv, stdio: ["ignore", "pipe", "pipe"] });
    let expOut = "";
    expChild.stdout.on("data", (d) => (expOut += d));
    expChild.stderr.on("data", (d) => (expOut += d));
    const expBase = "http://127.0.0.1:3458";
    try {
      for (let i = 0; i < 120; i++) {
        try { const r = await fetch(expBase + "/api/health"); if (r.ok) break; } catch {}
        await sleep(500);
      }
      const expToken = extractSetupToken(expOut);
      check("expiry server generated its own setup token", typeof expToken === "string" && /^[0-9a-f]{64}$/.test(expToken || ""));
      const expCall = async (p, opts = {}) => {
        const headers = { "Content-Type": "application/json" };
        if (opts.cookie) headers.Cookie = opts.cookie;
        const res = await fetch(expBase + p, { headers, method: opts.method || "GET", body: opts.body });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data, setCookie: res.headers.getSetCookie() };
      };
      const expSetup = await expCall("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin: expToken, name: "Owner", phone: "03266040350", password: "ownerpass" }) });
      check("expiry server admin setup works", expSetup.status === 200, `got ${expSetup.status}`);
      const expAdminCookie = expSetup.setCookie && expSetup.setCookie[0].split(";")[0];
      await expCall("/api/admin/settings", { method: "POST", body: JSON.stringify({ pilot_mode: "0", pilot_chunian_only: "0" }), cookie: expAdminCookie });
      const expRider = await expCall("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Exp Rider", phone: "0309-1212121", password: "expriderpass", role: "rider" }) });
      check("expiry server rider signs up", expRider.status === 200 && !!expRider.data.user.id, `got ${expRider.status}`);
      const expRiderCookie = expRider.setCookie[0].split(";")[0];
      const expRiderId = expRider.data.user.id;
      const expDriver = await expCall("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0301-0000003", password: "expdriverpass" }) });
      check("expiry server demo driver logs in (claims account)", expDriver.status === 200 && expDriver.data.claimed === true, `got ${expDriver.status}`);
      const expDriverCookie = expDriver.setCookie[0].split(";")[0];
      const expDriverId = expDriver.data.user.id;
      const expRide = await expCall("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: expRiderId, pickup: "Chunian City", destination: "Pattoki", vehicle: "car", proposed_fare: 980 }), cookie: expRiderCookie });
      check("expiry server ride booked", expRide.status === 200 && !!expRide.data.ride_id, JSON.stringify(expRide.data));
      const expRideId = expRide.data.ride_id;
      const expDetail = await expCall(`/api/rides/${expRideId}`, { cookie: expRiderCookie });
      const expOffer = expDetail.data.offers.find((o) => o.driver_id === expDriverId && o.status === "pending");
      check("expiry server offer has expires_at = created_at + 3000 (test TTL)", !!expOffer && expOffer.expires_at === expOffer.created_at + 3000, JSON.stringify(expOffer));
      await sleep(4000);
      const expAccept = await expCall(`/api/rides/${expRideId}/offers/${expOffer.id}/accept`, { method: "POST", body: "{}", cookie: expRiderCookie });
      check("accepting an expired offer -> 400", expAccept.status === 400, `got ${expAccept.status}: ${JSON.stringify(expAccept.data)}`);
      const expDriverAccept = await expCall(`/api/rides/${expRideId}/offers/${expOffer.id}/accept-driver`, { method: "POST", body: "{}", cookie: expDriverCookie });
      check("driver-accepting an expired offer -> 400", expDriverAccept.status === 400, `got ${expDriverAccept.status}`);
      const expDetail2 = await expCall(`/api/rides/${expRideId}`, { cookie: expRiderCookie });
      const expOffer2 = expDetail2.data.offers.find((o) => o.id === expOffer.id);
      check("expired offer reads back with status 'expired'", !!expOffer2 && expOffer2.status === "expired", JSON.stringify(expOffer2));
      const expDecline = await expCall(`/api/rides/${expRideId}/decline`, { method: "POST", body: JSON.stringify({ driver_id: expDriverId }), cookie: expDriverCookie });
      check("declining an expired offer -> 400", expDecline.status === 400, `got ${expDecline.status}`);
    } finally {
      expChild.kill();
      await sleep(300);
      if (fs.existsSync(expDb)) fs.unlinkSync(expDb);
      if (fs.existsSync(expDb + "-journal")) fs.unlinkSync(expDb + "-journal");
    }
  }

  console.log(process.exitCode ? "\nSMOKE: FAILURES PRESENT" : "\nSMOKE: ALL CHECKS PASSED");
}

main()
  .catch((e) => { console.error("SMOKE ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await sleep(300); stopServer(); if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile); if (fs.existsSync(dbFile + "-journal")) fs.unlinkSync(dbFile + "-journal"); });
