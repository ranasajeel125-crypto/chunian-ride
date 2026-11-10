// Chunian Ride — driver app (driver.html). Driver only; no rider/admin code.
// v2.3: driver accept-driver path, hero request cards with server countdown,
// real pickup distance/ETA, GPS states, 3s chat polling, WebRTC calls,
// navigation (OSRM + external links), complaints, JazzCash/Sadapay picker,
// support contact, push toggle, client-error reporting.
const store = { driver: null };
let settings = { rate_bike_per_km: 15, rate_rickshaw_per_km: 25, rate_car_per_km: 70, rate_ac_car_per_km: 85, min_bike: 50, min_rickshaw: 100, min_car: 150, min_ac_car: 200, jazzcash_number: "03266040350", sadapay_number: "", min_topup: 500, min_withdrawal: 100, support_phone: "", support_whatsapp: "" };
let driverActiveRide = null;
let driverTripMap = null, driverTripMapRideId = null;
let chatTimer = null;
let locWatchId = null, lastLocPost = 0;
let currentScreen = "home";
let places = [];
let topupPicker = null;

// ---------- GPS state (v2.3) ----------
// lastGps: {lat, lng, accuracy (m), updatedAt (ms)} from watchPosition.
let lastGps = null;
let gpsState = "unknown"; // unknown | ok | weak | denied | off | unavailable
function renderGpsState() {
  const banner = $("gps-banner"), detail = $("gps-detail");
  if (!banner) return;
  let html = "", cls = "";
  if (gpsState === "denied") {
    cls = "v23-gps-banner v23-gps-bad";
    html = `<b>${escapeHtml(t("gps_denied_banner"))}</b><br><span class="muted">${escapeHtml(t("gps_settings_hint"))}</span> <button type="button" class="secondary" id="gps-retry">${escapeHtml(t("gps_retry"))}</button>`;
  } else if (gpsState === "off" || gpsState === "unavailable") {
    cls = "v23-gps-banner v23-gps-bad";
    html = `<b>${escapeHtml(t(gpsState === "off" ? "gps_off_banner" : "gps_unavailable"))}</b> <button type="button" class="secondary" id="gps-retry">${escapeHtml(t("gps_retry"))}</button>`;
  } else if (gpsState === "weak" && lastGps) {
    cls = "v23-gps-banner v23-gps-warn";
    html = `<b>${escapeHtml(t("gps_weak_banner"))}</b> <button type="button" class="secondary" id="gps-retry">${escapeHtml(t("gps_retry"))}</button>`;
  } else if (lastGps) {
    cls = "v23-gps-banner v23-gps-ok";
    html = `<span class="v23-chip">${escapeHtml(t("gps_last_update", { time: fmtClockTime(lastGps.updatedAt) }))}</span> <span class="v23-chip">${escapeHtml(t("gps_accuracy", { m: Math.round(lastGps.accuracy || 0) }))}</span>`;
  }
  banner.className = cls;
  banner.innerHTML = html;
  if (detail) detail.textContent = lastGps ? `${lastGps.lat.toFixed(5)}, ${lastGps.lng.toFixed(5)}` : "";
  const retry = $("gps-retry");
  if (retry) retry.addEventListener("click", () => { stopLocationSharing(); startLocationSharing(); });
}
function setGpsState(s) { gpsState = s; renderGpsState(); }

function switchScreen(name) {
  currentScreen = name;
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + name));
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.screen === name));
  if (!store.driver) return;
  if (name === "requests") { loadRequests(); setTimeout(() => { initDriverMap(); if (driverMap) driverMap.invalidateSize(); }, 80); }
  if (name === "wallet") loadWallet();
  if (name === "profile") { renderDriverProfile(); renderDocs(); }
  if (name === "home") { loadDriverRides(); loadEarnings(1); }
  window.scrollTo({ top: 0 });
}
$$(".nav-btn").forEach((b) => b.addEventListener("click", () => switchScreen(b.dataset.screen)));

window.onLangChange = () => {
  if (store.driver) { renderDriver(); renderDriverProfile(); }
  $("topup-amount").placeholder = t("topup_amount_ph", { min: settings.min_topup || 500 });
  if (topupPicker) topupPicker.refresh(settings);
  $("withdraw-amount").placeholder = t("withdraw_amount_ph", { min: settings.min_withdrawal || 100 });
  renderGpsState();
  if (currentScreen === "requests") loadRequests();
  if (currentScreen === "wallet") loadWallet();
  if (currentScreen === "profile") renderDocs();
};

// ---------- Auth ----------
async function driverLogin(btn) {
  const phone = $("driver-phone").value.trim(), password = $("driver-password").value;
  if (!phone || !password) { setErr($("auth-err"), t("err_phone_pw")); return; }
  setLoading(btn, true);
  try {
    const d = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ phone, password }) });
    const prof = await api(`/api/drivers/${d.user.id}`);
    // prof.driver.id is the driver-profile row id, NOT the user id — every
    // driver API route expects the USER id, so keep d.user.id (else all
    // driver calls 403 for any driver whose profile id != user id).
    store.driver = { ...d.user, ...prof.driver, id: d.user.id };
    markClientLoggedIn();
    afterLogin();
    toast(t("welcome_back") + ", " + prof.driver.name, "ok");
  } catch (e) { setErr($("auth-err"), e.message); }
  finally { setLoading(btn, false); }
}
function afterLogin() {
  $("driver-auth").classList.add("hidden");
  $("driver-dash").classList.remove("hidden");
  $("driver-who").textContent = `${store.driver.name} — ${store.driver.vehicle_model} (${store.driver.plate})`;
  renderDriver();
  renderDriverProfile();
  loadDriverRides();
  loadEarnings(1);
}
function renderDriver() {
  const d = store.driver;
  if (!d) return;
  $("driver-info").innerHTML = `<p><b>${escapeHtml(d.name)}</b> — ${t(d.vehicle_type === "ac_car" ? "ac_car" : d.vehicle_type)} • ${escapeHtml(d.vehicle_model)} • ${escapeHtml(d.plate)}<br>${t("status")}: <b>${escapeHtml(d.status)}</b> • ${t("online")}: <b>${d.online ? t("online") : t("offline")}</b> • ${t("rating")}: ${ratingText(d.rating, d.rating_count, "driver")} • ${t("wallet")}: <b>${fmtRs(d.wallet_balance)}</b></p>`;
  $("online-btn").textContent = d.online ? t("go_offline") : t("go_online");
  $("online-btn").classList.toggle("primary", !d.online);
  if (d.online) startLocationSharing(); else stopLocationSharing();
}

// ---------- Online / GPS sharing (only while online) ----------
function setLocStatus(txt) { const el = $("loc-status"); if (el) el.textContent = txt; }
function startLocationSharing() {
  if (!("geolocation" in navigator)) { setGpsState("unavailable"); setLocStatus(t("gps_unavailable")); return; }
  if (locWatchId !== null) return;
  setLocStatus(t("loc_sharing"));
  locWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, updatedAt: Date.now() };
      // Weak signal: accuracy worse than ~50 m.
      setGpsState(lastGps.accuracy != null && lastGps.accuracy > 50 ? "weak" : "ok");
      setLocStatus(t("loc_sharing_on"));
      updateDriverMapPosition();
      const nowMs = Date.now();
      if (nowMs - lastLocPost < 10000) return;
      lastLocPost = nowMs;
      postDriverLocation(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      if (err.code === 1) { setGpsState("denied"); setLocStatus(t("gps_denied")); }
      else { setGpsState("off"); setLocStatus(t("gps_unavailable")); }
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}
function stopLocationSharing() {
  if (locWatchId !== null) { navigator.geolocation.clearWatch(locWatchId); locWatchId = null; }
  setLocStatus("");
}
async function postDriverLocation(lat, lng) {
  if (!store.driver) return;
  try { await api(`/api/drivers/${store.driver.id}/location`, { method: "POST", body: JSON.stringify({ lat, lng }) }); } catch {}
}
async function toggleOnline(btn) {
  if (!store.driver) return;
  setLoading(btn, true);
  try {
    const d = await api(`/api/drivers/${store.driver.id}/online`, { method: "POST", body: JSON.stringify({ online: !store.driver.online }) });
    store.driver.online = d.online ? 1 : 0;
    renderDriver();
    toast(store.driver.online ? t("go_online") + " ✓" : t("go_offline"), "ok");
  } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}

// ---------- Places (for map pins + navigation coords) ----------
async function loadPlaces() {
  if (places.length) return places;
  try {
    const d = await api("/api/places");
    places = d.places || [];
  } catch {}
  return places;
}
function placeByName(name) { return places.find((p) => p.name === name) || null; }
function ridePickupCoords(r) {
  if (r.pickup_lat != null && r.pickup_lng != null) return { lat: Number(r.pickup_lat), lng: Number(r.pickup_lng) };
  const p = placeByName(r.pickup);
  return p ? { lat: p.lat, lng: p.lng } : null;
}
function rideDestCoords(r) {
  if (r.destination_lat != null && r.destination_lng != null) return { lat: Number(r.destination_lat), lng: Number(r.destination_lng) };
  const p = placeByName(r.destination);
  return p ? { lat: p.lat, lng: p.lng } : null;
}

// ---------- Driver map (Leaflet/OSM, requests screen) ----------
let driverMap = null, reqPinLayer = null, driverPosMarker = null, routeLayer = null;
function initDriverMap() {
  if (driverMap || typeof L === "undefined") return;
  const el = $("driver-map");
  if (!el) return;
  try {
    driverMap = initBaseMap("driver-map");
    reqPinLayer = L.layerGroup().addTo(driverMap);
    routeLayer = L.layerGroup().addTo(driverMap);
    updateDriverMapPosition();
  } catch { driverMap = null; }
}
function updateDriverMapPosition() {
  if (!lastGps) return;
  if (driverMap && typeof L !== "undefined") {
    if (driverPosMarker) driverPosMarker.setLatLng([lastGps.lat, lastGps.lng]);
    else driverPosMarker = L.circleMarker([lastGps.lat, lastGps.lng], { radius: 8, color: "#0b5ed7", weight: 2, fillColor: "#2f7fe0", fillOpacity: 0.9 }).addTo(driverMap).bindPopup(t("current_location"));
  }
  // v2.7: the active-ride map moves with the same GPS fix.
  if (driverTripMap) driverTripMap.setDriver(lastGps.lat, lastGps.lng);
}
function drawRequestPins(requests) {
  if (!driverMap || !reqPinLayer || typeof L === "undefined") return;
  reqPinLayer.clearLayers();
  const bounds = [];
  if (lastGps) bounds.push([lastGps.lat, lastGps.lng]);
  requests.forEach((r) => {
    const c = ridePickupCoords(r);
    if (!c) return;
    const m = L.marker([c.lat, c.lng]).addTo(reqPinLayer)
      .bindPopup(`<b>Ride #${r.id}</b><br>${escapeHtml(r.pickup)} → ${escapeHtml(r.destination)}<br>${fmtRs(r.proposed_fare)}`);
    m.on("click", () => { selectedRequestId = r.id; renderRequestCards(); });
    bounds.push([c.lat, c.lng]);
  });
  if (bounds.length > 1) { try { driverMap.fitBounds(bounds, { padding: [30, 30] }); } catch {} }
}
// Draw a route on the driver map: OSRM road route when available, else a
// dashed straight line labelled as direct/estimated — never as road distance.
async function drawDriverRoute(from, to, infoEl) {
  if (!driverMap || !routeLayer || typeof L === "undefined") return;
  routeLayer.clearLayers();
  const route = await fetchOsrmRoute(from, to);
  if (route) {
    L.polyline(route.coords, { color: "#0b5ed7", weight: 4 }).addTo(routeLayer);
    if (infoEl) infoEl.textContent = `${t("nav_route_road")}: ${route.distanceKm} km • ~${route.durationMin} min`;
  } else {
    L.polyline([[from.lat, from.lng], [to.lat, to.lng]], { color: "#888", weight: 3, dashArray: "6 6" }).addTo(routeLayer);
    if (infoEl) infoEl.textContent = `${t("nav_route_direct")} — ${t("nav_osrm_failed")}`;
  }
  try { driverMap.fitBounds([[from.lat, from.lng], [to.lat, to.lng]], { padding: [40, 40] }); } catch {}
}
async function navigateTo(rideId, target) {
  await loadPlaces();
  const r = (lastRequests || []).find((x) => x.id === rideId) || (driverActiveRide && driverActiveRide.id === rideId ? driverActiveRide : null);
  if (!r) return;
  const dest = target === "pickup" ? ridePickupCoords(r) : rideDestCoords(r);
  if (!dest) { toast(t("gps_unavailable"), "error"); return; }
  const from = lastGps ? { lat: lastGps.lat, lng: lastGps.lng } : ridePickupCoords(r);
  switchScreen("requests");
  setTimeout(async () => {
    initDriverMap();
    if (driverMap) driverMap.invalidateSize();
    if (from) await drawDriverRoute(from, dest, $("driver-route-info"));
  }, 120);
}

// ---------- Requests (v2.3 hero cards) ----------
let lastRequests = [];
let reqOffers = {}; // rideId -> {offerId, expires_at, fare} (my pending offer)
let reqServer = { serverMs: 0, fetchedAt: 0 };
let reqCountdownTimer = null;
let selectedRequestId = null;

async function loadRequests() {
  if (!store.driver) return;
  try {
    await loadPlaces();
    const d = await api(`/api/drivers/${store.driver.id}/requests`);
    reqServer = { serverMs: d.server_time_ms || Date.now(), fetchedAt: Date.now() };
    let reqs = d.requests || [];
    // My pending offer per ride (carries expires_at + offer id): the
    // requests list itself has no offer fields, so read ride detail.
    const details = await Promise.all(reqs.map((r) =>
      api(`/api/rides/${r.id}`).then((rd) => ({ rideId: r.id, offers: rd.offers || [], serverMs: rd.server_time_ms || reqServer.serverMs })).catch(() => null)
    ));
    reqOffers = {};
    details.forEach((det) => {
      if (!det) return;
      const mine = det.offers.find((o) => o.driver_id === store.driver.id && o.status === "pending");
      if (mine) reqOffers[det.rideId] = { offerId: mine.id, expires_at: mine.expires_at, fare: mine.fare };
    });
    // Sort: pickup distance ascending (nulls last), then expiry ascending.
    reqs = reqs.slice().sort((a, b) => {
      const da = a.pickup_distance_km, db = b.pickup_distance_km;
      if (da == null && db == null) return (reqOffers[a.id]?.expires_at || Infinity) - (reqOffers[b.id]?.expires_at || Infinity);
      if (da == null) return 1;
      if (db == null) return -1;
      if (da !== db) return da - db;
      return (reqOffers[a.id]?.expires_at || Infinity) - (reqOffers[b.id]?.expires_at || Infinity);
    });
    lastRequests = reqs;
    if (!selectedRequestId || !reqs.some((r) => r.id === selectedRequestId)) selectedRequestId = reqs.length ? reqs[0].id : null;
    renderRequestCards();
    drawRequestPins(reqs);
    startReqCountdown();
  } catch (e) { $("requests-list").innerHTML = `<p class="form-err">${escapeHtml(e.message)}</p>`; }
}
function offerRemainingMs(rideId) {
  const o = reqOffers[rideId];
  if (!o || o.expires_at == null) return null;
  return serverRemainingMs(o.expires_at, reqServer.serverMs, reqServer.fetchedAt);
}
function startReqCountdown() {
  if (reqCountdownTimer) return;
  reqCountdownTimer = setInterval(() => {
    $$("[data-countdown]").forEach((el) => {
      const rideId = Number(el.dataset.countdown);
      const rem = offerRemainingMs(rideId);
      if (rem == null) { el.textContent = ""; return; }
      if (rem <= 0) {
        el.textContent = t("countdown_expired");
        el.classList.add("v23-expired");
        const acc = document.querySelector(`[data-accept="${rideId}"]`);
        if (acc) { acc.disabled = true; acc.classList.add("v23-disabled"); }
      } else {
        el.textContent = fmtCountdown(rem);
        el.classList.remove("v23-expired");
      }
    });
  }, 1000);
}
function requestCardHtml(r, hero) {
  const o = reqOffers[r.id];
  const rem = offerRemainingMs(r.id);
  const expired = o && rem != null && rem <= 0;
  const distLine = r.pickup_distance_km != null
    ? `${escapeHtml(t("pickup_dist", { km: r.pickup_distance_km }))} • ${escapeHtml(t("pickup_eta", { min: r.pickup_eta_min }))}${r.pickup_distance_estimated ? ` <span class="v23-badge-est">${escapeHtml(t("estimated_badge"))}</span>` : ""}`
    : "";
  const tripDur = r.distance_km != null ? Math.max(1, Math.round((r.distance_km / 30) * 60)) : null;
  const quick = [10, 15, 20].map((pct) => {
    const amt = Math.round((r.proposed_fare * (100 + pct)) / 100);
    return `<button type="button" class="quick-btn" data-counter-chip="${r.id}" data-amt="${amt}">+${pct}% · ${fmtRs(amt)}</button>`;
  }).join("");
  const counterSheet = `
    <div class="v23-counter-sheet hidden" id="counter-sheet-${r.id}">
      <div class="quick-row">${quick}</div>
      <div class="chat-input-row">
        <input id="counter-${r.id}" type="number" min="1" placeholder="${escapeHtml(t("counter_ph"))}">
        <button type="button" data-counter-send="${r.id}">${escapeHtml(t("btn_counter"))}</button>
      </div>
    </div>`;
  return `
  <div class="v23-req-card${hero ? " v23-hero" : ""}" data-ride="${r.id}">
    <div class="v23-req-head"><b>${escapeHtml(t("new_request"))}</b> <span class="v23-countdown" data-countdown="${r.id}">${o ? fmtCountdown(Math.max(0, rem || 0)) : ""}</span></div>
    <p>📍 <b>${escapeHtml(r.pickup)}</b>${distLine ? ` — ${distLine}` : ""}<br>
    🏁 <b>${escapeHtml(r.destination)}</b>${r.distance_km != null ? ` — ${escapeHtml(t("trip_duration", { km: r.distance_km, min: tripDur }))}` : ""}</p>
    ${r.scheduled_for ? `<span class="sched-badge">🕐 ${escapeHtml(t("scheduled"))}: ${escapeHtml(fmtSched(r.scheduled_for))}</span><br>` : ""}
    <p>${escapeHtml(t(r.vehicle_type === "ac_car" ? "ac_car" : r.vehicle_type))} • ${escapeHtml(r.rider_name)} ${ratingText(r.rider_rating, r.rider_rating_count, "rider")}<br>
    ${escapeHtml(t("rider_offer"))}: <b>${fmtRs(r.proposed_fare)}</b> (${escapeHtml(t("suggested", { fare: r.suggested_fare }))})</p>
    ${!o && !expired ? `<p class="muted">${escapeHtml(t("no_my_offer"))}</p>` : ""}
    ${expired ? `<p class="v23-expired">${escapeHtml(t("countdown_expired"))}</p>` : ""}
    <div class="row v23-req-actions">
      <button type="button" class="primary" data-accept="${r.id}" ${!o || expired ? "disabled" : ""}>${escapeHtml(t("accept_offer"))}</button>
      <button type="button" data-counter-toggle="${r.id}">${escapeHtml(t("btn_counter"))}</button>
      <button type="button" data-decline="${r.id}">${escapeHtml(t("decline"))}</button>
    </div>
    ${counterSheet}
    <p class="v23-nav-links">
      <button type="button" data-nav-pickup="${r.id}">${escapeHtml(t("nav_pickup"))}</button>
      <button type="button" data-nav-dest="${r.id}">${escapeHtml(t("nav_dest"))}</button>
    </p>
  </div>`;
}
function renderRequestCards() {
  const list = $("requests-list");
  if (!list) return;
  if (!lastRequests.length) {
    list.innerHTML = `<p class="muted empty">${escapeHtml(t("no_requests"))}</p>`;
    return;
  }
  const hero = lastRequests.find((r) => r.id === selectedRequestId) || lastRequests[0];
  const rest = lastRequests.filter((r) => r.id !== hero.id);
  list.innerHTML = requestCardHtml(hero, true)
    + (rest.length ? `<p class="muted">${escapeHtml(t("more_requests", { n: rest.length }))}</p>` + rest.map((r) => requestCardHtml(r, false)).join("") : "");
  wireRequestCards(list);
}
function wireRequestCards(root) {
  $$("[data-accept]", root).forEach((b) => b.addEventListener("click", () => driverAccept(Number(b.dataset.accept), b)));
  $$("[data-counter-send]", root).forEach((b) => b.addEventListener("click", () => driverCounter(Number(b.dataset.counterSend), b)));
  $$("[data-decline]", root).forEach((b) => b.addEventListener("click", () => driverDecline(Number(b.dataset.decline), b)));
  $$("[data-counter-toggle]", root).forEach((b) => b.addEventListener("click", () => {
    const sheet = $("counter-sheet-" + b.dataset.counterToggle);
    if (sheet) sheet.classList.toggle("hidden");
  }));
  $$("[data-counter-chip]", root).forEach((b) => b.addEventListener("click", () => setCounter(Number(b.dataset.counterChip), Number(b.dataset.amt))));
  $$("[data-nav-pickup]", root).forEach((b) => b.addEventListener("click", () => navigateTo(Number(b.dataset.navPickup), "pickup")));
  $$("[data-nav-dest]", root).forEach((b) => b.addEventListener("click", () => navigateTo(Number(b.dataset.navDest), "destination")));
  $$(".v23-req-card:not(.v23-hero)", root).forEach((card) => card.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input")) return;
    selectedRequestId = Number(card.dataset.ride);
    renderRequestCards();
  }));
}
function setCounter(rideId, amount) {
  const el = $("counter-" + rideId);
  if (el) { el.value = amount; el.focus(); }
}
async function driverAccept(rideId, btn) {
  setLoading(btn, true);
  try {
    // v2.3 P0: driver accept path — the old /accept is rider-only (403).
    let offerId = reqOffers[rideId] ? reqOffers[rideId].offerId : null;
    if (!offerId) {
      const d = await api(`/api/rides/${rideId}`);
      const mine = d.offers.find((o) => o.driver_id === store.driver.id && o.status === "pending");
      if (!mine) { toast(t("no_pending_offer"), "error"); return; }
      offerId = mine.id;
    }
    const r = await api(`/api/rides/${rideId}/offers/${offerId}/accept-driver`, { method: "POST", body: "{}" });
    toast(t("ride_accepted_driver", { fare: r.agreed_fare }), "ok");
    loadDriverRides();
    loadRequests();
  } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
async function driverCounter(rideId, btn) {
  const fare = Number($("counter-" + rideId).value);
  if (!fare) { toast(t("counter_enter"), "error"); return; }
  setLoading(btn, true);
  try { await api(`/api/rides/${rideId}/counter`, { method: "POST", body: JSON.stringify({ driver_id: store.driver.id, fare }) }); toast(t("counter_sent"), "ok"); loadRequests(); } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
async function driverDecline(rideId, btn) {
  setLoading(btn, true);
  try { await api(`/api/rides/${rideId}/decline`, { method: "POST", body: JSON.stringify({ driver_id: store.driver.id }) }); toast(t("declined"), "ok"); loadRequests(); } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}

// ---------- Active ride + chat (v2.3: 3s poll, ?after=&limit=50) ----------
let chatLastId = 0;
let callCtl = null;
let callRideId = null;

// ---------- In-app active-ride map (v2.7) ----------
// Pickup + destination pins, OSRM route (drawn once per ride), live driver
// marker from the same watchPosition fix that posts to the server, and the
// rider pin at the pickup point while heading there (destination once the
// trip has started — the rider app does not stream live GPS to the driver).
function ensureDriverTripMap(ride) {
  if (driverTripMap && driverTripMapRideId === ride.id) { driverTripMap.invalidateSize(); return; }
  destroyDriverTripMap();
  const pickup = ridePickupCoords(ride), dest = rideDestCoords(ride);
  driverTripMap = createRideMap("driver-trip-map", {
    pickup: pickup ? { lat: pickup.lat, lng: pickup.lng, label: ride.pickup } : null,
    destination: dest ? { lat: dest.lat, lng: dest.lng, label: ride.destination } : null,
  });
  if (!driverTripMap) return;
  driverTripMapRideId = ride.id;
  setTimeout(() => { if (driverTripMap) driverTripMap.invalidateSize(); }, 80);
  if (pickup && dest) driverTripMap.drawRoute(pickup, dest, $("driver-trip-route-info"));
  if (lastGps) driverTripMap.setDriver(lastGps.lat, lastGps.lng);
  const riderAt = ride.status === "ongoing" ? dest : pickup;
  if (riderAt) driverTripMap.setRider(riderAt.lat, riderAt.lng, t("map_rider"));
}
function destroyDriverTripMap() {
  if (driverTripMap) { try { driverTripMap.destroy(); } catch {} driverTripMap = null; }
  driverTripMapRideId = null;
}

async function loadDriverRides() {
  if (!store.driver) return;
  try {
    await loadPlaces();
    const d = await api(`/api/rides?driver_id=${store.driver.id}`);
    const active = d.rides.find((r) => r.status === "accepted" || r.status === "ongoing");
    const prevActive = driverActiveRide ? driverActiveRide.id : null;
    driverActiveRide = active || null;
    const card = $("driver-chat-card");
    if (active) {
      card.classList.remove("hidden");
      ensureDriverTripMap(active);
      $("driver-chat-who").textContent = `Ride #${active.id} — ${active.pickup} → ${active.destination} • ${active.rider_name || ""} • ${t("agreed_fare_label")}: ${fmtRs(active.agreed_fare || active.suggested_fare)}`;
      if (prevActive !== active.id) { chatLastId = 0; $("driver-chat-list").innerHTML = ""; }
      loadDriverChat();
      ensureChatTimer();
      ensureCallForRide(active);
    } else {
      destroyDriverTripMap();
      card.classList.add("hidden");
      if (callCtl) { callCtl.reset(); callCtl = null; callRideId = null; updateCallUI("idle"); }
    }
    $("driver-rides").innerHTML = d.rides.length ? d.rides.map((r) => `
      <div class="ride-row"><b>Ride #${r.id}</b> — ${escapeHtml(r.pickup)} → ${escapeHtml(r.destination)} • ${fmtRs(r.agreed_fare || r.suggested_fare)}${tipLine(r.tip_amount)} • ${escapeHtml(r.status)}
      ${r.scheduled_for ? `<br>🕐 ${t("scheduled")}: ${escapeHtml(fmtSched(r.scheduled_for))}` : ""}
      ${r.status === "accepted" ? ` <button data-start="${r.id}">${t("start_trip")}</button>` : ""}
      ${r.status === "ongoing" ? ` <label><input type="checkbox" id="cash-${r.id}" style="width:auto"> ${t("cash_received")}</label> <button data-complete="${r.id}">${t("end_trip")}</button>` : ""}
      ${r.status === "completed" ? ` <button data-rate-rider="${r.id}">${t("rate_rider_5")}</button>` : ""}
      ${(r.status === "accepted" || r.status === "ongoing") ? ` <button data-nav-pickup-ride="${r.id}">${t("nav_pickup")}</button> <button data-nav-dest-ride="${r.id}">${t("nav_dest")}</button>` : ""}
      </div>`).join("") : `<p class="muted empty">${t("no_rides")}</p>`;
    $$("[data-start]").forEach((b) => b.addEventListener("click", () => startRide(Number(b.dataset.start), b)));
    $$("[data-complete]").forEach((b) => b.addEventListener("click", () => completeRide(Number(b.dataset.complete), b)));
    $$("[data-rate-rider]").forEach((b) => b.addEventListener("click", () => rateRider(Number(b.dataset.rateRider), b)));
    $$("[data-nav-pickup-ride]").forEach((b) => b.addEventListener("click", () => navigateTo(Number(b.dataset.navPickupRide), "pickup")));
    $$("[data-nav-dest-ride]").forEach((b) => b.addEventListener("click", () => navigateTo(Number(b.dataset.navDestRide), "destination")));
  } catch (e) { toast(e.message, "error"); }
}
async function startRide(id, btn) {
  setLoading(btn, true);
  try { await api(`/api/rides/${id}/start`, { method: "POST", body: "{}" }); toast(t("trip_started"), "ok"); loadDriverRides(); } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
async function completeRide(id, btn) {
  const cash = $("cash-" + id) && $("cash-" + id).checked;
  if (!cash) { toast(t("cash_tick_first"), "error"); return; }
  setLoading(btn, true);
  try {
    const d = await api(`/api/rides/${id}/complete`, { method: "POST", body: JSON.stringify({ cash_received: true }) });
    toast(t("trip_completed", { fare: d.fare, fee: d.platform_take, pct: d.commission_pct, booking: d.booking_fee, kept: d.driver_kept, balance: d.driver_wallet_balance }), "ok");
    store.driver.wallet_balance = d.driver_wallet_balance;
    renderDriver(); loadDriverRides();
  } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
async function rateRider(id, btn) {
  setLoading(btn, true);
  try { await api(`/api/rides/${id}/rate`, { method: "POST", body: JSON.stringify({ by: "driver", stars: 5 }) }); toast(t("rider_rated"), "ok"); } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
function ensureChatTimer() {
  if (chatTimer) return;
  chatTimer = setInterval(() => {
    if (driverActiveRide && !$("driver-chat-card").classList.contains("hidden")) loadDriverChat();
  }, 3000);
}
function appendDriverChat(msgs) {
  const el = $("driver-chat-list");
  if (!el) return;
  if (!msgs.length) return;
  if (chatLastId === 0 && el.dataset.empty !== "1") el.innerHTML = "";
  msgs.forEach((m) => {
    const div = document.createElement("div");
    div.className = "chat-msg " + (m.sender_role === "driver" ? "mine" : "theirs");
    div.innerHTML = `<span>${escapeHtml(m.message)}</span><small>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>`;
    el.appendChild(div);
    chatLastId = Math.max(chatLastId, m.id);
  });
  el.scrollTop = el.scrollHeight;
}
async function loadDriverChat() {
  if (!driverActiveRide || !store.driver) return;
  try {
    const d = await api(`/api/rides/${driverActiveRide.id}/messages?after=${chatLastId}&limit=50`);
    if (chatLastId === 0 && !(d.messages || []).length) {
      $("driver-chat-list").innerHTML = `<p class="muted">${escapeHtml(t("chat_empty"))}</p>`;
      $("driver-chat-list").dataset.empty = "1";
    } else {
      $("driver-chat-list").dataset.empty = "";
      appendDriverChat(d.messages || []);
    }
    const badge = $("driver-chat-unread");
    if (badge) {
      const n = d.unread_count || 0;
      badge.textContent = t("chat_unread", { n });
      badge.style.display = n ? "" : "none";
      if (n) setTimeout(() => { badge.style.display = "none"; }, 6000);
    }
  } catch {}
}
async function sendDriverChat(btn) {
  const input = $("driver-chat-input");
  const text = input.value.trim();
  if (!text || !driverActiveRide || !store.driver) return;
  setLoading(btn, true);
  try {
    await api(`/api/rides/${driverActiveRide.id}/messages`, { method: "POST", body: JSON.stringify({ sender_id: store.driver.id, sender_role: "driver", message: text }) });
    input.value = "";
    loadDriverChat();
  } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}

// ---------- In-app voice call (driver side) ----------
function ensureCallForRide(ride) {
  if (!ride || (ride.status !== "accepted" && ride.status !== "ongoing")) return;
  if (callCtl && callRideId === ride.id) { callCtl.startPolling(); return; }
  if (callCtl) callCtl.reset();
  callRideId = ride.id;
  callCtl = createRideCall({
    rideId: ride.id, myRole: "driver", myUserId: store.driver.id,
    mount: $("driver-call-box"), onState: updateCallUI,
  });
  callCtl.startPolling();
  updateCallUI("idle");
}
function updateCallUI(state) {
  const box = $("driver-call-box");
  if (!box) return;
  box.classList.remove("hidden");
  const st = $("driver-call-status");
  const btnCall = $("btn-driver-call"), btnAcc = $("btn-driver-call-accept"), btnRej = $("btn-driver-call-reject"),
    btnMute = $("btn-driver-call-mute"), btnEnd = $("btn-driver-call-end");
  const show = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
  if (st) {
    st.textContent = state === "calling" ? t("call_connecting") : state === "incoming" ? t("call_incoming")
      : state === "in-call" ? t("call_in_call") : state === "no-answer" ? t("call_no_answer")
      : state === "ended" ? t("call_ended") : state === "failed" ? t("call_failed") : "";
  }
  show(btnCall, state === "idle" || state === "ended" || state === "no-answer" || state === "failed");
  show(btnAcc, state === "incoming");
  show(btnRej, state === "incoming");
  show(btnMute, state === "in-call" || state === "calling");
  show(btnEnd, state === "in-call" || state === "calling" || state === "incoming");
  if (btnMute) btnMute.textContent = callCtl && callCtl.isMuted() ? t("call_unmute") : t("call_mute");
  if ((state === "no-answer" || state === "ended" || state === "failed") && callCtl) {
    setTimeout(() => { if (callCtl && callCtl.getState() === state) updateCallUI("idle"); }, 4000);
  }
}

// ---------- Complaint (driver side, active ride) ----------
async function sendDriverComplaint(btn) {
  const input = $("driver-complaint-text");
  const text = input.value.trim();
  if (!text || !driverActiveRide) { setErr($("driver-complaint-out"), t("complaint_enter")); return; }
  setLoading(btn, true);
  try {
    await postComplaint(driverActiveRide.id, text);
    input.value = "";
    setErr($("driver-complaint-out"), t("complaint_sent"));
    toast(t("complaint_sent"), "ok");
  } catch (e) { setErr($("driver-complaint-out"), e.message); toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}

// ---------- Wallet + top-up (JazzCash / Sadapay picker) ----------
function updateTopupButton(method, num, blocked) {
  const btn = $("btn-topup");
  if (!btn) return;
  const tid = $("topup-tid");
  if (tid) tid.placeholder = t(method === "Sadapay" ? "topup_tid_ph_sadapay" : "topup_tid_ph");
  if (blocked) {
    btn.textContent = t("sadapay_not_set");
    btn.disabled = true;
  } else {
    btn.disabled = false;
    btn.textContent = num ? t("btn_topup_method", { method: t(method === "Sadapay" ? "method_sadapay" : "method_jazzcash"), num }) : t("btn_topup", { num: settings.jazzcash_number || "03266040350" });
  }
}
async function loadWallet() {
  if (!store.driver) return;
  try {
    const d = await api(`/api/drivers/${store.driver.id}/wallet`);
    $("wallet-info").innerHTML = `<p class="wallet-balance">${t("balance")}: <b>${fmtRs(d.wallet_balance)}</b></p>` + d.transactions.slice(0, 8).map((x) => `<div class="tx-row">${escapeHtml(x.type)} — ${fmtRs(x.amount)} • ${escapeHtml(x.method || "")} ${escapeHtml(x.tid || "")} • ${escapeHtml(x.note || "")}<br><span class="muted">${new Date(x.created_at).toLocaleString()}</span></div>`).join("");
    const reqs = [...(d.pending_topups || []), ...(d.past_topups || [])];
    $("topup-requests").innerHTML = reqs.length ? `<h4>${t("topup_history")}</h4>` + reqs.map((x) => `<div class="tx-row">${fmtRs(x.amount)} • ${escapeHtml(x.method)} • TID ${escapeHtml(x.tid || "—")} • ${t("status")}: <b>${escapeHtml(x.status)}</b>${x.reject_reason ? ` • ${escapeHtml(x.reject_reason)}` : ""}<br><span class="muted">${new Date(x.created_at).toLocaleString()}</span></div>`).join("") : "";
  } catch (e) { $("wallet-info").innerHTML = `<p class="form-err">${escapeHtml(e.message)}</p>`; }
  loadWithdrawals();
}
async function topup(btn) {
  const amount = Number($("topup-amount").value), tid = $("topup-tid").value.trim();
  if (!amount) { setErr($("topup-err"), t("topup_enter_amount")); return; }
  const method = topupPicker ? topupPicker.getMethod() : "JazzCash";
  if (topupPicker && topupPicker.isBlocked()) { setErr($("topup-err"), t("sadapay_not_set")); return; }
  setLoading(btn, true);
  try {
    const d = await api(`/api/drivers/${store.driver.id}/topup`, { method: "POST", body: JSON.stringify({ amount, method, tid }) });
    toast(t("topup_sent", { id: d.request_id, amount: d.amount }), "ok");
    $("topup-amount").value = ""; $("topup-tid").value = "";
    loadWallet();
  } catch (e) { setErr($("topup-err"), e.message); }
  finally { setLoading(btn, false); }
}

// ---------- Withdrawals (v2.1) ----------
async function loadWithdrawals() {
  if (!store.driver) return;
  try {
    const d = await api("/api/drivers/me/withdrawals");
    const list = d.withdrawals || [];
    $("withdraw-requests").innerHTML = list.length ? `<h4>${t("withdraw_history")}</h4>` + list.map((x) => `<div class="tx-row">${fmtRs(x.amount)} → ${escapeHtml(x.jazzcash_number)} • ${t("status")}: <b>${escapeHtml(x.status)}</b>${x.reason ? ` • ${escapeHtml(x.reason)}` : ""}<br><span class="muted">${new Date(x.created_at).toLocaleString()}</span></div>`).join("") : "";
  } catch {}
}
async function withdraw(btn) {
  const amount = Number($("withdraw-amount").value);
  const jazz = $("withdraw-jazzcash").value.trim();
  if (!amount) { setErr($("withdraw-err"), t("withdraw_enter_amount")); return; }
  const min = Number(settings.min_withdrawal || 100);
  if (amount < min) { setErr($("withdraw-err"), t("withdraw_min", { min })); return; }
  if (!jazz) { setErr($("withdraw-err"), t("withdraw_enter_number")); return; }
  setLoading(btn, true);
  try {
    const d = await api("/api/drivers/me/withdraw", { method: "POST", body: JSON.stringify({ amount, jazzcash_number: jazz }) });
    toast(t("withdraw_sent", { id: d.request_id, amount: d.amount }), "ok");
    $("withdraw-amount").value = ""; $("withdraw-jazzcash").value = "";
    loadWithdrawals(); loadWallet();
  } catch (e) { setErr($("withdraw-err"), e.message); toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}

// ---------- Documents — photo upload (v2.1) ----------
async function downscaleImage(file) {
  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    im.src = url;
  });
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.8);
}
function docLabel(dt) {
  return t({ cnic_front: "doc_cnic_front", cnic_back: "doc_cnic_back", cnic: "doc_cnic", licence: "doc_licence", vehicle: "doc_vehicle", other: "doc_other" }[dt] || "doc_licence");
}
async function uploadDoc(docType, file, btn) {
  if (!file) return;
  if (!["image/jpeg", "image/png"].includes(file.type)) { setErr($("docs-err"), t("doc_bad_type")); return; }
  setLoading(btn, true);
  try {
    const dataUrl = await downscaleImage(file);
    if (dataUrl.length > 2100000) { setErr($("docs-err"), t("doc_too_large")); return; }
    const up = await api("/api/drivers/me/documents", { method: "POST", body: JSON.stringify({ doc_type: docType, mime: "image/jpeg", data_url: dataUrl }) });
    // v2.6: the server says whether this upload completed the set and the
    // documents were auto-approved — the toast must say so, not "pending".
    toast(t(up && up.status === "approved" ? "doc_uploaded_auto" : "doc_uploaded", { doc: docLabel(docType) }), "ok");
    renderDocs();
  } catch (e) { setErr($("docs-err"), e.message); toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
async function renderDocs() {
  if (!store.driver) return;
  const box = $("docs-list");
  if (!box) return;
  box.innerHTML = `<p class="muted">${t("loading")}</p>`;
  try {
    const d = await api("/api/drivers/me/documents");
    const byType = {};
    for (const doc of d.documents || []) byType[doc.doc_type] = doc;
    const cl = d.doc_checklist || { cnic: false, licence: false, vehicle: false };
    const checkLine = `<p class="muted"><b>${escapeHtml(t("docs_checklist", { cnic: cl.cnic ? t("docs_checklist_ok") : t("docs_checklist_no"), licence: cl.licence ? t("docs_checklist_ok") : t("docs_checklist_no"), vehicle: cl.vehicle ? t("docs_checklist_ok") : t("docs_checklist_no") }))}</b></p>`;
    box.innerHTML = checkLine + ["cnic_front", "cnic_back", "licence", "vehicle"].map((dt) => {
      const doc = byType[dt];
      const status = doc ? (doc.status === "approved" ? t("doc_approved") : doc.status === "rejected" ? t("doc_rejected") : t("doc_pending")) : t("doc_pending");
      return `<div class="doc-row"><span><b>${docLabel(dt)}</b><br><span class="badge">${status}</span></span>
        <label class="doc-upload-btn">${t("doc_upload")}<input type="file" accept="image/jpeg,image/png" data-doc="${dt}" class="hidden-file"></label></div>`;
    }).join("");
    $$(".hidden-file", box).forEach((input) => input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) uploadDoc(input.dataset.doc, file, input.closest(".doc-upload-btn"));
      input.value = "";
    }));
  } catch (e) { box.innerHTML = `<p class="form-err">${escapeHtml(e.message)}</p>`; }
}
async function loadEarnings(days) {
  if (!store.driver) return;
  try {
    const d = await api(`/api/drivers/${store.driver.id}/earnings?days=${days}`);
    $("earnings-info").innerHTML = `<p>${t("earnings_line", { label: days === 1 ? t("today") : t("days_7"), rides: d.rides, gross: d.gross_fares, fees: d.platform_fees, tips: d.tips || 0, kept: d.driver_kept })}</p>`;
  } catch (e) { $("earnings-info").innerHTML = `<p class="form-err">${escapeHtml(e.message)}</p>`; }
}

// ---------- Profile + registration ----------
// Note: there is no server endpoint to change a user's display name, so the
// profile shows the name (read-only) — no dead edit button is rendered.
function renderDriverProfile() {
  const d = store.driver;
  if (!d) return;
  $("driver-profile-info").innerHTML = `<p><b>${escapeHtml(d.name)}</b> (${escapeHtml(d.phone)}) • ${t("your_id")} #${d.id}<br>${t("vehicle")}: ${t(d.vehicle_type === "ac_car" ? "ac_car" : d.vehicle_type)} • ${escapeHtml(d.vehicle_model)} • ${escapeHtml(d.plate)}<br>${t("rating")}: ${ratingText(d.rating, d.rating_count, "driver")} • ${t("wallet")}: <b>${fmtRs(d.wallet_balance)}</b><br>${t("doc_status")}: <b>${d.documents_status === "approved" ? t("docs_approved") : t("docs_pending")}</b> (${escapeHtml(d.documents_status || "pending")})</p>`;
  renderSupportInfo($("driver-support-info"), settings);
  renderPushToggle($("driver-push-toggle-box"));
}
async function registerDriver(btn) {
  const name = $("reg-name").value.trim(), phone = $("reg-phone").value.trim(), password = $("reg-password").value;
  if (!name || !phone || !password) { setErr($("reg-err"), t("err_reg_fields")); return; }
  setLoading(btn, true);
  try {
    const u = await api("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, phone, password, role: "driver" }) });
    const d = await api("/api/drivers/register", { method: "POST", body: JSON.stringify({ user_id: u.user.id, vehicle_type: $("reg-vehicle").value, vehicle_model: $("reg-model").value, plate: $("reg-plate").value, cnic: $("reg-cnic").value, licence: $("reg-licence").value, vehicle_reg: $("reg-vehreg").value }) });
    setErr($("reg-err"), "");
    $("reg-out").textContent = t("reg_submitted", { status: d.status });
    toast(t("reg_submitted", { status: d.status }), "ok");
  } catch (e) { setErr($("reg-err"), e.message); }
  finally { setLoading(btn, false); }
}

// ---------- Boot ----------
async function boot() {
  initLangToggle();
  initNotifications();
  applyI18n();
  try {
    const d = await api("/api/settings");
    settings = { ...settings, ...d.settings };
    settings.google_login_enabled = !!d.google_login_enabled;
  } catch {}
  initGoogleLogin("driver", settings.google_login_enabled);
  $("topup-amount").placeholder = t("topup_amount_ph", { min: settings.min_topup || 500 });
  topupPicker = initTopupPicker($("topup-method-box"), settings, updateTopupButton);
  $("withdraw-amount").placeholder = t("withdraw_amount_ph", { min: settings.min_withdrawal || 100 });
  renderGpsState();
  // Session restore: driver stays, rider is redirected, guest sees the login card.
  try {
    const d = await api("/api/auth/me");
    if (d.user) {
      markClientLoggedIn();
      if (d.user.role === "rider") { location.href = "/rider"; return; }
      try {
        const prof = await api(`/api/drivers/${d.user.id}`);
        // Keep the USER id: prof.driver.id is the driver-profile row id.
        store.driver = { ...d.user, ...prof.driver, id: d.user.id };
        afterLogin();
      } catch { /* logged-in user without a driver profile: show login + registration */ }
    }
  } catch {}
  // Google sign-in failures land back here with ?google_error= — show it
  // in the login card (setErr uses textContent, so the URL value is safe).
  const q = new URLSearchParams(location.search);
  if (q.get("google_error")) setErr($("auth-err"), q.get("google_error"));
}
boot();
