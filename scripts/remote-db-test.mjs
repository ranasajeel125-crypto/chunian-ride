// Chunian Ride remote-libsql test — proves the app works against a remote
// libSQL endpoint (the same protocol Turso uses) instead of a local file.
// Expects a sqld (or Turso-compatible) server on SQLD_URL (default
// http://127.0.0.1:8080). Boots the app, runs a mini end-to-end pass,
// restarts the app against the SAME remote DB, and verifies records persist.
// Usage: SQLD_URL=http://127.0.0.1:8080 node scripts/remote-db-test.mjs
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SQLD_URL = process.env.SQLD_URL || "http://127.0.0.1:8080";
const PORT = 3458;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT: String(PORT), TURSO_DATABASE_URL: SQLD_URL };
delete env.TURSO_AUTH_TOKEN;

let child = null;
let serverOut = "";
function startServer() {
  child = spawn("node", ["server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  serverOut = "";
  child.stdout.on("data", (d) => (serverOut += d));
  child.stderr.on("data", (d) => (serverOut += d));
  return child;
}
function stopServer() { if (child) { child.kill(); child = null; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jar = {};
async function callRaw(p, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (opts.session && jar[opts.session]) headers.Cookie = jar[opts.session];
  const res = await fetch(BASE + p, { headers, ...opts });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, setCookie: res.headers.getSetCookie() };
}
async function call(p, opts = {}) {
  const r = await callRaw(p, opts);
  if (r.status < 200 || r.status >= 300) throw new Error(`${p} -> HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};
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
  check("health reports db=turso (remote libSQL)", health.db === "turso", `db=${health.db}`);

  // Admin bootstrap.
  const setup = await callRaw("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin: "1234", name: "Owner", phone: "03266040350", password: "ownerpass" }) });
  check("admin setup on remote DB", setup.status === 200);
  if (setup.setCookie.length) jar.admin = setup.setCookie[0].split(";")[0];

  // Rider + driver signup/login.
  const riderRes = await callRaw("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Remote Rider", phone: "0309-7777777", password: "riderpass", role: "rider" }) });
  check("rider signup on remote DB", riderRes.status === 200);
  jar.rider = riderRes.setCookie[0].split(";")[0];
  const rider = riderRes.data.user;

  const driverLogin = await callRaw("/api/auth/login", { method: "POST", body: JSON.stringify({ phone: "0301-0000003", password: "driverpass" }) });
  check("demo driver login on remote DB", driverLogin.status === 200);
  jar.driver = driverLogin.setCookie[0].split(";")[0];

  // Book -> counter -> accept -> start -> complete.
  const ride = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.id, pickup: "Chunian City", destination: "Pattoki", vehicle: "car", proposed_fare: 900 }), session: "rider" });
  check("ride booked on remote DB", !!ride.ride_id, `ride #${ride.ride_id}`);
  const detail = await call(`/api/rides/${ride.ride_id}`, { session: "rider" });
  const offer = detail.offers.find((o) => o.status === "pending");
  const counter = await call(`/api/rides/${ride.ride_id}/counter`, { method: "POST", body: JSON.stringify({ driver_id: offer.driver_id, fare: 950 }), session: "driver" });
  await call(`/api/rides/${ride.ride_id}/offers/${counter.offer_id}/accept`, { method: "POST", body: "{}", session: "rider" });
  await call(`/api/rides/${ride.ride_id}/start`, { method: "POST", body: "{}", session: "driver" });
  const done = await call(`/api/rides/${ride.ride_id}/complete`, { method: "POST", body: JSON.stringify({ cash_received: true }), session: "driver" });
  check("ride completed on remote DB, take Rs 134", done.platform_take === 134, `take=${done.platform_take}`);

  // Top-up request -> approve -> balance credited.
  const topReq = await call(`/api/drivers/${offer.driver_id}/topup`, { method: "POST", body: JSON.stringify({ amount: 500, method: "JazzCash", tid: "REMOTE-TID-1" }), session: "driver" });
  check("top-up pending on remote DB", topReq.status === "pending");
  const approved = await call(`/api/admin/topups/${topReq.request_id}/approve`, { method: "POST", body: "{}", session: "admin" });
  check("top-up approved on remote DB", approved.status === "approved" && approved.wallet_balance === done.driver_wallet_balance + 500, `balance=${approved.wallet_balance}`);

  const balanceKept = approved.wallet_balance;
  const rideIdKept = ride.ride_id;

  // Restart the APP (remote DB keeps running) and verify everything persists.
  stopServer();
  await sleep(500);
  startServer();
  await waitForHealth();
  const health2 = await call("/api/health");
  check("app restarts against the same remote DB", health2.ok === true && health2.db === "turso");
  const rideAfter = await call(`/api/rides/${rideIdKept}`, { session: "rider" });
  check("ride record survives app restart (remote DB)", rideAfter.ride && rideAfter.ride.status === "completed");
  const walletAfter = await call(`/api/drivers/${offer.driver_id}/wallet`, { session: "driver" });
  check("wallet balance survives app restart (remote DB)", walletAfter.wallet_balance === balanceKept, `balance Rs ${walletAfter.wallet_balance}`);
  const meAfter = await fetch(BASE + "/api/auth/me", { headers: { Cookie: jar.rider } });
  check("session survives app restart (remote DB)", meAfter.status === 200);

  console.log(process.exitCode ? "\nREMOTE-DB TEST: FAILURES PRESENT" : "\nREMOTE-DB TEST: ALL CHECKS PASSED");
}

main()
  .catch((e) => { console.error("REMOTE-DB TEST ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await sleep(300); stopServer(); });
