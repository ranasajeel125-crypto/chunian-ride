// Chunian Ride — rider app (rider.html). Passenger only; no driver/admin code.
// v2.3: GPS pickup coords on booking, offer countdowns from server time,
// 5s live-tracking poll (freshness rule unchanged), 3s chat polling with
// unread badge, WebRTC calls, complaint form, JazzCash/Sadapay picker,
// support contact (phone + WhatsApp), push toggle, client-error reporting.
// v2.4: GPS starts ONLY on a real tap ("Use my location" / "Current
// location (GPS)" choice) — the old silent load-time call burned the
// one-shot permission prompt and poisoned later taps, so the popup never
// appeared. Denial now shows a settings hint + Retry button.
const store = { rider: null };
let places = [];
let settings = { rate_bike_per_km: 15, rate_rickshaw_per_km: 25, rate_car_per_km: 70, rate_ac_car_per_km: 85, min_bike: 50, min_rickshaw: 100, min_car: 150, min_ac_car: 200, jazzcash_number: "03266040350", sadapay_number: "", support_phone: "", support_whatsapp: "" };
let vehicle = "bike";
let currentRide = null;
let fareEstimate = null;
let map, markers = {}, pickupMarker = null, destMarker = null, driverMarker = null, gpsMarker = null;
let gpsPos = null;          // {lat, lng} from the rider's phone GPS
let gpsDistanceKm = null;   // haversine km from GPS pickup to the destination place
let chatTimer = null;
let currentScreen = "home";
let riderTopupPicker = null;
let chatLastId = 0;
let callCtl = null;
let callRideId = null;
let offerServer = { serverMs: 0, fetchedAt: 0 };
let offerCountdownTimer = null;

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
  renderRiderTopupForm();
  if (riderTopupPicker) riderTopupPicker.refresh(settings);
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
  // Pilot lock (v2.2): rides are Chunian City only while pilot mode is ON.
  // Pickup = phone GPS or Chunian City; destination = Chunian City only.
  // The server still enforces this (fare + ride-create return 400 for any
  // intercity place) — this only keeps the UI from offering it.
  const pilotLocked = String(settings.pilot_mode) === "1" || String(settings.pilot_chunian_only) === "1";
  const sel1 = $("pickup"), sel2 = $("destination");
  const gpsOpt = document.createElement("option");
  gpsOpt.value = "__gps__"; gpsOpt.textContent = t("current_location");
  sel1.appendChild(gpsOpt);
  places.forEach((p) => {
    if (pilotLocked && p.name !== "Chunian City") return;
    const o1 = document.createElement("option"); o1.value = p.name; o1.textContent = p.name + (p.km != null ? ` (${p.km} km)` : "");
    const o2 = o1.cloneNode(true);
    sel1.appendChild(o1); sel2.appendChild(o2);
  });
  sel1.value = "__gps__"; sel2.value = pilotLocked ? "Chunian City" : "Pattoki";
  map = initBaseMap("map");
  markers = addPlacePins(map, places, (p) => {
    if (!sel1.dataset.locked) { sel1.value = p.name; sel1.dataset.locked = "1"; gpsPos = null; setPin("pickup", p); }
    else {
      if (pilotLocked && p.name !== "Chunian City") { toast(t("pilot_only_note"), "error"); return; }
      sel2.value = p.name; delete sel1.dataset.locked; setPin("dest", p);
    }
    onRouteChange();
  });
  // v2.4: do NOT auto-request GPS on load. The old silent load-time call
  // fired the platform permission prompt before the rider tapped anything,
  // and a denial there made the browser remember "denied" — later taps
  // then failed instantly with no popup at all. GPS starts only on a real
  // tap ("Use my location" button or the "Current location (GPS)"
  // dropdown choice). Pickup defaults to Chunian City until then.
  sel1.value = "Chunian City";
  onRouteChange();
}
// v2.4: GPS starts ONLY from a real user tap ("Use my location" button
// or the "Current location (GPS)" dropdown choice) — never automatically
// on page load, and never pre-skipped on a permission-state check. A tap
// calls getCurrentPosition directly, which is what makes the platform
// show its permission dialog. Only a genuine failure/denial falls back
// to Chunian City — and a denial says plainly what to do, with a Retry
// button that re-invokes the prompt once the rider has allowed location.
function requestGpsPickup() {
  if (!("geolocation" in navigator)) {
    toast(t("gps_unavailable"), "error");
    fallbackPickup();
    return;
  }
  setErr($("gps-err"), t("gps_waiting"));
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      gpsPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $("pickup").value = "__gps__";
      if (map) {
        if (gpsMarker) map.removeLayer(gpsMarker);
        gpsMarker = L.circleMarker([gpsPos.lat, gpsPos.lng], { radius: 8, color: "#0b5ed7", weight: 2, fillColor: "#2f7fe0", fillOpacity: 0.9 }).addTo(map).bindPopup(t("current_location"));
      }
      setErr($("gps-err"), "");
      toast(t("gps_ok"), "ok");
      computeGpsDistance();
      onRouteChange();
    },
    (err) => {
      if (err.code === 1) {
        // Permission denied: fall back to Chunian City, but do not hide
        // the denial behind the generic fallback text. Show what happened,
        // where to allow location, and a Retry button — after the rider
        // allows it in settings, Retry works; while the origin is still
        // denied the platform will not re-prompt, and the hint says so.
        fallbackPickup();
        showGpsDenied();
        toast(t("gps_denied"), "error");
      } else {
        toast(t("gps_unavailable"), "error");
        fallbackPickup();
      }
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}
function showGpsDenied() {
  const el = $("gps-err");
  if (!el) return;
  el.innerHTML = `<b>${escapeHtml(t("gps_denied"))}</b><br><span class="muted">${escapeHtml(t("gps_settings_hint"))}</span> <button type="button" class="secondary" id="gps-retry">${escapeHtml(t("gps_retry"))}</button>`;
  const retry = $("gps-retry");
  if (retry) retry.addEventListener("click", () => requestGpsPickup());
}
function fallbackPickup() {
  // v2.3: GPS failed — fall back to the place pickup and say so plainly.
  gpsPos = null; gpsDistanceKm = null;
  if (placeByName("Chunian City")) {
    $("pickup").value = "Chunian City";
    setErr($("gps-err"), t("gps_pickup_failed", { place: "Chunian City" }));
  }
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
  const promo = $("promo-code") ? $("promo-code").value.trim() : "";
  if (promo) body.promo_code = promo;
  try {
    const d = await api("/api/fare", { method: "POST", body: JSON.stringify(body) });
    fareEstimate = d;
    renderFareBox();
    $("proposed-fare").value = d.suggested_fare;
    setErr($("fare-err"), "");
  } catch (e) {
    // A bad promo must surface even in auto mode — the rider typed a code.
    if (!auto || promo) { setErr($("fare-err"), e.message); toast(e.message, "error"); }
  }
}
function renderFareBox() {
  const d = fareEstimate;
  if (!d) return;
  $("fare-box").classList.remove("hidden");
  const discountLine = d.discount_amount > 0
    ? `<br>${t("fare_base", { base: d.base_fare })} − ${t("fare_discount", { discount: d.discount_amount })}${d.promo_code ? ` (${escapeHtml(d.promo_code)})` : ""}`
    : "";
  $("fare-box").innerHTML = `${t("fare_estimate")}: <b>${fmtRs(d.suggested_fare)}</b> — ${t("fare_distance", { km: d.distance_km, per_km: d.per_km, min: d.min_fare })}${d.distance_estimated ? " — <i>" + t("fare_estimated_note") + "</i>" : ""}${discountLine}`;
}

// ---------- Auth ----------
async function riderSignup(btn) {
  const name = $("rider-name").value.trim(), phone = $("rider-phone").value.trim(), password = $("rider-password").value;
  if (!name || !phone || !password) { setErr($("auth-err"), t("err_name_phone_pw")); return; }
  setLoading(btn, true);
  try {
    const d = await api("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, phone, password, role: "rider" }) });
    store.rider = d.user;
    markClientLoggedIn();
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
    markClientLoggedIn();
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
  // v2.3: send the rider's GPS pickup point so the driver sees a real
  // pickup distance (contract §2.4). Only when GPS actually fixed.
  if ($("pickup").value === "__gps__" && gpsPos) {
    body.pickup_lat = gpsPos.lat;
    body.pickup_lng = gpsPos.lng;
  }
  const promo = $("promo-code") ? $("promo-code").value.trim() : "";
  if (promo) body.promo_code = promo;
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
    chatLastId = 0;
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
    offerServer = { serverMs: d.server_time_ms || Date.now(), fetchedAt: Date.now() };
    const list = $("offers-list");
    const pending = d.offers.filter((o) => o.status === "pending");
    list.innerHTML = pending.length ? pending.map((o) => {
      const rem = o.expires_at != null ? serverRemainingMs(o.expires_at, offerServer.serverMs, offerServer.fetchedAt) : null;
      return `
      <div class="offer">
        <b>${fmtRs(o.fare)}</b> — ${escapeHtml(o.driver_name)} ${ratingText(o.driver_rating, o.driver_rating_count, "driver")}<br>
        ${escapeHtml(o.vehicle_model)} • ${escapeHtml(o.plate)} • ${t("eta_min", { min: o.eta_min })}
        ${rem != null ? `<br><span class="v23-countdown" data-offer-countdown="${o.expires_at}">${fmtCountdown(Math.max(0, rem))}</span>` : ""}
        <br><button class="primary" data-offer="${o.id}">${t("choose_driver")}</button>
      </div>`;
    }).join("") : `<p class="muted empty">${t("no_offers")}</p>`;
    $$("[data-offer]", list).forEach((b) => b.addEventListener("click", () => acceptOffer(Number(b.dataset.offer), b)));
    startOfferCountdown();
    // Counter-offers arrive as new pending offers: the 5s refresh while
    // the ride is still requested surfaces them (plus the notification
    // feed, polled every 15s by initNotifications).
    if (d.ride.status !== "requested") showTrip();
  } catch (e) { toast(e.message, "error"); }
}
function startOfferCountdown() {
  if (offerCountdownTimer) return;
  offerCountdownTimer = setInterval(() => {
    $$("[data-offer-countdown]").forEach((el) => {
      const rem = serverRemainingMs(Number(el.dataset.offerCountdown), offerServer.serverMs, offerServer.fetchedAt);
      if (rem == null) return;
      if (rem <= 0) { el.textContent = t("countdown_expired"); el.classList.add("v23-expired"); }
      else el.textContent = fmtCountdown(rem);
    });
  }, 1000);
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

// ---------- Live trip (v2.3: 5s poll while active) ----------
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
      // Freshness rule (unchanged): fresh iff updated_at < 180 s old.
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
    const destCoords = placeByName(r.destination);
    $("trip-info").innerHTML = `
      <p><b>Ride #${r.id}</b> — ${escapeHtml(r.pickup)} → ${escapeHtml(r.destination)} (${r.distance_km} km, ${vehLabel(r.vehicle_type)})</p>
      ${schedLine(r.scheduled_for)}
      <p>${t("status")}: <span class="badge st-${r.status}">${escapeHtml(r.status)}</span> • ${t("agreed_fare_label")}: <b>${fmtRs(r.agreed_fare || r.suggested_fare)}</b> (${t("offered", { fare: r.proposed_fare })})${tipLine(r.tip_amount)}</p>
      ${drv ? `<p>${escapeHtml(drv.driver_name)} ${ratingText(drv.driver_rating, drv.driver_rating_count, "driver")} — ${escapeHtml(drv.vehicle_model)}, ${escapeHtml(drv.plate)}, ${t("eta_min", { min: drv.eta_min })}</p>` : ""}
      <p>${t("trip_cash")} ${r.cash_confirmed ? t("cash_confirmed") : ""}</p>
      ${locLine}
      ${destCoords ? `<p class="v23-nav-links"><a target="_blank" rel="noopener" href="${gmapsDirUrl(destCoords.lat, destCoords.lng)}">${escapeHtml(t("nav_external_gmaps"))}</a> · <a target="_blank" rel="noopener" href="${osmDirUrl(destCoords.lat, destCoords.lng)}">${escapeHtml(t("nav_external_osm"))}</a></p>` : ""}
      ${r.status === "completed" ? `<p>${t("trip_done")}</p>` : ""}`;
    if (drv) {
      $("chat-box").classList.remove("hidden");
      loadChat();
      ensureChatTimer();
      ensureCallForRide(r);
    } else {
      $("chat-box").classList.add("hidden");
      if (callCtl) { callCtl.reset(); callCtl = null; callRideId = null; }
      const cb = $("rider-call-box");
      if (cb) cb.classList.add("hidden");
    }
    if (r.status === "completed") {
      $("rate-box").classList.remove("hidden");
      $("rate-stars").innerHTML = [1, 2, 3, 4, 5].map((s) => `<button data-stars="${s}" aria-label="${s} stars">⭐</button>`).join("");
      $$("#rate-stars button").forEach((b) => b.addEventListener("click", () => rateRide(Number(b.dataset.stars))));
      if (!r.tip_amount) { $("tip-box").classList.remove("hidden"); $("tip-out").textContent = ""; }
      else $("tip-box").classList.add("hidden");
    } else { $("tip-box").classList.add("hidden"); $("rate-box").classList.add("hidden"); }
    if (r.status === "requested") setTimeout(loadOffers, 5000);
    if (r.status === "accepted" || r.status === "ongoing") setTimeout(() => showTrip(), 5000);
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

// ---------- In-ride chat (v2.3: 3s poll, ?after=&limit=50, unread badge) ----------
function ensureChatTimer() {
  if (chatTimer) return;
  chatTimer = setInterval(() => {
    if (currentRide && !$("trip-card").classList.contains("hidden") && !$("chat-box").classList.contains("hidden")) loadChat();
  }, 3000);
}
function renderChatList(el, msgs, myRole) {
  if (!el) return;
  el.innerHTML = msgs.length ? msgs.map((m) => `<div class="chat-msg ${m.sender_role === myRole ? "mine" : "theirs"}"><span>${escapeHtml(m.message)}</span><small>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div>`).join("") : `<p class="muted">${t("chat_empty")}</p>`;
  el.scrollTop = el.scrollHeight;
}
function appendChat(msgs) {
  const el = $("chat-list");
  if (!el || !msgs.length) return;
  if (chatLastId === 0) el.innerHTML = "";
  msgs.forEach((m) => {
    const div = document.createElement("div");
    div.className = "chat-msg " + (m.sender_role === "rider" ? "mine" : "theirs");
    div.innerHTML = `<span>${escapeHtml(m.message)}</span><small>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>`;
    el.appendChild(div);
    chatLastId = Math.max(chatLastId, m.id);
  });
  el.scrollTop = el.scrollHeight;
}
async function loadChat() {
  if (!currentRide || !store.rider) return;
  try {
    const d = await api(`/api/rides/${currentRide}/messages?after=${chatLastId}&limit=50`);
    if (chatLastId === 0 && !(d.messages || []).length) renderChatList($("chat-list"), [], "rider");
    else appendChat(d.messages || []);
    const badge = $("chat-unread");
    if (badge) {
      const n = d.unread_count || 0;
      badge.textContent = t("chat_unread", { n });
      badge.style.display = n ? "" : "none";
      if (n) setTimeout(() => { badge.style.display = "none"; }, 6000);
    }
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

// ---------- In-app voice call (rider side) ----------
function ensureCallForRide(ride) {
  if (!ride || (ride.status !== "accepted" && ride.status !== "ongoing")) return;
  if (callCtl && callRideId === ride.id) { callCtl.startPolling(); return; }
  if (callCtl) callCtl.reset();
  callRideId = ride.id;
  callCtl = createRideCall({
    rideId: ride.id, myRole: "rider", myUserId: store.rider.id,
    mount: $("rider-call-box"), onState: updateCallUI,
  });
  callCtl.startPolling();
  updateCallUI("idle");
}
function updateCallUI(state) {
  const box = $("rider-call-box");
  if (!box) return;
  box.classList.remove("hidden");
  const st = $("rider-call-status");
  const btnCall = $("btn-rider-call"), btnAcc = $("btn-rider-call-accept"), btnRej = $("btn-rider-call-reject"),
    btnMute = $("btn-rider-call-mute"), btnEnd = $("btn-rider-call-end");
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

// ---------- Complaint (rider side, active ride) ----------
async function sendComplaint(btn) {
  const input = $("complaint-text");
  const text = input.value.trim();
  if (!text || !currentRide) { setErr($("complaint-out"), t("complaint_enter")); return; }
  setLoading(btn, true);
  try {
    await postComplaint(currentRide, text);
    input.value = "";
    setErr($("complaint-out"), t("complaint_sent"));
    toast(t("complaint_sent"), "ok");
  } catch (e) { setErr($("complaint-out"), e.message); toast(e.message, "error"); }
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
    renderRiderTopupRequests(d);
  } catch (e) {
    $("rider-wallet").innerHTML = `<p class="form-err">${t("wallet_unavailable")}</p><button class="secondary" id="wallet-retry">${t("retry")}</button>`;
    $("wallet-retry").addEventListener("click", loadRiderWallet);
  }
}

// ---------- Rider wallet top-up (v2.3 — JazzCash / Sadapay picker) ----------
function updateRiderTopupButton(method, num, blocked) {
  const btn = $("btn-rider-topup");
  if (!btn) return;
  const tid = $("rider-topup-tid");
  if (tid) tid.placeholder = t(method === "Sadapay" ? "topup_tid_ph_sadapay" : "topup_tid_ph");
  if (blocked) {
    btn.textContent = t("sadapay_not_set");
    btn.disabled = true;
  } else {
    btn.disabled = false;
    btn.textContent = num ? t("btn_topup_method", { method: t(method === "Sadapay" ? "method_sadapay" : "method_jazzcash"), num }) : t("btn_topup", { num: settings.jazzcash_number || "03266040350" });
  }
}
function renderRiderTopupForm() {
  const amt = $("rider-topup-amount");
  if (!amt) return;
  const min = Number(settings.min_topup || 500);
  amt.placeholder = t("topup_amount_ph", { min });
}
function renderRiderTopupRequests(d) {
  const box = $("rider-topup-requests");
  if (!box) return;
  const reqs = [...(d.pending_topups || []), ...(d.past_topups || [])];
  box.innerHTML = reqs.length ? `<h4>${t("topup_history")}</h4>` + reqs.map((x) => `<div class="tx-row">${fmtRs(x.amount)} • ${escapeHtml(x.method || "JazzCash")} • TID ${escapeHtml(x.tid || "—")} • ${t("status")}: <b>${escapeHtml(x.status)}</b>${x.reject_reason ? ` • ${escapeHtml(x.reject_reason)}` : ""}<br><span class="muted">${new Date(x.created_at).toLocaleString()}</span></div>`).join("") : "";
}
async function riderTopup(btn) {
  const amount = Number($("rider-topup-amount").value), tid = $("rider-topup-tid").value.trim();
  if (!amount) { setErr($("rider-topup-err"), t("topup_enter_amount")); return; }
  const method = riderTopupPicker ? riderTopupPicker.getMethod() : "JazzCash";
  if (riderTopupPicker && riderTopupPicker.isBlocked()) { setErr($("rider-topup-err"), t("sadapay_not_set")); return; }
  setLoading(btn, true);
  try {
    const d = await api("/api/topup", { method: "POST", body: JSON.stringify({ amount, method, tid }) });
    toast(t("topup_sent", { id: d.request_id, amount: d.amount }), "ok");
    $("rider-topup-amount").value = ""; $("rider-topup-tid").value = "";
    loadRiderWallet();
  } catch (e) { setErr($("rider-topup-err"), e.message); toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}

// ---------- Profile ----------
// Note: there is no server endpoint to change a user's display name, so the
// profile shows the name (read-only) — no dead edit button is rendered.
function renderProfile() {
  if (!store.rider) return;
  const u = store.rider;
  $("profile-info").innerHTML = `<p><b>${escapeHtml(u.name)}</b><br>${escapeHtml(u.phone)} • ${t("your_id")} #${u.id}<br>${t("rating")}: ${ratingText(u.rating, u.rating_count, "rider")}</p>`;
  renderSupportInfo($("support-info"), settings);
  renderPushToggle($("rider-push-toggle-box"));
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
  initNotifications();
  applyI18n();
  await loadSettings();
  renderRiderTopupForm();
  riderTopupPicker = initTopupPicker($("rider-topup-method-box"), settings, updateRiderTopupButton);
  $("btn-rider-topup").addEventListener("click", (e) => riderTopup(e.currentTarget));
  // The map is optional: if Leaflet's CDN fails (offline / blocked), the
  // whole rider app must NOT die — booking via the place selects still
  // works, and session restore below must still run.
  try { await initMap(); } catch (e) { console.warn("[rider] map unavailable, continuing without it:", e && e.message ? e.message : e); }
  $("destination").addEventListener("change", onRouteChange);
  $("pickup").addEventListener("change", () => {
    // Picking "Current location (GPS)" is a real tap — start GPS now so
    // the platform shows its permission prompt.
    if ($("pickup").value === "__gps__") { requestGpsPickup(); return; }
    gpsPos = null; gpsDistanceKm = null;
    const p = placeByName($("pickup").value);
    if (p) setPin("pickup", p);
    onRouteChange();
  });
  // Session restore: rider stays, driver is redirected, guest sees the login card.
  try {
    const d = await api("/api/auth/me");
    if (d.user) {
      markClientLoggedIn();
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
