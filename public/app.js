// Chunian Ride — frontend logic (no build step).
const $ = (id) => document.getElementById(id);
const store = {
  get rider() { try { return JSON.parse(localStorage.getItem("cr_rider") || "null"); } catch { return null; } },
  set rider(v) { localStorage.setItem("cr_rider", JSON.stringify(v)); },
  get driver() { try { return JSON.parse(localStorage.getItem("cr_driver") || "null"); } catch { return null; } },
  set driver(v) { localStorage.setItem("cr_driver", JSON.stringify(v)); },
  get pin() { return sessionStorage.getItem("cr_pin") || ""; },
  set pin(v) { sessionStorage.setItem("cr_pin", v); },
};
let places = [];
let vehicle = "bike";
let currentRide = null;
let fareEstimate = null;
let map, markers = {}, pickupMarker = null, destMarker = null;
let driverMarker = null;
let driverActiveRide = null;

// ---- Ratings: only REAL ratings from completed rides are ever shown.
// rating_count 0 (new driver/rider, or demo data) => "New driver"/"New rider".
function ratingText(rating, count, who) {
  const n = Number(count || 0);
  if (n > 0) return `⭐ ${Number(rating).toFixed(1)}`;
  return `New ${who}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function placeByName(name) { return places.find((p) => p.name === name) || null; }
function fmtSched(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function schedLine(ts) {
  return ts ? `<p class="sched-line">🕐 Scheduled: <b>${fmtSched(ts)}</b></p>` : "";
}
function tipLine(tip) {
  return tip ? ` • 💰 Tip Rs ${tip} (100% driver)` : "";
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json", ...(opts.admin ? { "X-Admin-Pin": store.pin } : {}) }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}

// ---- Tabs ----
document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $("tab-" + b.dataset.tab).classList.add("active");
  });
});

// ---- Login-first welcome screen ----
function enterApp(tab) {
  $("welcome").classList.add("hidden");
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
  const btn = document.querySelector(`.tabs button[data-tab="${tab}"]`);
  if (btn) btn.classList.add("active");
  const sec = $("tab-" + tab);
  if (sec) sec.classList.add("active");
  const auth = tab === "rider" ? "rider-auth" : tab === "driver" ? "driver-auth" : "admin-auth";
  const el = $(auth);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  else window.scrollTo({ top: 0, behavior: "smooth" });
}
function showWelcome() { $("welcome").classList.remove("hidden"); }

// ---- Map ----
async function initMap() {
  const data = await api("/api/places");
  places = data.places;
  const sel1 = $("pickup"), sel2 = $("destination");
  places.forEach((p) => {
    const o1 = document.createElement("option"); o1.value = p.name; o1.textContent = p.name + (p.km != null ? ` (${p.km} km)` : " (distance nahi maloom)");
    const o2 = o1.cloneNode(true);
    sel1.appendChild(o1); sel2.appendChild(o2);
  });
  sel1.value = "Chunian City"; sel2.value = "Pattoki";
  map = L.map("map").setView([30.9667, 74.0333], 10);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap" }).addTo(map);
  places.forEach((p) => {
    const m = L.marker([p.lat, p.lng]).addTo(map).bindPopup(`<b>${p.name}</b><br>${p.note || ""}`);
    m.on("click", () => {
      if (!$("pickup").dataset.locked) { $("pickup").value = p.name; $("pickup").dataset.locked = "1"; setPin("pickup", p); }
      else { $("destination").value = p.name; delete $("pickup").dataset.locked; setPin("dest", p); }
    });
    markers[p.name] = m;
  });
  const q = new URLSearchParams(location.search);
  if (q.get("ride")) { currentRide = Number(q.get("ride")); showTrip(); }
}
function setPin(which, p) {
  if (which === "pickup") { if (pickupMarker) map.removeLayer(pickupMarker); pickupMarker = L.marker([p.lat, p.lng]).addTo(map).bindPopup("Pickup: " + p.name).openPopup(); }
  else { if (destMarker) map.removeLayer(destMarker); destMarker = L.marker([p.lat, p.lng]).addTo(map).bindPopup("Destination: " + p.name).openPopup(); }
}

// ---- Rider ----
function pickVehicle(v, el) {
  vehicle = v;
  document.querySelectorAll(".veh-btn").forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
}
async function riderSignup() {
  const name = $("rider-name").value.trim(), phone = $("rider-phone").value.trim();
  if (!name || !phone) return alert("Naam aur phone dono likhein.");
  try {
    const d = await api("/api/signup", { method: "POST", body: JSON.stringify({ name, phone, role: "rider" }) });
    store.rider = d.user;
    $("rider-who").textContent = `Assalam-o-Alaikum, ${d.user.name} (${d.user.phone}) — ID #${d.user.id}`;
  } catch (e) { alert(e.message); }
}
async function estimateFare() {
  const body = { pickup: $("pickup").value, destination: $("destination").value, vehicle };
  const km = $("distance").value.trim();
  if (km) body.distance_km = Number(km);
  try {
    const d = await api("/api/fare", { method: "POST", body: JSON.stringify(body) });
    fareEstimate = d;
    $("fare-box").classList.remove("hidden");
    $("fare-box").innerHTML = `Suggested fare: <b>Rs ${d.suggested_fare}</b> — ${d.distance_km} km, ${d.per_km} Rs/km (minimum Rs ${d.min_fare})${d.distance_estimated ? " — <i>distance estimated hai</i>" : ""}`;
    $("propose-box").classList.remove("hidden");
    $("proposed-fare").value = d.suggested_fare;
  } catch (e) { alert(e.message); }
}
async function requestRide() {
  if (!store.rider) return alert("Pehle signup karein (upar naam + phone).");
  const body = { rider_id: store.rider.id, pickup: $("pickup").value, destination: $("destination").value, vehicle, proposed_fare: Number($("proposed-fare").value) || fareEstimate.suggested_fare };
  const km = $("distance").value.trim();
  if (km) body.distance_km = Number(km);
  // Scheduled ride (optional): date + time, within the next 7 days.
  const sd = $("sched-date").value, st = $("sched-time").value;
  if (sd || st) {
    if (!sd || !st) return alert("Scheduled ride ke liye date aur time dono dein.");
    const when = new Date(sd + "T" + st).getTime();
    if (!Number.isFinite(when)) return alert("Date/time theek nahi hai.");
    if (when <= Date.now()) return alert("Scheduled time aane wala waqt hona chahiye.");
    if (when > Date.now() + 7 * 86400000) return alert("Sirf 7 din tak ki booking ho sakti hai.");
    body.scheduled_for = when;
  }
  try {
    const d = await api("/api/rides", { method: "POST", body: JSON.stringify(body) });
    currentRide = d.ride_id;
    $("offers-card").classList.remove("hidden");
    await loadOffers();
    alert(`Ride request bhej di (Ride #${d.ride_id})${d.scheduled_for ? " — Scheduled: " + fmtSched(d.scheduled_for) : ""}. ${d.offers_created} driver(s) online hain.`);
  } catch (e) { alert(e.message); }
}
async function loadOffers() {
  if (!currentRide) return;
  const d = await api(`/api/rides/${currentRide}`);
  const list = $("offers-list");
  const pending = d.offers.filter((o) => o.status === "pending");
  if (!pending.length) { list.innerHTML = "<p class='muted'>Abhi koi pending offer nahi — driver counter-offer bhej sakta hai, thori der baad refresh karein.</p>"; }
  list.innerHTML = pending.map((o) => `
    <div class="offer">
      <b>Rs ${o.fare}</b> — ${o.driver_name} ${ratingText(o.driver_rating, o.driver_rating_count, "driver")}<br>
      ${o.vehicle_model} • ${o.plate} • ETA ~${o.eta_min} min
      <br><button class="primary" onclick="acceptOffer(${o.id})">Ye driver chunein — Accept</button>
    </div>`).join("");
  if (d.ride.status !== "requested") showTrip();
}
async function acceptOffer(offerId) {
  try {
    const d = await api(`/api/rides/${currentRide}/offers/${offerId}/accept`, { method: "POST", body: "{}" });
    alert(`Driver accept ho gaya — agreed fare Rs ${d.agreed_fare}. Driver aa raha hai.`);
    showTrip();
  } catch (e) { alert(e.message); }
}
async function showTrip() {
  if (!currentRide) return;
  const d = await api(`/api/rides/${currentRide}`);
  const r = d.ride;
  const drv = d.offers.find((o) => o.status === "accepted");
  $("trip-card").classList.remove("hidden");
  // Driver live location — only during an active trip, only if fresh (< 3 min).
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
        distTxt = ` • ${r.status === "accepted" ? "Pickup" : "Destination"} se ${km.toFixed(1)} km door, ETA ~${eta} min`;
      }
      locLine = `<p class="loc-line">📍 Driver live location${distTxt}</p>`;
    } else {
      clearDriverMarker();
      locLine = `<p class="loc-line warn">📍 Driver ki live location nahi mil rahi — driver ne location share nahi ki ya GPS off hai.</p>`;
    }
  } else {
    clearDriverMarker();
  }
  $("trip-info").innerHTML = `
    <p><b>Ride #${r.id}</b> — ${r.pickup} → ${r.destination} (${r.distance_km} km, ${r.vehicle_type})</p>
    ${schedLine(r.scheduled_for)}
    <p>Status: <span class="badge st-${r.status}">${r.status}</span> • Fare: <b>Rs ${r.agreed_fare || r.suggested_fare}</b> (aap ne Rs ${r.proposed_fare} offer ki thi)${tipLine(r.tip_amount)}</p>
    ${drv ? `<p>Driver: <b>${drv.driver_name}</b> ${ratingText(drv.driver_rating, drv.driver_rating_count, "driver")} — ${drv.vehicle_model}, ${drv.plate}, ETA ~${drv.eta_min} min</p>` : ""}
    <p>Cash driver ko dein. ${r.cash_confirmed ? "✅ Cash confirm ho gaya." : ""}</p>
    ${locLine}
    ${r.status === "completed" ? "<p>✅ Ride mukammal — shukriya!</p>" : ""}`;
  if (drv) {
    $("chat-box").classList.remove("hidden");
    loadChat();
    ensureChatTimer();
  } else {
    $("chat-box").classList.add("hidden");
  }
  if (r.status === "completed") {
    $("rate-box").classList.remove("hidden");
    $("rate-stars").innerHTML = [1, 2, 3, 4, 5].map((s) => `<button onclick="rateRide(${s})">⭐</button>`).join("");
    // Tip box: only while no tip has been added yet.
    if (!r.tip_amount) {
      $("tip-box").classList.remove("hidden");
      $("tip-out").textContent = "";
    } else {
      $("tip-box").classList.add("hidden");
    }
  } else {
    $("tip-box").classList.add("hidden");
  }
  if (r.status === "requested") setTimeout(loadOffers, 8000);
  if (r.status === "accepted" || r.status === "ongoing") setTimeout(showTrip, 8000);
}
function updateDriverMarker(lat, lng) {
  if (!map) return;
  if (driverMarker) driverMarker.setLatLng([lat, lng]);
  else driverMarker = L.marker([lat, lng]).addTo(map).bindPopup("Driver yahan hai — live location");
}
function clearDriverMarker() {
  if (driverMarker && map) { map.removeLayer(driverMarker); driverMarker = null; }
}

// ---- In-ride chat (text only, rider <-> driver of this ride; no phone numbers) ----
let chatTimer = null;
function ensureChatTimer() {
  if (chatTimer) return;
  chatTimer = setInterval(() => {
    if (currentRide && !$("trip-card").classList.contains("hidden") && !$("chat-box").classList.contains("hidden")) loadChat();
    if (driverActiveRide && !$("driver-chat-card").classList.contains("hidden")) loadDriverChat();
  }, 5000);
}
function renderChatList(el, msgs, myRole) {
  if (!el) return;
  el.innerHTML = msgs.length ? msgs.map((m) => `<div class="chat-msg ${m.sender_role === myRole ? "mine" : "theirs"}"><span>${escapeHtml(m.message)}</span><small>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div>`).join("") : "<p class='muted'>Abhi koi message nahi.</p>";
  el.scrollTop = el.scrollHeight;
}
async function loadChat() {
  if (!currentRide || !store.rider) return;
  try {
    const d = await api(`/api/rides/${currentRide}/messages?user_id=${store.rider.id}`);
    renderChatList($("chat-list"), d.messages, "rider");
  } catch {}
}
async function sendChat() {
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text || !currentRide || !store.rider) return;
  try {
    await api(`/api/rides/${currentRide}/messages`, { method: "POST", body: JSON.stringify({ sender_id: store.rider.id, sender_role: "rider", message: text }) });
    input.value = "";
    loadChat();
  } catch (e) { alert(e.message); }
}
async function loadDriverChat() {
  if (!driverActiveRide || !store.driver) return;
  try {
    const d = await api(`/api/rides/${driverActiveRide.id}/messages?user_id=${store.driver.id}`);
    renderChatList($("driver-chat-list"), d.messages, "driver");
  } catch {}
}
async function sendDriverChat() {
  const input = $("driver-chat-input");
  const text = input.value.trim();
  if (!text || !driverActiveRide || !store.driver) return;
  try {
    await api(`/api/rides/${driverActiveRide.id}/messages`, { method: "POST", body: JSON.stringify({ sender_id: store.driver.id, sender_role: "driver", message: text }) });
    input.value = "";
    loadDriverChat();
  } catch (e) { alert(e.message); }
}

// ---- Driver live location sharing (phone GPS, only while online) ----
let locWatchId = null, lastLocPost = 0;
function setLocStatus(t) { const el = $("loc-status"); if (el) el.textContent = t; }
function startLocationSharing() {
  if (!("geolocation" in navigator)) { setLocStatus("Is phone par location (GPS) available nahi hai."); return; }
  if (locWatchId !== null) return;
  setLocStatus("📍 Live location share ho rahi hai…");
  locWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      setLocStatus("📍 Live location share ho rahi hai");
      const nowMs = Date.now();
      if (nowMs - lastLocPost < 10000) return;
      lastLocPost = nowMs;
      postDriverLocation(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      if (err.code === 1) setLocStatus("Location permission nahi mili — phone ki Settings mein location allow karein, warna rider ko aap ki live location nahi dikhe gi.");
      else setLocStatus("Location nahi mil rahi — GPS on karein aur dobara koshish karein.");
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
async function rateRide(stars) {
  try { await api(`/api/rides/${currentRide}/rate`, { method: "POST", body: JSON.stringify({ by: "rider", stars }) }); alert("Shukriya! Rating save ho gayi."); } catch (e) { alert(e.message); }
}
// Tip after a completed ride — 100% driver, no commission on tips.
async function addTip(amount) {
  if (!currentRide || !store.rider) return;
  const tip = Math.round(Number(amount));
  if (!tip || tip <= 0) return alert("Tip ki raqam likhein.");
  try {
    const d = await api(`/api/rides/${currentRide}/tip`, { method: "POST", body: JSON.stringify({ rider_id: store.rider.id, amount: tip }) });
    $("tip-out").textContent = `Shukriya! Tip Rs ${d.tip} driver ko mil gayi — is par koi commission nahi kati.`;
    $("tip-box").classList.add("hidden");
    showTrip();
  } catch (e) { alert(e.message); }
}
async function addTipCustom() {
  const v = Number($("tip-custom").value);
  if (!v || v <= 0) return alert("Tip ki raqam likhein.");
  addTip(v);
}
async function shareTrip() {
  if (!currentRide) return alert("Koi active ride nahi.");
  const d = await api(`/api/rides/${currentRide}/share`);
  $("share-out").textContent = d.text;
  try { await navigator.clipboard.writeText(d.text); $("share-out").textContent += " (copy ho gaya)"; } catch {}
}
async function sosTrip() {
  if (!currentRide) return alert("Pehle ride book karein. Emergency numbers: Police 15, Rescue 1122.");
  try { const d = await api(`/api/rides/${currentRide}/sos`, { method: "POST", body: JSON.stringify({ user_id: store.rider ? store.rider.id : 0, message: "SOS from rider app" }) }); alert(d.message); } catch (e) { alert(e.message); }
}
async function cancelRide() {
  if (!currentRide) return;
  try { await api(`/api/rides/${currentRide}/cancel`, { method: "POST", body: "{}" }); alert("Ride cancel ho gayi."); showTrip(); } catch (e) { alert(e.message); }
}
async function loadHistory() {
  if (!store.rider) return alert("Pehle signup karein.");
  const d = await api(`/api/rides?rider_id=${store.rider.id}`);
  $("history-list").innerHTML = d.rides.length ? d.rides.map((r) => `
    <div class="ride-row"><b>Ride #${r.id}</b> — ${r.pickup} → ${r.destination} • ${r.vehicle_type} • ${r.distance_km} km<br>
    Fare Rs ${r.agreed_fare || r.suggested_fare}${tipLine(r.tip_amount)} • Status: ${r.status}${r.commission_charged ? ` • Platform fee Rs ${r.commission_charged}` : ""}<br>
    ${r.scheduled_for ? `🕐 Scheduled: ${fmtSched(r.scheduled_for)}<br>` : ""}
    <span class="muted">${new Date(r.created_at).toLocaleString()}</span></div>`).join("") : "<p class='muted'>Koi ride nahi mili.</p>";
}

// ---- Driver ----
async function driverLogin() {
  const phone = $("driver-phone").value.trim();
  if (!phone) return alert("Phone likhein.");
  try {
    const d = await api("/api/signup", { method: "POST", body: JSON.stringify({ name: "Driver", phone, role: "driver" }) });
    const prof = await api(`/api/drivers/${d.user.id}`);
    store.driver = { ...d.user, ...prof.driver };
    $("driver-who").textContent = `${prof.driver.name} — ${prof.driver.vehicle_model} (${prof.driver.plate}) — Status: ${prof.driver.status}`;
    $("driver-dash").classList.remove("hidden");
    renderDriver();
  } catch (e) { alert(e.message + " (Agar naye driver hain to neeche register karein.)"); }
}
function renderDriver() {
  const d = store.driver;
  $("driver-info").innerHTML = `<p><b>${d.name}</b> — ${d.vehicle_type} • ${d.vehicle_model} • ${d.plate}<br>Status: <b>${d.status}</b> • Online: <b>${d.online ? "Yes" : "No"}</b> • Rating: ${ratingText(d.rating, d.rating_count, "driver")} • Wallet: <b>Rs ${d.wallet_balance}</b></p>`;
  $("online-btn").textContent = d.online ? "Go Offline" : "Go Online";
  if (d.online) startLocationSharing(); else stopLocationSharing();
  loadWallet();
}
async function toggleOnline() {
  try {
    const d = await api(`/api/drivers/${store.driver.id}/online`, { method: "POST", body: JSON.stringify({ online: !store.driver.online }) });
    store.driver.online = d.online ? 1 : 0;
    renderDriver();
  } catch (e) { alert(e.message); }
}
async function loadRequests() {
  const d = await api(`/api/drivers/${store.driver.id}/requests`);
  $("requests-list").innerHTML = d.requests.length ? d.requests.map((r) => {
    // inDrive-style quick counter buttons: +10% / +15% / +20% of the rider's offer.
    const quick = [10, 15, 20].map((pct) => {
      const amt = Math.round((r.proposed_fare * (100 + pct)) / 100);
      return `<button class="quick-btn" onclick="setCounter(${r.id}, ${amt})">+${pct}% · Rs ${amt}</button>`;
    }).join("");
    return `
    <div class="ride-row"><b>Ride #${r.id}</b> — ${r.pickup} → ${r.destination} • ${r.vehicle_type} • ${r.distance_km} km<br>
    ${r.scheduled_for ? `<span class="sched-badge">🕐 Scheduled: ${fmtSched(r.scheduled_for)}</span><br>` : ""}
    Rider: ${r.rider_name} ${ratingText(r.rider_rating, r.rider_rating_count, "rider")} • Rider offer: <b>Rs ${r.proposed_fare}</b> (suggested Rs ${r.suggested_fare})<br>
    <button onclick="driverAccept(${r.id})">Accept (rider ki offer)</button>
    <input id="counter-${r.id}" type="number" placeholder="Counter-offer Rs" style="width:130px;display:inline-block">
    <button onclick="driverCounter(${r.id})">Counter-offer</button>
    <div class="quick-row">${quick}</div>
    <button onclick="driverDecline(${r.id})">Decline (koi penalty nahi)</button>
    <a target="_blank" href="https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(r.pickup + ", Chunian")}&destination=${encodeURIComponent(r.destination)}">🗺️ Google Maps</a>
    <a target="_blank" href="https://www.openstreetmap.org/directions?from=${encodeURIComponent(r.pickup)}&to=${encodeURIComponent(r.destination)}">OSM</a>
    </div>`;
  }).join("") : "<p class='muted'>Koi open request nahi.</p>";
}
// Quick counter-offer: fill the counter input with the computed amount.
function setCounter(rideId, amount) {
  const el = $("counter-" + rideId);
  if (el) { el.value = amount; el.focus(); }
}
async function driverAccept(rideId) {
  const d = await api(`/api/rides/${rideId}`);
  const mine = d.offers.find((o) => o.driver_id === store.driver.id && o.status === "pending");
  if (!mine) return alert("Apki pending offer nahi mili — pehle counter-offer bhejein ya refresh karein.");
  try { const r = await api(`/api/rides/${rideId}/offers/${mine.id}/accept`, { method: "POST", body: "{}" }); alert(`Ride accept — fare Rs ${r.agreed_fare}. Pickup par jayein.`); loadDriverRides(); } catch (e) { alert(e.message); }
}
async function driverCounter(rideId) {
  const fare = Number($("counter-" + rideId).value);
  if (!fare) return alert("Counter fare likhein.");
  try { await api(`/api/rides/${rideId}/counter`, { method: "POST", body: JSON.stringify({ driver_id: store.driver.id, fare }) }); alert("Counter-offer bhej di."); } catch (e) { alert(e.message); }
}
async function driverDecline(rideId) {
  try { await api(`/api/rides/${rideId}/decline`, { method: "POST", body: JSON.stringify({ driver_id: store.driver.id }) }); alert("Decline ho gaya — koi penalty nahi."); loadRequests(); } catch (e) { alert(e.message); }
}
async function loadWallet() {
  const d = await api(`/api/drivers/${store.driver.id}/wallet`);
  $("wallet-info").innerHTML = `<p>Balance: <b>Rs ${d.wallet_balance}</b></p>` + d.transactions.slice(0, 8).map((t) => `<div class="tx-row">${t.type} — Rs ${t.amount} • ${t.method || ""} ${t.tid || ""} • ${t.note}<br><span class="muted">${new Date(t.created_at).toLocaleString()}</span></div>`).join("");
}
async function topup() {
  const amount = Number($("topup-amount").value), tid = $("topup-tid").value.trim();
  if (!amount) return alert("Amount likhein.");
  try { const d = await api(`/api/drivers/${store.driver.id}/topup`, { method: "POST", body: JSON.stringify({ amount, method: "JazzCash", tid }) }); store.driver.wallet_balance = d.wallet_balance; renderDriver(); alert(`Top-up request save — new balance Rs ${d.wallet_balance}. Owner TID verify karega.`); } catch (e) { alert(e.message); }
}
async function loadEarnings(days) {
  const d = await api(`/api/drivers/${store.driver.id}/earnings?days=${days}`);
  $("earnings-info").innerHTML = `<p>${days === 1 ? "Aaj" : days + " din"}: ${d.rides} rides • Gross fares Rs ${d.gross_fares} • Platform fees Rs ${d.platform_fees} • Tips Rs ${d.tips || 0} (100% driver, no commission) • <b>Aap ne rakha: Rs ${d.driver_kept}</b></p>`;
}
async function loadDriverRides() {
  const d = await api(`/api/rides?driver_id=${store.driver.id}`);
  const active = d.rides.find((r) => r.status === "accepted" || r.status === "ongoing");
  driverActiveRide = active || null;
  const card = $("driver-chat-card");
  if (active) {
    card.classList.remove("hidden");
    $("driver-chat-who").textContent = `Ride #${active.id} — ${active.pickup} → ${active.destination} • Rider: ${active.rider_name || ""}`;
    loadDriverChat();
    ensureChatTimer();
  } else {
    card.classList.add("hidden");
  }
  $("driver-rides").innerHTML = d.rides.length ? d.rides.map((r) => `
    <div class="ride-row"><b>Ride #${r.id}</b> — ${r.pickup} → ${r.destination} • Rs ${r.agreed_fare || r.suggested_fare}${tipLine(r.tip_amount)} • ${r.status}
    ${r.scheduled_for ? `<br>🕐 Scheduled: ${fmtSched(r.scheduled_for)}` : ""}
    ${r.status === "accepted" ? ` <button onclick="startRide(${r.id})">Start Trip</button>` : ""}
    ${r.status === "ongoing" ? ` <label><input type="checkbox" id="cash-${r.id}" style="width:auto"> Cash mil gaya</label> <button onclick="completeRide(${r.id})">End Trip — Cash Confirm</button>` : ""}
    ${r.status === "completed" ? ` <button onclick="rateRider(${r.id})">Rider ko 5⭐ dein</button>` : ""}
    </div>`).join("") : "<p class='muted'>Koi ride nahi.</p>";
}
async function startRide(id) { try { await api(`/api/rides/${id}/start`, { method: "POST", body: "{}" }); alert("Trip shuru."); loadDriverRides(); } catch (e) { alert(e.message); } }
async function completeRide(id) {
  const cash = $("cash-" + id) && $("cash-" + id).checked;
  if (!cash) return alert("Pehle 'Cash mil gaya' tick karein — bina cash confirm ke trip end nahi ho sakti.");
  try {
    const d = await api(`/api/rides/${id}/complete`, { method: "POST", body: JSON.stringify({ cash_received: true }) });
    alert(`Trip complete! Fare Rs ${d.fare}, platform fee Rs ${d.platform_take} (commission ${d.commission_pct}% + Rs ${d.booking_fee} fee). Aap ne rakha Rs ${d.driver_kept}. Wallet balance: Rs ${d.driver_wallet_balance}.`);
    store.driver.wallet_balance = d.driver_wallet_balance;
    renderDriver(); loadDriverRides();
  } catch (e) { alert(e.message); }
}
async function rateRider(id) { try { await api(`/api/rides/${id}/rate`, { method: "POST", body: JSON.stringify({ by: "driver", stars: 5 }) }); alert("Rider ko 5 stars diye."); } catch (e) { alert(e.message); } }
async function registerDriver() {
  const name = $("reg-name").value.trim(), phone = $("reg-phone").value.trim();
  if (!name || !phone) return alert("Naam aur phone likhein.");
  try {
    const u = await api("/api/signup", { method: "POST", body: JSON.stringify({ name, phone, role: "driver" }) });
    const d = await api("/api/drivers/register", { method: "POST", body: JSON.stringify({ user_id: u.user.id, vehicle_type: $("reg-vehicle").value, vehicle_model: $("reg-model").value, plate: $("reg-plate").value, cnic: $("reg-cnic").value, licence: $("reg-licence").value, vehicle_reg: $("reg-vehreg").value }) });
    $("reg-out").textContent = `Registration submit — status: ${d.status}. Owner approve karega.`;
  } catch (e) { $("reg-out").textContent = e.message; }
}

// ---- Admin ----
async function adminLogin() {
  store.pin = $("admin-pin").value.trim();
  try {
    await api("/api/admin/rides", { admin: true });
    $("admin-out").textContent = "Admin khul gaya.";
    $("admin-dash").classList.remove("hidden");
    const s = (await api("/api/settings")).settings;
    $("set-bike").value = s.rate_bike_per_km; $("set-rickshaw").value = s.rate_rickshaw_per_km; $("set-car").value = s.rate_car_per_km;
    $("set-min-bike").value = s.min_bike; $("set-min-rickshaw").value = s.min_rickshaw; $("set-min-car").value = s.min_car;
    $("set-commission").value = s.commission_pct; $("set-fee").value = s.booking_fee;
    $("set-jazzcash").value = s.jazzcash_number; $("set-sadapay").value = s.sadapay_number;
    loadLiveDrivers();
  } catch (e) { $("admin-out").textContent = "Ghalat PIN."; }
}
async function loadLiveDrivers() {
  try {
    const d = await api("/api/admin/live-drivers", { admin: true });
    $("live-drivers").innerHTML = d.drivers.length ? d.drivers.map((x) => `<div class="driver-row">${x.name} — ${x.vehicle_type} • ${x.vehicle_model} • ${x.plate} • ${ratingText(x.rating, x.rating_count, "driver")} • Wallet Rs ${x.wallet_balance} • (${x.lat}, ${x.lng})</div>`).join("") : "<p class='muted'>Koi driver online nahi.</p>";
  } catch (e) { $("live-drivers").textContent = e.message; }
}
async function loadAdminRides() {
  const d = await api("/api/admin/rides", { admin: true });
  $("admin-rides").innerHTML = d.rides.map((r) => `<div class="ride-row"><b>#${r.id}</b> ${r.rider_name} → ${r.driver_name || "—"} • ${r.pickup} → ${r.destination} • ${r.vehicle_type} • Rs ${r.agreed_fare || r.suggested_fare}${tipLine(r.tip_amount)} • ${r.status}${r.commission_charged ? ` • Fee Rs ${r.commission_charged}` : ""}${r.scheduled_for ? `<br>🕐 Scheduled: ${fmtSched(r.scheduled_for)}` : ""}</div>`).join("") || "<p class='muted'>Koi ride nahi.</p>";
}
async function loadAdminDrivers() {
  const d = await api("/api/admin/drivers", { admin: true });
  $("admin-drivers").innerHTML = d.drivers.map((x) => `<div class="driver-row"><b>${x.name}</b> (${x.phone}) — ${x.vehicle_type} • ${x.vehicle_model} • ${x.plate}<br>CNIC: ${x.cnic} • Licence: ${x.licence} • Reg: ${x.vehicle_reg}<br>Status: <b>${x.status}</b> • Rating: ${ratingText(x.rating, x.rating_count, "driver")}${x.demo ? " • Demo driver" : ""} • Wallet Rs ${x.wallet_balance} • Online: ${x.online ? "Yes" : "No"}<br>
    ${x.status !== "approved" ? `<button onclick="adminDriver(${x.user_id},'approve')">Approve</button>` : ""} ${x.status !== "blocked" ? `<button onclick="adminDriver(${x.user_id},'block')">Block</button>` : ""}</div>`).join("");
}
async function adminDriver(id, action) {
  await api(`/api/admin/drivers/${id}/${action}`, { method: "POST", body: "{}", admin: true });
  loadAdminDrivers();
}
async function saveSettings() {
  const body = { rate_bike_per_km: $("set-bike").value, rate_rickshaw_per_km: $("set-rickshaw").value, rate_car_per_km: $("set-car").value, min_bike: $("set-min-bike").value, min_rickshaw: $("set-min-rickshaw").value, min_car: $("set-min-car").value, commission_pct: $("set-commission").value, booking_fee: $("set-fee").value, jazzcash_number: $("set-jazzcash").value, sadapay_number: $("set-sadapay").value };
  try { await api("/api/admin/settings", { method: "POST", body: JSON.stringify(body), admin: true }); $("settings-out").textContent = "Settings save — naye fares foran lagoo."; } catch (e) { $("settings-out").textContent = e.message; }
}
async function loadLedger() {
  const id = $("ledger-driver").value.trim();
  if (!id) return alert("Driver user ID likhein.");
  const d = await api(`/api/admin/wallet/${id}`, { admin: true });
  $("ledger-out").innerHTML = d.transactions.map((t) => `<div class="tx-row">${t.type} — Rs ${t.amount} • ${t.method || ""} ${t.tid || ""} • ${t.note}<br><span class="muted">${new Date(t.created_at).toLocaleString()}</span></div>`).join("") || "<p class='muted'>Koi transaction nahi.</p>";
}
async function loadComplaints() {
  const d = await api("/api/admin/complaints", { admin: true });
  $("complaints-out").innerHTML = d.complaints.map((c) => `<div class="complaint-row"><b>${c.kind.toUpperCase()}</b> — Ride #${c.ride_id || "—"} • ${c.message} • Status: ${c.status} ${c.status === "open" ? `<button onclick="resolveComplaint(${c.id})">Resolve</button>` : ""}<br><span class="muted">${new Date(c.created_at).toLocaleString()}</span></div>`).join("") || "<p class='muted'>Koi complaint nahi.</p>";
}
async function resolveComplaint(id) { await api(`/api/admin/complaints/${id}/resolve`, { method: "POST", body: "{}", admin: true }); loadComplaints(); }
async function loadReport() {
  const d = await api("/api/admin/reports?days=7", { admin: true });
  $("report-out").innerHTML = `<p><b>7 din:</b> ${d.rides} completed rides • Gross fares Rs ${d.gross_fares} • Platform revenue Rs ${d.platform_revenue}</p>` +
    d.by_vehicle.map((v) => `<p>${v.vehicle_type}: ${v.rides} rides, Rs ${v.gross}</p>`).join("") +
    d.by_driver.map((x) => `<p>${x.name}: ${x.rides} rides, gross Rs ${x.gross}, platform Rs ${x.platform}</p>`).join("");
}
async function loadProfit() {
  const d = await api(`/api/admin/profit?avg_fare=${$("calc-fare").value}&monthly_cost=${$("calc-cost").value}`, { admin: true });
  $("profit-out").innerHTML = `<p><b>ESTIMATES ONLY — koi guarantee nahi.</b></p>
    <p>Platform keep per ride: Rs ${d.platform_keep_per_ride} (commission ${d.commission_pct}% + Rs ${d.booking_fee} fee, avg fare Rs ${d.avg_fare})</p>
    <p>Break-even: <b>${d.break_even_rides_per_day} rides/day</b> (${d.break_even_rides_per_month}/month) at monthly cost Rs ${d.monthly_cost}</p>` +
    d.scenarios.map((s) => `<p>${s.rides_per_day} rides/day → monthly gross Rs ${s.monthly_gross}, net Rs ${s.monthly_net}</p>`).join("");
}

initMap();
if (store.rider) { $("rider-name").value = store.rider.name; $("rider-phone").value = store.rider.phone; $("rider-who").textContent = `${store.rider.name} (${store.rider.phone}) — ID #${store.rider.id}`; }

// Login-first: show the welcome screen unless a rider/driver session already exists.
if (store.rider || store.driver) $("welcome").classList.add("hidden");
