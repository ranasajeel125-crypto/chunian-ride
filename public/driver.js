// Chunian Ride — driver app (driver.html). Driver only; no rider/admin code.
const store = { driver: null };
let settings = { rate_bike_per_km: 15, rate_rickshaw_per_km: 25, rate_car_per_km: 70, rate_ac_car_per_km: 85, min_bike: 50, min_rickshaw: 100, min_car: 150, min_ac_car: 200, jazzcash_number: "03266040350", min_topup: 500, support_phone: "" };
let driverActiveRide = null;
let chatTimer = null;
let locWatchId = null, lastLocPost = 0;
let currentScreen = "home";

function switchScreen(name) {
  currentScreen = name;
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + name));
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.screen === name));
  if (!store.driver) return;
  if (name === "requests") loadRequests();
  if (name === "wallet") loadWallet();
  if (name === "profile") renderDriverProfile();
  if (name === "home") { loadDriverRides(); loadEarnings(1); }
  window.scrollTo({ top: 0 });
}
$$(".nav-btn").forEach((b) => b.addEventListener("click", () => switchScreen(b.dataset.screen)));

window.onLangChange = () => {
  if (store.driver) { renderDriver(); renderDriverProfile(); }
  $("topup-amount").placeholder = t("topup_amount_ph", { min: settings.min_topup || 500 });
  $("btn-topup").textContent = t("btn_topup", { num: settings.jazzcash_number || "03266040350" });
  $("topup-note").textContent = t("topup_note", { num: settings.jazzcash_number || "03266040350" });
  if (currentScreen === "requests") loadRequests();
  if (currentScreen === "wallet") loadWallet();
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
  if (!("geolocation" in navigator)) { setLocStatus(t("gps_unavailable")); return; }
  if (locWatchId !== null) return;
  setLocStatus(t("loc_sharing"));
  locWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      setLocStatus(t("loc_sharing_on"));
      const nowMs = Date.now();
      if (nowMs - lastLocPost < 10000) return;
      lastLocPost = nowMs;
      postDriverLocation(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => { setLocStatus(err.code === 1 ? t("gps_denied") : t("gps_unavailable")); },
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

// ---------- Requests ----------
async function loadRequests() {
  if (!store.driver) return;
  try {
    const d = await api(`/api/drivers/${store.driver.id}/requests`);
    $("requests-list").innerHTML = d.requests.length ? d.requests.map((r) => {
      const quick = [10, 15, 20].map((pct) => {
        const amt = Math.round((r.proposed_fare * (100 + pct)) / 100);
        return `<button class="quick-btn" data-counter="${r.id}" data-amt="${amt}">+${pct}% · ${fmtRs(amt)}</button>`;
      }).join("");
      return `
      <div class="ride-row"><b>Ride #${r.id}</b> — ${escapeHtml(r.pickup)} → ${escapeHtml(r.destination)} • ${t(r.vehicle_type === "ac_car" ? "ac_car" : r.vehicle_type)} • ${r.distance_km} km<br>
      ${r.scheduled_for ? `<span class="sched-badge">🕐 ${t("scheduled")}: ${escapeHtml(fmtSched(r.scheduled_for))}</span><br>` : ""}
      ${escapeHtml(r.rider_name)} ${ratingText(r.rider_rating, r.rider_rating_count, "rider")} • ${t("rider_offer")}: <b>${fmtRs(r.proposed_fare)}</b> (${t("suggested", { fare: r.suggested_fare })})<br>
      <button data-accept="${r.id}">${t("accept_offer")}</button>
      <input id="counter-${r.id}" type="number" placeholder="${t("counter_ph")}" style="width:130px;display:inline-block">
      <button data-counter-send="${r.id}">${t("btn_counter")}</button>
      <div class="quick-row">${quick}</div>
      <button data-decline="${r.id}">${t("decline")}</button>
      <a target="_blank" href="https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(r.pickup + ", Chunian")}&destination=${encodeURIComponent(r.destination)}">🗺️ Google Maps</a>
      <a target="_blank" href="https://www.openstreetmap.org/directions?from=${encodeURIComponent(r.pickup)}&to=${encodeURIComponent(r.destination)}">OSM</a>
      </div>`;
    }).join("") : `<p class="muted empty">${t("no_requests")}</p>`;
    $$("[data-accept]").forEach((b) => b.addEventListener("click", () => driverAccept(Number(b.dataset.accept), b)));
    $$("[data-counter-send]").forEach((b) => b.addEventListener("click", () => driverCounter(Number(b.dataset.counterSend), b)));
    $$("[data-decline]").forEach((b) => b.addEventListener("click", () => driverDecline(Number(b.dataset.decline), b)));
    $$("[data-counter]").forEach((b) => b.addEventListener("click", () => setCounter(Number(b.dataset.counter), Number(b.dataset.amt))));
  } catch (e) { $("requests-list").innerHTML = `<p class="form-err">${escapeHtml(e.message)}</p>`; }
}
function setCounter(rideId, amount) {
  const el = $("counter-" + rideId);
  if (el) { el.value = amount; el.focus(); }
}
async function driverAccept(rideId, btn) {
  setLoading(btn, true);
  try {
    const d = await api(`/api/rides/${rideId}`);
    const mine = d.offers.find((o) => o.driver_id === store.driver.id && o.status === "pending");
    if (!mine) { toast(t("no_pending_offer"), "error"); return; }
    const r = await api(`/api/rides/${rideId}/offers/${mine.id}/accept`, { method: "POST", body: "{}" });
    toast(t("ride_accepted_driver", { fare: r.agreed_fare }), "ok");
    loadDriverRides();
  } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
async function driverCounter(rideId, btn) {
  const fare = Number($("counter-" + rideId).value);
  if (!fare) { toast(t("counter_enter"), "error"); return; }
  setLoading(btn, true);
  try { await api(`/api/rides/${rideId}/counter`, { method: "POST", body: JSON.stringify({ driver_id: store.driver.id, fare }) }); toast(t("counter_sent"), "ok"); } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}
async function driverDecline(rideId, btn) {
  setLoading(btn, true);
  try { await api(`/api/rides/${rideId}/decline`, { method: "POST", body: JSON.stringify({ driver_id: store.driver.id }) }); toast(t("declined"), "ok"); loadRequests(); } catch (e) { toast(e.message, "error"); }
  finally { setLoading(btn, false); }
}

// ---------- Active ride + chat ----------
async function loadDriverRides() {
  if (!store.driver) return;
  try {
    const d = await api(`/api/rides?driver_id=${store.driver.id}`);
    const active = d.rides.find((r) => r.status === "accepted" || r.status === "ongoing");
    driverActiveRide = active || null;
    const card = $("driver-chat-card");
    if (active) {
      card.classList.remove("hidden");
      $("driver-chat-who").textContent = `Ride #${active.id} — ${active.pickup} → ${active.destination} • ${active.rider_name || ""}`;
      loadDriverChat();
      ensureChatTimer();
    } else card.classList.add("hidden");
    $("driver-rides").innerHTML = d.rides.length ? d.rides.map((r) => `
      <div class="ride-row"><b>Ride #${r.id}</b> — ${escapeHtml(r.pickup)} → ${escapeHtml(r.destination)} • ${fmtRs(r.agreed_fare || r.suggested_fare)}${tipLine(r.tip_amount)} • ${escapeHtml(r.status)}
      ${r.scheduled_for ? `<br>🕐 ${t("scheduled")}: ${escapeHtml(fmtSched(r.scheduled_for))}` : ""}
      ${r.status === "accepted" ? ` <button data-start="${r.id}">${t("start_trip")}</button>` : ""}
      ${r.status === "ongoing" ? ` <label><input type="checkbox" id="cash-${r.id}" style="width:auto"> ${t("cash_received")}</label> <button data-complete="${r.id}">${t("end_trip")}</button>` : ""}
      ${r.status === "completed" ? ` <button data-rate-rider="${r.id}">${t("rate_rider_5")}</button>` : ""}
      </div>`).join("") : `<p class="muted empty">${t("no_rides")}</p>`;
    $$("[data-start]").forEach((b) => b.addEventListener("click", () => startRide(Number(b.dataset.start), b)));
    $$("[data-complete]").forEach((b) => b.addEventListener("click", () => completeRide(Number(b.dataset.complete), b)));
    $$("[data-rate-rider]").forEach((b) => b.addEventListener("click", () => rateRider(Number(b.dataset.rateRider), b)));
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
  }, 5000);
}
async function loadDriverChat() {
  if (!driverActiveRide || !store.driver) return;
  try {
    const d = await api(`/api/rides/${driverActiveRide.id}/messages?user_id=${store.driver.id}`);
    const el = $("driver-chat-list");
    el.innerHTML = d.messages.length ? d.messages.map((m) => `<div class="chat-msg ${m.sender_role === "driver" ? "mine" : "theirs"}"><span>${escapeHtml(m.message)}</span><small>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div>`).join("") : `<p class="muted">${t("chat_empty")}</p>`;
    el.scrollTop = el.scrollHeight;
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

// ---------- Wallet + top-up ----------
async function loadWallet() {
  if (!store.driver) return;
  try {
    const d = await api(`/api/drivers/${store.driver.id}/wallet`);
    $("wallet-info").innerHTML = `<p class="wallet-balance">${t("balance")}: <b>${fmtRs(d.wallet_balance)}</b></p>` + d.transactions.slice(0, 8).map((x) => `<div class="tx-row">${escapeHtml(x.type)} — ${fmtRs(x.amount)} • ${escapeHtml(x.method || "")} ${escapeHtml(x.tid || "")} • ${escapeHtml(x.note || "")}<br><span class="muted">${new Date(x.created_at).toLocaleString()}</span></div>`).join("");
    const reqs = [...(d.pending_topups || []), ...(d.past_topups || [])];
    $("topup-requests").innerHTML = reqs.length ? `<h4>${t("topup_history")}</h4>` + reqs.map((x) => `<div class="tx-row">${fmtRs(x.amount)} • ${escapeHtml(x.method)} • TID ${escapeHtml(x.tid || "—")} • ${t("status")}: <b>${escapeHtml(x.status)}</b>${x.reject_reason ? ` • ${escapeHtml(x.reject_reason)}` : ""}<br><span class="muted">${new Date(x.created_at).toLocaleString()}</span></div>`).join("") : "";
  } catch (e) { $("wallet-info").innerHTML = `<p class="form-err">${escapeHtml(e.message)}</p>`; }
}
async function topup(btn) {
  const amount = Number($("topup-amount").value), tid = $("topup-tid").value.trim();
  if (!amount) { setErr($("topup-err"), t("topup_enter_amount")); return; }
  setLoading(btn, true);
  try {
    const d = await api(`/api/drivers/${store.driver.id}/topup`, { method: "POST", body: JSON.stringify({ amount, method: "JazzCash", tid }) });
    toast(t("topup_sent", { id: d.request_id, amount: d.amount }), "ok");
    $("topup-amount").value = ""; $("topup-tid").value = "";
    loadWallet();
  } catch (e) { setErr($("topup-err"), e.message); }
  finally { setLoading(btn, false); }
}
async function loadEarnings(days) {
  if (!store.driver) return;
  try {
    const d = await api(`/api/drivers/${store.driver.id}/earnings?days=${days}`);
    $("earnings-info").innerHTML = `<p>${t("earnings_line", { label: days === 1 ? t("today") : t("days_7"), rides: d.rides, gross: d.gross_fares, fees: d.platform_fees, tips: d.tips || 0, kept: d.driver_kept })}</p>`;
  } catch (e) { $("earnings-info").innerHTML = `<p class="form-err">${escapeHtml(e.message)}</p>`; }
}

// ---------- Profile + registration ----------
function renderDriverProfile() {
  const d = store.driver;
  if (!d) return;
  $("driver-profile-info").innerHTML = `<p><b>${escapeHtml(d.name)}</b> (${escapeHtml(d.phone)}) • ${t("your_id")} #${d.id}<br>${t("vehicle")}: ${t(d.vehicle_type === "ac_car" ? "ac_car" : d.vehicle_type)} • ${escapeHtml(d.vehicle_model)} • ${escapeHtml(d.plate)}<br>${t("rating")}: ${ratingText(d.rating, d.rating_count, "driver")} • ${t("wallet")}: <b>${fmtRs(d.wallet_balance)}</b><br>${t("doc_status")}: <b>${d.documents_status === "approved" ? t("docs_approved") : t("docs_pending")}</b> (${escapeHtml(d.documents_status || "pending")})</p>`;
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
  applyI18n();
  try {
    const d = await api("/api/settings");
    settings = { ...settings, ...d.settings };
  } catch {}
  $("topup-amount").placeholder = t("topup_amount_ph", { min: settings.min_topup || 500 });
  $("btn-topup").textContent = t("btn_topup", { num: settings.jazzcash_number || "03266040350" });
  $("topup-note").textContent = t("topup_note", { num: settings.jazzcash_number || "03266040350" });
  // Session restore: driver stays, rider is redirected, guest sees the login card.
  try {
    const d = await api("/api/auth/me");
    if (d.user) {
      if (d.user.role === "rider") { location.href = "/rider"; return; }
      try {
        const prof = await api(`/api/drivers/${d.user.id}`);
        // Keep the USER id: prof.driver.id is the driver-profile row id.
        store.driver = { ...d.user, ...prof.driver, id: d.user.id };
        afterLogin();
      } catch { /* logged-in user without a driver profile: show login + registration */ }
    }
  } catch {}
}
boot();
