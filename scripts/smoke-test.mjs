// Chunian Ride smoke test — boots the server on a scratch port with a
// scratch SQLite file and runs a full end-to-end pass, printing exact numbers.
// Usage: npm run smoke
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, "data");
const dbFile = path.join(dataDir, "smoke.db");
if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);

const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT: String(PORT), TURSO_DATABASE_URL: "file:./data/smoke.db" };
const child = spawn("node", ["server/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(p, opts = {}) {
  const res = await fetch(BASE + p, { headers: { "Content-Type": "application/json", ...(opts.admin ? { "X-Admin-Pin": "1234" } : {}) }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

async function main() {
  // Wait for the server.
  for (let i = 0; i < 30; i++) {
    try { await call("/api/health"); break; } catch { await sleep(500); }
    if (i === 29) throw new Error("server did not start:\n" + out);
  }
  const health = await call("/api/health");
  check("health ok", health.ok === true, `db=${health.db}`);

  const places = await call("/api/places");
  check("8 places", places.places.length === 8);
  const pattoki = places.places.find((p) => p.name === "Pattoki");
  check("Pattoki = 14 km", pattoki.km === 14);

  // Fare: Chunian -> Pattoki, 14 km, car @ Rs 70/km = Rs 980.
  const fare = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Pattoki", vehicle: "car" }) });
  check("car fare Chunian->Pattoki = Rs 980", fare.suggested_fare === 980, `got Rs ${fare.suggested_fare}`);
  const bikeFare = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Chunian City", vehicle: "bike", distance_km: 3 }) });
  check("bike 3 km = Rs 50 minimum", bikeFare.suggested_fare === 50, `got Rs ${bikeFare.suggested_fare}`);
  const lahore = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Lahore", vehicle: "car" }) });
  check("car fare Chunian->Lahore = Rs 6230 (89 km)", lahore.suggested_fare === 6230, `got Rs ${lahore.suggested_fare}`);

  // Rider signup.
  const rider = await call("/api/signup", { method: "POST", body: JSON.stringify({ name: "Smoke Rider", phone: "0309-9999999", role: "rider" }) });
  check("rider signup", !!rider.user.id, `id=${rider.user.id}`);

  // Book a ride: rider proposes Rs 900 (below suggested 980).
  const ride = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.user.id, pickup: "Chunian City", destination: "Pattoki", vehicle: "car", proposed_fare: 900 }) });
  check("ride requested", !!ride.ride_id, `ride #${ride.ride_id}, offers=${ride.offers_created}`);
  check("2 car drivers offered", ride.offers_created === 2, `got ${ride.offers_created}`);

  const detail = await call(`/api/rides/${ride.ride_id}`);
  const offer = detail.offers.find((o) => o.status === "pending");
  check("offer fare = suggested Rs 980 (not the lowball 900)", offer.fare === 980, `got Rs ${offer.fare}`);
  const driverId = offer.driver_id;

  // Driver sees the request with rider-proposed fare before accepting.
  const reqs = await call(`/api/drivers/${driverId}/requests`);
  check("driver sees request with proposed fare Rs 900", reqs.requests.some((r) => r.id === ride.ride_id && r.proposed_fare === 900));

  // Driver counter-offers Rs 950, rider accepts it.
  const counter = await call(`/api/rides/${ride.ride_id}/counter`, { method: "POST", body: JSON.stringify({ driver_id: driverId, fare: 950 }) });
  check("counter-offer created", !!counter.offer_id, `offer #${counter.offer_id} @ Rs 950`);
  const accepted = await call(`/api/rides/${ride.ride_id}/offers/${counter.offer_id}/accept`, { method: "POST", body: "{}" });
  check("rider picks counter-offer, agreed fare Rs 950", accepted.agreed_fare === 950, `got Rs ${accepted.agreed_fare}`);

  // Wallet before.
  const walletBefore = await call(`/api/drivers/${driverId}/wallet`);
  const balBefore = walletBefore.wallet_balance;

  // Start, then complete WITHOUT cash -> must fail.
  await call(`/api/rides/${ride.ride_id}/start`, { method: "POST", body: "{}" });
  let noCashBlocked = false;
  try { await call(`/api/rides/${ride.ride_id}/complete`, { method: "POST", body: JSON.stringify({ cash_received: false }) }); } catch { noCashBlocked = true; }
  check("complete without cash confirmation is blocked", noCashBlocked);

  // Complete with cash: fare 950, commission 12% = 114 + Rs 20 fee = Rs 134.
  const done = await call(`/api/rides/${ride.ride_id}/complete`, { method: "POST", body: JSON.stringify({ cash_received: true }) });
  check("trip completed, platform take = Rs 134 (114 + 20)", done.platform_take === 134, `got Rs ${done.platform_take}`);
  check("driver kept Rs 816", done.driver_kept === 816, `got Rs ${done.driver_kept}`);
  check("wallet deducted by Rs 134", done.driver_wallet_balance === balBefore - 134, `${balBefore} -> ${done.driver_wallet_balance}`);

  // Rating + history + share + SOS.
  await call(`/api/rides/${ride.ride_id}/rate`, { method: "POST", body: JSON.stringify({ by: "rider", stars: 5 }) });
  const hist = await call(`/api/rides?rider_id=${rider.user.id}`);
  check("ride history shows completed ride", hist.rides.some((r) => r.id === ride.ride_id && r.status === "completed"));
  const share = await call(`/api/rides/${ride.ride_id}/share`);
  check("share link returned", share.url.includes(`/api/rides`) === false && share.url.includes("?ride="), share.url);
  const sos = await call(`/api/rides/${ride.ride_id}/sos`, { method: "POST", body: JSON.stringify({ user_id: rider.user.id, message: "smoke SOS" }) });
  check("SOS returns Police 15 / Rescue 1122", sos.police === "15" && sos.rescue === "1122");

  // In-ride chat: rider sends, driver reads; driver replies, rider reads.
  const chat1 = await call(`/api/rides/${ride.ride_id}/messages`, { method: "POST", body: JSON.stringify({ sender_id: rider.user.id, sender_role: "rider", message: "Assalam-o-Alaikum, main pickup par khara hoon." }) });
  check("rider chat message sent", !!chat1.message_id, `id=${chat1.message_id}`);
  const chatAsDriver = await call(`/api/rides/${ride.ride_id}/messages?user_id=${driverId}`);
  check("driver can read ride chat", chatAsDriver.messages.some((m) => m.message.includes("pickup par")));
  const chat2 = await call(`/api/rides/${ride.ride_id}/messages`, { method: "POST", body: JSON.stringify({ sender_id: driverId, sender_role: "driver", message: "5 minute mein aa raha hoon." }) });
  check("driver chat reply sent", !!chat2.message_id);
  const chatAsRider = await call(`/api/rides/${ride.ride_id}/messages?user_id=${rider.user.id}`);
  check("rider can read driver reply", chatAsRider.messages.length === 2, `got ${chatAsRider.messages.length}`);
  let chatBlocked = false;
  try { await call(`/api/rides/${ride.ride_id}/messages?user_id=999999`); } catch { chatBlocked = true; }
  check("chat is private to the ride's rider/driver", chatBlocked);

  // Live location: driver posts GPS, ride detail carries it.
  const loc = await call(`/api/drivers/${driverId}/location`, { method: "POST", body: JSON.stringify({ lat: 30.97, lng: 74.03 }) });
  check("driver location posted", loc.ok === true);
  const detail2 = await call(`/api/rides/${ride.ride_id}`);
  check("ride detail carries live driver location", detail2.driver_location && detail2.driver_location.lat === 30.97, JSON.stringify(detail2.driver_location));

  // No fake ratings: a demo driver with no completed-ride rating has count 0.
  const allDrivers = await call("/api/admin/drivers", { admin: true });
  const hassan = allDrivers.drivers.find((x) => x.name === "Hassan Ali");
  check("unrated demo driver shows no fake rating (count 0)", !!hassan && hassan.rating_count === 0, `count=${hassan && hassan.rating_count}`);

  // Driver earnings (today): the smoke ride (Rs 950, fee Rs 134) PLUS the
  // seeded demo ride for the same driver (Usman, Rs 980, fee Rs 138, ~23.5h ago).
  const earn = await call(`/api/drivers/${driverId}/earnings?days=1`);
  check("driver earnings today: 2 rides, kept Rs 1658", earn.rides === 2 && earn.driver_kept === 1658, JSON.stringify(earn));

  // Top-up.
  const top = await call(`/api/drivers/${driverId}/topup`, { method: "POST", body: JSON.stringify({ amount: 500, method: "JazzCash", tid: "SMOKE-TID-1" }) });
  check("top-up +Rs 500", top.wallet_balance === balBefore - 134 + 500, `balance Rs ${top.wallet_balance}`);

  // Admin: settings change takes effect immediately.
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ rate_car_per_km: 80 }), admin: true });
  const fare2 = await call("/api/fare", { method: "POST", body: JSON.stringify({ pickup: "Chunian City", destination: "Pattoki", vehicle: "car" }) });
  check("admin rate change applies immediately (car 80/km -> Rs 1120)", fare2.suggested_fare === 1120, `got Rs ${fare2.suggested_fare}`);
  await call("/api/admin/settings", { method: "POST", body: JSON.stringify({ rate_car_per_km: 70 }), admin: true });

  const report = await call("/api/admin/reports?days=7", { admin: true });
  check("7-day report counts the completed ride", report.rides >= 1 && report.platform_revenue >= 134, `rides=${report.rides}, revenue=Rs ${report.platform_revenue}`);
  const profit = await call("/api/admin/profit?avg_fare=300&monthly_cost=60000", { admin: true });
  check("profit calculator: break-even 36 rides/day at 12%+20 on Rs 300", profit.break_even_rides_per_day === 36, `got ${profit.break_even_rides_per_day}/day`);
  check("profit labelled estimates only", profit.estimates_only === true);

  // Admin PIN required.
  let pinRequired = false;
  try { await call("/api/admin/rides"); } catch { pinRequired = true; }
  check("admin endpoints require PIN", pinRequired);

  // Seed data present.
  const drivers = await call("/api/admin/drivers", { admin: true });
  check("4 seeded demo drivers", drivers.drivers.length === 4, drivers.drivers.map((d) => d.name).join(", "));
  const allRides = await call("/api/admin/rides", { admin: true });
  check("2 seeded demo rides + smoke ride present", allRides.rides.length >= 3, `total ${allRides.rides.length}`);

  // --- inDrive features (2026-11-07): scheduled rides + tips ---
  // Scheduled ride: 2 days ahead, stored + shown to driver + rider.
  const schedTime = Date.now() + 2 * 86400000;
  const schedRide = await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.user.id, pickup: "Chunian City", destination: "Kasur", vehicle: "car", proposed_fare: 3000, scheduled_for: schedTime }) });
  check("scheduled ride created", !!schedRide.ride_id && schedRide.scheduled_for === schedTime, `ride #${schedRide.ride_id}`);
  const schedDetail = await call(`/api/rides/${schedRide.ride_id}`);
  check("scheduled ride stores its time", schedDetail.ride.scheduled_for === schedTime, `got ${schedDetail.ride.scheduled_for}`);
  const schedReqs = await call(`/api/drivers/${driverId}/requests`);
  check("driver sees scheduled ride with its time", schedReqs.requests.some((r) => r.id === schedRide.ride_id && r.scheduled_for === schedTime));
  let schedPastBlocked = false;
  try { await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.user.id, pickup: "Chunian City", destination: "Kasur", vehicle: "car", proposed_fare: 3000, scheduled_for: Date.now() - 60000 }) }); } catch { schedPastBlocked = true; }
  check("scheduled ride in the past is rejected", schedPastBlocked);
  let schedFarBlocked = false;
  try { await call("/api/rides", { method: "POST", body: JSON.stringify({ rider_id: rider.user.id, pickup: "Chunian City", destination: "Kasur", vehicle: "car", proposed_fare: 3000, scheduled_for: Date.now() + 8 * 86400000 }) }); } catch { schedFarBlocked = true; }
  check("scheduled ride more than 7 days ahead is rejected", schedFarBlocked);

  // Tip: on the completed smoke ride (fare Rs 950, fee Rs 134 already charged).
  let tipEarlyBlocked = false;
  try { await call(`/api/rides/${schedRide.ride_id}/tip`, { method: "POST", body: JSON.stringify({ rider_id: rider.user.id, amount: 50 }) }); } catch { tipEarlyBlocked = true; }
  check("tip on a non-completed ride is rejected", tipEarlyBlocked);
  const tipRes = await call(`/api/rides/${ride.ride_id}/tip`, { method: "POST", body: JSON.stringify({ rider_id: rider.user.id, amount: 50 }) });
  check("tip Rs 50 added, 0% commission on tip", tipRes.tip === 50 && tipRes.commission_on_tip === 0, JSON.stringify(tipRes));
  const tippedRide = await call(`/api/rides/${ride.ride_id}`);
  check("ride receipt shows tip Rs 50", tippedRide.ride.tip_amount === 50, `got ${tippedRide.ride.tip_amount}`);
  const walletAfterTip = await call(`/api/drivers/${driverId}/wallet`);
  check("tip is cash — prepaid wallet balance unchanged by tip", walletAfterTip.wallet_balance === balBefore - 134 + 500, `balance Rs ${walletAfterTip.wallet_balance}`);
  let tipTwiceBlocked = false;
  try { await call(`/api/rides/${ride.ride_id}/tip`, { method: "POST", body: JSON.stringify({ rider_id: rider.user.id, amount: 20 }) }); } catch { tipTwiceBlocked = true; }
  check("second tip on the same ride is rejected", tipTwiceBlocked);
  const earn2 = await call(`/api/drivers/${driverId}/earnings?days=1`);
  check("earnings include tips Rs 50, driver kept +Rs 50", earn2.tips === 50 && earn2.driver_kept === 1658 + 50, JSON.stringify(earn2));
  const hist2 = await call(`/api/rides?rider_id=${rider.user.id}`);
  check("rider history shows the tip on the completed ride", hist2.rides.some((r) => r.id === ride.ride_id && r.tip_amount === 50));

  // Static pages.
  const page = await fetch(BASE + "/");
  check("homepage HTTP 200", page.status === 200);
  const pageText = await page.text();
  check("homepage mentions Version 1 testing + Uber/Careem exit note", pageText.includes("Version 1") && pageText.includes("30 Apr 2024"));
  check("homepage has scheduled-ride inputs + tip box", pageText.includes("sched-date") && pageText.includes("sched-time") && pageText.includes("tip-box"));
  const appJs = await (await fetch(BASE + "/app.js?v=3")).text();
  check("served app.js has quick counter buttons + tip + scheduled logic", appJs.includes("setCounter") && appJs.includes("addTip") && appJs.includes("scheduled_for"));
  const css = await (await fetch(BASE + "/style.css?v=4")).text();
  check("served style.css has quick-btn + tip-box styles", css.includes(".quick-btn") && css.includes(".tip-box"));

  console.log(process.exitCode ? "\nSMOKE: FAILURES PRESENT" : "\nSMOKE: ALL CHECKS PASSED");
}

main()
  .catch((e) => { console.error("SMOKE ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => { await sleep(300); child.kill(); if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile); });
