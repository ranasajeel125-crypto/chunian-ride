// Chunian Ride smoke test — boots the server on a scratch port with a
// scratch SQLite file and runs a full end-to-end pass, printing exact numbers.
// Phase 1: covers auth (signup/login/guards), the top-up approval flow,
// RBAC (403s), transactions (no double-credit / no double-completion),
// and a restart-persistence check on the same DB file.
// Usage: npm run smoke
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, "data");
const dbFile = path.join(dataDir, "smoke.db");
if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
if (fs.existsSync(dbFile + "-journal")) fs.unlinkSync(dbFile + "-journal");

const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT: String(PORT), TURSO_DATABASE_URL: "file:./data/smoke.db" };

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
  for (let i = 0; i < 40; i++) {
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

  // Fare: Chunian -> Pattoki, 14 km, car @ Rs 70/km = Rs 980.
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

  // ---- Auth guards: nothing works without a session ----
  await expectFail("unauthenticated ride booking -> 401", () => call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: 1, pickup: "Chunian City", destination: "Pattoki", vehicle: "car" }) }), 401);
  await expectFail("unauthenticated wallet read -> 401", () => call("/api/drivers/3/wallet"), 401);
  await expectFail("unauthenticated admin rides -> 401", () => call("/api/admin/rides"), 401);
  await expectFail("signup without password -> 400", () => call("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "No Pass", phone: "0309-1111111", role: "rider" }) }), 400);

  // ---- Admin bootstrap: PIN works once, then dies ----
  const setupNeeded = await call("/api/admin/setup-needed");
  check("admin setup needed on fresh DB", setupNeeded.setup_needed === true);
  await expectFail("admin setup with wrong PIN -> 401", () => call("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin: "0000", name: "Owner", phone: "03266040350", password: "ownerpass" }) }), 401);
  const setup = await callRaw("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin: "1234", name: "Owner", phone: "03266040350", password: "ownerpass" }) });
  check("admin setup with PIN creates owner", setup.status === 200 && setup.data.admin && setup.data.admin.role === "owner", JSON.stringify(setup.data));
  saveCookie("admin", setup.setCookie);
  check("admin setup-needed now false", (await call("/api/admin/setup-needed")).setup_needed === false);
  await expectFail("second admin setup -> 400 (PIN dead)", () => call("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin: "1234", name: "Owner2", phone: "03266040351", password: "ownerpass" }) }), 400);
  const adminLoginBad = await callRaw("/api/admin/login", { method: "POST", body: JSON.stringify({ phone: "03266040350", password: "wrongpass" }) });
  check("admin login with wrong password -> 401", adminLoginBad.status === 401);
  // Login rate limit (dummy phone — the real admin phone stays usable).
  for (let i = 0; i < 5; i++) await callRaw("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0300-0000001", password: "wrong" }) });
  const locked = await callRaw("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0300-0000001", password: "wrong" }) });
  check("6th failed login in 15 min -> 429 rate limit", locked.status === 429, `got ${locked.status}`);

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
  await call(`/api/rides/${ride.ride_id}/rate`, { method: "POST", body: JSON.stringify({ by: "rider", stars: 5 }), session: "rider" });
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

  // Admin PIN is dead — the old header no longer works.
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

  console.log(process.exitCode ? "\nSMOKE: FAILURES PRESENT" : "\nSMOKE: ALL CHECKS PASSED");
}

main()
  .catch((e) => { console.error("SMOKE ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await sleep(300); stopServer(); if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile); if (fs.existsSync(dbFile + "-journal")) fs.unlinkSync(dbFile + "-journal"); });
