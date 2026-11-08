// Chunian Ride — rider app (rider.html). Passenger only; no driver/admin code.
const store = { rider: null };
let places = [];
let settings = { rate_bike_per_km: 15, rate_rickshaw_per_km: 25, rate_car_per_km: 70, rate_ac_car_per_km: 85, min_bike: 50, min_rickshaw: 100, min_car: 150, min_ac_car: 200, jazzcash_number: "03266040350", support_phone: "" };
let vehicle = "bike";
let currentRide = null;
let fareEstimate = null;
let map, markers = {}, pickupMarker = null, destMarker = null, driverMarker = null, gpsMarker = null;
let gpsPos = null;          // {lat, lng} from the rider's phone GPS
let gpsDistanceKm = null;   // haversine km from GPS pickup to the destination place
let chatTimer = null;
let currentScreen = "home";

const VEHICLES = [
  { key: "bike", ico: "🏍️" }, { key: "rickshaw", ico: "🛺" },
  { key: "car", ico: "🚗" }, { key: "ac_car", ico: "❄️🚗" },
];
function placeByName(name) { return places.find((p) => p.name === name) || null; }
function vehLabel(k) { return t(k === "ac_car" ? "ac_car" : k); }

// ---------- Screen router (one screen visible at a time) ----------
function switchScreen(name) {
  currentScreen = name;
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + name));
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.screen === name));
  if (name === "rides") loadHistory();
  if (name === "wallet") loadRiderWallet();
  if (name === "profile") renderProfile();
  if (name === "home" && map) setTimeout(() => map.invalidateSize(), 50);
  window.scrollTo({ top: 0 });
}
$$(".nav-btn").forEach((b) => b.addEventListener("click", () => switchScreen(b.dataset.screen)));

// ---------- Language: re-render dynamic text ----------
window.onLangChange = () => {
  renderVehicles();
  if (fareEstimate) renderFareBox();
  if (currentRide) showTrip(true);
  if (currentScreen === "rides") loadHistory();
  if (currentScreen === "wallet") loadRiderWallet();
  if (currentScreen === "profile") renderProfile();
};

// ---------- Map ----------
function setPin(which, p) {
  if (!map) return;
  if (which === "pickup") {
    if (pickupMarker) map.removeLayer(pickupMarker);
    pickupMarker = L.marker([p.lat, p.lng]).addTo(map).bindPopup(t("pickup_label") + ": " + p.name).openPopup();
  } else {
    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker([p.lat, p.lng]).addTo(map).bindPopup(t("dest_label") + ": " + p.name).openPopup();
  }
}
async function initMap() {
  const data = await api("/api/places");
  places = data.places || [];
  const sel1 = $("pickup"), sel2 = $("destination");
  const gpsOpt = document.createElement("option");
  gpsOpt.value = "__gps__"; gpsOpt.textContent = t("current_location");
  sel1.appendChild(gpsOpt);
  places.forEach((p) => {
    const o1 = document.createElement("option"); o1.value = p.name; o1.textContent = p.name + (p.km != null ? ` (${p.km} km)` : "");
    const o2 = o1.cloneNode(true);
    sel1.appendChild(o1); sel2.appendChild(o2);
  });
  sel1.value = "__gps__"; sel2.value = "Pattoki";
  map = initBaseMap("map");
  markers = addPlacePins(map, places, (p) => {
    if (!sel1.dataset.locked) { sel1.value = p.name; sel1.dataset.locked = "1"; gpsPos = null; setPin("pickup", p); }
    else { sel2.value = p.name; delete sel1.dataset.locked; setPin("dest", p); }
    onRouteChange();
  });
  // GPS pickup by default; fall back to Chunian City if GPS is unavailable.
  requestGpsPickup(true);
  onRouteChange();
}
function requestGpsPickup(silent) {
  if (!("geolocation" in navigator)) {
    if (!silent) toast(t("gps_unavailable"), "error");
    fallbackPickup();
    return;
  }
  if (!silent) setErr($("gps-err"), t("gps_waiting"));
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      gpsPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $("pickup").value = "__gps__";
      if (gpsMarker) map.removeLayer(gpsMarker);
      gpsMarker = L.circleMarker([gpsPos.lat, gpsPos.lng], { radius: 8, color: "#0b5ed7", weight: 2, fillColor: "#2f7fe0", fillOpacity: 0.9 }).addTo(map).bindPopup(t("current_location"));
      setErr($("gps-err"), "");
      if (!silent) toast(t("gps_ok"), "ok");
      computeGpsDistance();
      onRouteChange();
    },
    (err) => {
      if (!silent) { setErr($("gps-err"), t(err.code === 1 ? "gps_denied" : "gps_unavailable")); toast(t(err.code === 1 ? "gps_denied" : "gps_unavailable"), "error"); }
      fallbackPickup();
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}
function fallbackPickup() {
  gpsPos = null; gpsDistanceKm = null;
  if (placeByName("Chunian City")) $("pickup").value = "Chunian City";
}
function computeGpsDistance() {
  gpsDistanceKm = null;
  if (!gpsPos) return;
  const dest = placeByName($("destination").value);
  if (dest) gpsDistanceKm = haversineKm(gpsPos.lat, gpsPos.lng, dest.lat, dest.lng);
}

// ---------- Vehicles + automatic fare estimate ----------
function renderVehicles() {
  const row = $("veh-row");
  row.innerHTML = VEHICLES.map((v) => {
    const rate = Number(settings["rate_" + v.key + "_per_km"] || 0);
    const min = Number(settings["min_" + v.key] || 0);
    return `<button data-v="${v.key}" class="veh-btn${vehicle === v.key ? " active" : ""}"><span class="veh-ico">${v.ico}</span><span class="veh-name">${vehLabel(v.key)}</span><span class="veh-rate">${t("per_km", { rate })} · ${t("min_fare", { min })}</span></button>`;
  }).join("");
  $$(".veh-btn", row).forEach((b) => b.addEventListener("click", () => { pickVehicle(b.dataset.v); }));
}
function pickVehicle(v) {
  vehicle = v;
  $$(".veh-btn").forEach((b) => b.classList.toggle("active", b.dataset.v === v));
  onRouteChange();
}
function onRouteChange() {
  computeGpsDistance();
  const dest = $("destination").value;
  if (dest) estimateFare(true);
}
async function estimateFare(auto) {
  const dest = $("destination").value;
  if (!dest) { if (!auto) toast(t("fare_unknown"), "error"); return; }
  const body = { pickup: $("pickup").value === "__gps__" ? "Current location" : $("pickup").value, destination: dest, vehicle };
  if ($("pickup").value === "__gps__" && gpsDistanceKm) body.distance_km = Math.max(1, Math.round(gpsDistanceKm * 10) / 10);
  try {
    const d = await api("/api/fare", { method: "POST", body: JSON.stringify(body) });
    fareEstimate = d;
    renderFareBox();
    $("proposed-fare").value = d.suggested_fare;
  } catch (e) {
    if (!auto) { setErr($("fare-err"), e.message); toast(e.message, "error"); }
  }
}
function renderFareBox() {
  const d = fareEstimate;
  if (!d) return;
  $("fare-box").classList.remove("hidden");
  $("fare-box").innerHTML = `${t("fare_estimate")}: <b>${fmtRs(d.suggested_fare)}</b> — ${t("fare_distance", { km: d.distance_km, per_km: d.per_km, min: d.min_fare })}${d.distance_estimated ? " — <i>" + t("fare_estimated_note") + "</i>" : ""}`;
}

// ---------- Auth ----------
async function riderSignup(btn) {
  const name = $("rider-name").value.trim(), phone = $("rider-phone").value.trim(), password = $("rider-password").value;
  if (!name || !phone || !password) { setErr($("auth-err"), t("err_name_phone_pw")); return; }
  setLoading(btn, true);
  try {
    const d = await api("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, phone, password, role: "rider" }) });
    store.rider = d.user;
    afterLogin();
    toast(t("welcome_back") + ", " + d.user.name, "ok");
  } catch (e) { setErr($("auth-err"), e.message); }
  finally { setLoading(btn, false); }
}
async function riderLogin(btn) {
  const phone = $("rider-phone").value.trim(), password = $("rider-password").value;
  if (!phone || !password) { setErr($("auth-err"), t("err_phone_pw")); return; }
  setLoading(btn, true);
  try {
    const d = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ phone, password }) });
    store.rider = d.user;
    afterLogin();
    toast(t("welcome_back") + ", " + d.user.name, "ok");
  } catch (e) { setErr($("auth-err"), e.message); }
  finally { setLoading(btn, false); }
}
function afterLogin() {
  $("rider-auth").classList.add("hidden");
  $("booking-card").classList.remove("hidden");
  $("rider-who").textContent = `${t("hello")}, ${store.rider.name} (${store.rider.phone}) — ${t("your_id")} #${store.rider.id}`;
  renderProfile();
  loadRecentDestinations();
  if (currentRide) showTrip();
}

// ---------- Booking: ONE button ----------
async function requestRide(btn) {
  if (!store.rider) { setErr($("book-err"), t("err_login_first")); toast(t("err_login_first"), "error"); return; }
  const body = { rider_id: store.rider.id, pickup: $("pickup").value === "__gps__" ? "Current location" : $("pickup").value, destination: $("destination").value, vehicle, proposed_fare: Number($("proposed-fare").value) || (fareEstimate && fareEstimate.suggested_fare) };
  if ($("pickup").value === "__gps__" && gpsDistanceKm) body.distance_km = Math.max(1, Math.round(gpsDistanceKm * 10) / 10);
  const sd = $("sched-date").value, st = $("sched-time").value;
  if (sd || st) {
    if (!sd || !st) { setErr($("book-err"), t("sched_both")); return; }
    const when = new Date(sd + "T" + st).getTime();
    if (!Number.isFinite(when)) { setErr($("book-err"), t("sched_bad")); return; }
    if (when <= Date.now()) { setErr($("book-err"), t("sched_past")); return; }
    if (when > Date.now() + 7 * 86400000) { setErr($("book-err"), t("sched_7d")); return; }
    body.scheduled_for = when;
  }
  setErr($("book-err"), "");
  setLoading(btn, true);
  try {
    const d = await api("/api/rides", { method: "POST", body: JSON.stringify(body) });
    currentRide = d.ride_id;
    $("offers-card").classList.remove("hidden");
    await loadOffers();
    toast(d.scheduled_for ? t("ride_requested_sched", { id: d.ride_id, when: fmtSched(d.scheduled_for) }) : t("ride_requested", { id: d.ride_id, n: d.offers_created }), "ok");
    $("offers-card").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { setErr($("book-err"), e.message); toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
async function loadOffers() {
  if (!currentRide) return;
  try {
    const d = await api(`/api/rides/${currentRide}`);
    const list = $("offers-list");
    const pending = d.offers.filter((o) => o.status === "pending");
    list.innerHTML = pending.length ? pending.map((o) => `
      <div class="offer">
        <b>${fmtRs(o.fare)}</b> — ${escapeHtml(o.driver_name)} ${ratingText(o.driver_rating, o.driver_rating_count, "driver")}<br>
        ${escapeHtml(o.vehicle_model)} • ${escapeHtml(o.plate)} • ${t("eta_min", { min: o.eta_min })}
        <br><button class="primary" data-offer="${o.id}">${t("choose_driver")}</button>
      </div>`).join("") : `<p class="muted empty">${t("no_offers")}</p>`;
    $$("[data-offer]", list).forEach((b) => b.addEventListener("click", () => acceptOffer(Number(b.dataset.offer), b)));
    if (d.ride.status !== "requested") showTrip();
  } catch (e) { toast(e.message, "error"); }
}
async function acceptOffer(offerId, btn) {
  setLoading(btn, true);
  try {
    const d = await api(`/api/rides/${currentRide}/offers/${offerId}/accept`, { method: "POST", body: "{}" });
    toast(t("driver_accepted", { fare: d.agreed_fare }), "ok");
    showTrip();
  } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}

// ---------- Live trip ----------
async function showTrip(silent) {
  if (!currentRide) return;
  try {
    const d = await api(`/api/rides/${currentRide}`);
    const r = d.ride;
    const drv = d.offers.find((o) => o.status === "accepted");
    $("trip-card").classList.remove("hidden");
    let locLine = "";
    if (drv && (r.status === "accepted" || r.status === "ongoing")) {
      const loc = d.driver_location;
      const fresh = loc && loc.lat != null && loc.lng != null && loc.updated_at && Date.now() - loc.updated_at < 180000;
      if (fresh) {
        updateDriverMarker(loc.lat, loc.lng);
        const target = r.status === "accepted" ? placeByName(r.pickup) : placeByName(r.destination);
        let distTxt = "";
        if (target) {
          const km = haversineKm(loc.lat, loc.lng, target.lat, target.lng);
          const eta = Math.max(1, Math.round((km / 30) * 60));
          distTxt = t("driver_live_dist", { km: km.toFixed(1), place: r.status === "accepted" ? r.pickup : r.destination, min: eta });
        }
        locLine = `<p class="loc-line">${t("driver_live")}${distTxt}</p>`;
      } else {
        clearDriverMarker();
        locLine = `<p class="loc-line warn">${t("driver_loc_missing")}</p>`;
      }
    } else clearDriverMarker();
    $("trip-info").innerHTML = `
      <p><b>Ride #${r.id}</b> — ${escapeHtml(r.pickup)} → ${escapeHtml(r.destination)} (${r.distance_km} km, ${vehLabel(r.vehicle_type)})</p>
      ${schedLine(r.scheduled_for)}
      <p>${t("status")}: <span class="badge st-${r.status}">${escapeHtml(r.status)}</span> • ${t("fare")}: <b>${fmtRs(r.agreed_fare || r.suggested_fare)}</b> (${t("offered", { fare: r.proposed_fare })})${tipLine(r.tip_amount)}</p>
      ${drv ? `<p>${escapeHtml(drv.driver_name)} ${ratingText(drv.driver_rating, drv.driver_rating_count, "driver")} — ${escapeHtml(drv.vehicle_model)}, ${escapeHtml(drv.plate)}, ${t("eta_min", { min: drv.eta_min })}</p>` : ""}
      <p>${t("trip_cash")} ${r.cash_confirmed ? t("cash_confirmed") : ""}</p>
      ${locLine}
      ${r.status === "completed" ? `<p>${t("trip_done")}</p>` : ""}`;
    if (drv) { $("chat-box").classList.remove("hidden"); loadChat(); ensureChatTimer(); }
    else $("chat-box").classList.add("hidden");
    if (r.status === "completed") {
      $("rate-box").classList.remove("hidden");
      $("rate-stars").innerHTML = [1, 2, 3, 4, 5].map((s) => `<button data-stars="${s}" aria-label="${s} stars">⭐</button>`).join("");
      $$("#rate-stars button").forEach((b) => b.addEventListener("click", () => rateRide(Number(b.dataset.stars))));
      if (!r.tip_amount) { $("tip-box").classList.remove("hidden"); $("tip-out").textContent = ""; }
      else $("tip-box").classList.add("hidden");
    } else $("tip-box").classList.add("hidden");
    if (r.status === "requested") setTimeout(loadOffers, 8000);
    if (r.status === "accepted" || r.status === "ongoing") setTimeout(() => showTrip(), 8000);
  } catch (e) { if (!silent) toast(e.message, "error"); }
}
function updateDriverMarker(lat, lng) {
  if (!map) return;
  if (driverMarker) driverMarker.setLatLng([lat, lng]);
  else driverMarker = L.marker([lat, lng]).addTo(map).bindPopup(t("driver_live"));
}
function clearDriverMarker() {
  if (driverMarker && map) { map.removeLayer(driverMarker); driverMarker = null; }
}

// ---------- In-ride chat ----------
function ensureChatTimer() {
  if (chatTimer) return;
  chatTimer = setInterval(() => {
    if (currentRide && !$("trip-card").classList.contains("hidden") && !$("chat-box").classList.contains("hidden")) loadChat();
  }, 5000);
}
function renderChatList(el, msgs, myRole) {
  if (!el) return;
  el.innerHTML = msgs.length ? msgs.map((m) => `<div class="chat-msg ${m.sender_role === myRole ? "mine" : "theirs"}"><span>${escapeHtml(m.message)}</span><small>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div>`).join("") : `<p class="muted">${t("chat_empty")}</p>`;
  el.scrollTop = el.scrollHeight;
}
async function loadChat() {
  if (!currentRide || !store.rider) return;
  try {
    const d = await api(`/api/rides/${currentRide}/messages?user_id=${store.rider.id}`);
    renderChatList($("chat-list"), d.messages, "rider");
  } catch {}
}
async function sendChat(btn) {
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text || !currentRide || !store.rider) return;
  setLoading(btn, true);
  try {
    await api(`/api/rides/${currentRide}/messages`, { method: "POST", body: JSON.stringify({ sender_id: store.rider.id, sender_role: "rider", message: text }) });
    input.value = "";
    loadChat();
  } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
async function rateRide(stars) {
  try { await api(`/api/rides/${currentRide}/rate`, { method: "POST", body: JSON.stringify({ by: "rider", stars }) }); toast(t("rating_saved"), "ok"); } catch (e) { toast(e.message, "error"); }
}
async function addTip(amount, btn) {
  if (!currentRide || !store.rider) return;
  const tip = Math.round(Number(amount));
  if (!tip || tip <= 0) { toast(t("tip_enter"), "error"); return; }
  setLoading(btn, true);
  try {
    const d = await api(`/api/rides/${currentRide}/tip`, { method: "POST", body: JSON.stringify({ rider_id: store.rider.id, amount: tip }) });
    $("tip-out").textContent = t("tip_saved", { tip: d.tip });
    $("tip-box").classList.add("hidden");
    showTrip();
  } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
async function shareTrip(btn) {
  if (!currentRide) { toast(t("no_active_ride"), "error"); return; }
  try {
    const d = await api(`/api/rides/${currentRide}/share`);
    $("share-out").textContent = d.text;
    try { await navigator.clipboard.writeText(d.text); $("share-out").textContent += " — " + t("share_copied"); } catch {}
  } catch (e) { toast(e.message, "error"); }
}
async function sosTrip(btn) {
  if (!currentRide) { toast(t("no_active_ride"), "error"); return; }
  setLoading(btn, true);
  try {
    const d = await api(`/api/rides/${currentRide}/sos`, { method: "POST", body: JSON.stringify({ user_id: store.rider ? store.rider.id : 0, message: "SOS from rider app" }) });
    toast(d.message || t("sos_sent"), "ok");
  } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
async function cancelRide(btn) {
  if (!currentRide) return;
  setLoading(btn, true);
  try { await api(`/api/rides/${currentRide}/cancel`, { method: "POST", body: "{}" }); toast(t("ride_cancelled"), "ok"); showTrip(); } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}

// ---------- Rides (history + receipts) ----------
async function loadHistory() {
  if (!store.rider) return;
  try {
    const d = await api(`/api/rides?rider_id=${store.rider.id}`);
    $("history-list").innerHTML = d.rides.length ? d.rides.map((r) => `
      <div class="ride-row"><b>Ride #${r.id}</b> — ${escapeHtml(r.pickup)} → ${escapeHtml(r.destination)} • ${vehLabel(r.vehicle_type)} • ${r.distance_km} km<br>
      ${t("fare")} ${fmtRs(r.agreed_fare || r.suggested_fare)}${tipLine(r.tip_amount)} • ${t("status")}: ${escapeHtml(r.status)}${r.commission_charged ? ` • ${t("platform_fee", { fee: r.commission_charged })}` : ""}<br>
      ${r.scheduled_for ? `🕐 ${t("scheduled")}: ${escapeHtml(fmtSched(r.scheduled_for))}<br>` : ""}
      <span class="muted">${new Date(r.created_at).toLocaleString()}</span></div>`).join("") : `<p class="muted empty">${t("no_rides")}</p>`;
  } catch (e) { $("history-list").innerHTML = `<p class="form-err">${escapeHtml(e.message)}</p>`; }
}
async function loadRecentDestinations() {
  if (!store.rider) return;
  try {
    const d = await api(`/api/rides?rider_id=${store.rider.id}`);
    const seen = new Set(), dests = [];
    (d.rides || []).forEach((r) => { if (r.destination && !seen.has(r.destination)) { seen.add(r.destination); dests.push(r.destination); } });
    const box = $("recent-box");
    if (!dests.length) { box.innerHTML = `<p class="muted">${t("no_recent")}</p>`; return; }
    box.innerHTML = dests.slice(0, 6).map((x) => `<button class="chip-btn" data-dest="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join("");
    $$("[data-dest]", box).forEach((b) => b.addEventListener("click", () => { $("destination").value = b.dataset.dest; onRouteChange(); }));
  } catch {}
}

// ---------- Wallet (GET /api/wallet/me) ----------
async function loadRiderWallet() {
  if (!store.rider) return;
  $("rider-wallet").innerHTML = `<p class="muted">${t("loading")}</p>`;
  try {
    const d = await api("/api/wallet/me");
    const tx = d.transactions || [];
    $("rider-wallet").innerHTML = `<p class="wallet-balance">${t("balance")}: <b>${fmtRs(d.balance)}</b></p>` +
      (tx.length ? tx.map((x) => `<div class="tx-row">${escapeHtml(x.type || "")} — ${fmtRs(x.amount)} • ${escapeHtml(x.method || "")} ${escapeHtml(x.tid || "")} • ${escapeHtml(x.note || "")}<br><span class="muted">${new Date(x.created_at).toLocaleString()}</span></div>`).join("") : `<p class="muted empty">${t("no_tx")}</p>`);
  } catch (e) {
    $("rider-wallet").innerHTML = `<p class="form-err">${t("wallet_unavailable")}</p><button class="secondary" id="wallet-retry">${t("retry")}</button>`;
    $("wallet-retry").addEventListener("click", loadRiderWallet);
  }
}

// ---------- Profile ----------
function renderProfile() {
  if (!store.rider) return;
  const u = store.rider;
  $("profile-info").innerHTML = `<p><b>${escapeHtml(u.name)}</b><br>${escapeHtml(u.phone)} • ${t("your_id")} #${u.id}<br>${t("rating")}: ${ratingText(u.rating, u.rating_count, "rider")}</p>`;
  $("support-info").innerHTML = `<p>${t("police")}: <a href="tel:15"><strong>15</strong></a> &nbsp;•&nbsp; ${t("rescue")}: <a href="tel:1122"><strong>1122</strong></a>${settings.support_phone ? `<br>${t("support_owner")}: <a href="tel:${escapeHtml(settings.support_phone)}">${escapeHtml(settings.support_phone)}</a>` : ""}</p>`;
}

// ---------- Boot ----------
async function loadSettings() {
  try {
    const d = await api("/api/settings");
    settings = { ...settings, ...d.settings };
  } catch {}
  renderVehicles();
}
async function boot() {
  initLangToggle();
  applyI18n();
  await loadSettings();
  await initMap();
  $("destination").addEventListener("change", onRouteChange);
  $("pickup").addEventListener("change", () => { if ($("pickup").value !== "__gps__") { gpsPos = null; gpsDistanceKm = null; const p = placeByName($("pickup").value); if (p) setPin("pickup", p); } onRouteChange(); });
  // Session restore: rider stays, driver is redirected, guest sees the login card.
  try {
    const d = await api("/api/auth/me");
    if (d.user) {
      if (d.user.role === "driver") { location.href = "/driver"; return; }
      store.rider = d.user;
      $("rider-name").value = d.user.name; $("rider-phone").value = d.user.phone;
      afterLogin();
    }
  } catch {}
  const q = new URLSearchParams(location.search);
  if (q.get("ride")) { currentRide = Number(q.get("ride")); showTrip(); }
}
boot();
