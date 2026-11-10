// Chunian Ride — shared frontend code (loaded first by rider.html and driver.html).
// Common: api(), toast, i18n (STRINGS + t()), helpers, map helpers.
// No admin code lives here — admin is a separate page (admin.js).
const $ = (id) => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

// ---------- i18n ----------
const STRINGS = {
  en: {
    app_name: "Chunian Ride", tagline: "Chunian • Pattoki • Kasur • Lahore",
    nav_home: "Home", nav_rides: "Rides", nav_wallet: "Wallet", nav_profile: "Profile", nav_requests: "Requests",
    lang_toggle: "اردو", lang_name: "English",
    hero_title: "Chunian's own ride service", hero_sub: "Bike • Rickshaw • Car • AC Car — negotiated fare, cash payment, low commission.",
    hero_cta_rider: "Book a ride", hero_cta_rider_sub: "Rider — book Bike, Rickshaw, Car or AC Car",
    hero_cta_driver: "Drive & earn", hero_cta_driver_sub: "Driver — take rides and earn",
    owner_admin: "Owner / Admin", emergency: "Emergency: Police 15 • Rescue 1122",
    footer_about: "Chunian Ride — inDrive-style ride booking for Chunian, Tehsil Chunian, District Kasur. Bike, rickshaw, car and AC car. Cash payment, negotiated fares.",
    footer_note: "Uber stopped in Pakistan on 30 Apr 2024 and Careem ride-hailing on 18 Jul 2025 — this is a local inDrive-style service.",
    login_title: "Login", signup_title: "Login / Signup",
    rider_login_sub: "Login with phone + password. First time? Enter your name + phone + password — your account will be created.",
    driver_login_sub: "Login with your driver phone + password.",
    name_ph: "Your name", phone_ph: "Phone — e.g. 03XX-XXXXXXX", password_ph: "Password (at least 6 characters)",
    btn_signup: "Sign up", btn_login: "Login", btn_logout: "Logout",
    err_name_phone_pw: "Please enter your name, phone and password.",
    err_phone_pw: "Please enter your phone and password.",
    hello: "Hello", your_id: "Your ID",
    welcome_back: "Welcome back",
    where_to_go: "Where to go?", pickup_label: "Pickup — where from?", dest_label: "Destination — where to?",
    current_location: "Current location (GPS)", use_my_location: "📍 Use my location",
    gps_ok: "Your location found — distance calculated to the destination.",
    gps_denied: "Location permission not given — please allow location in your phone settings.",
    gps_unavailable: "Location is not available on this phone.",
    gps_waiting: "Finding your location…",
    vehicle_label: "Choose your ride", bike: "Bike", rickshaw: "Rickshaw", car: "Car", ac_car: "AC Car",
    per_km: "Rs {rate}/km", min_fare: "min Rs {min}",
    fare_estimate: "Suggested fare", fare_distance: "{km} km, Rs {per_km}/km (minimum Rs {min})",
    fare_estimated_note: "distance is estimated", fare_unknown: "Please choose a destination first.",
    offer_label: "Offer your fare (Rs)", offer_hint: "The driver can accept or counter-offer. The suggested fare is filled in for you.",
    book_later: "🕐 Book for later (optional)", book_later_hint: "Leave empty for a ride now. Choose a date + time to schedule up to 7 days ahead.",
    sched_both: "For a scheduled ride, please give both a date and a time.",
    sched_past: "The scheduled time must be in the future.",
    sched_7d: "You can only book up to 7 days ahead.",
    sched_bad: "The date/time is not valid.",
    find_driver: "Find a driver", finding_driver: "Finding a driver…",
    ride_requested: "Ride request sent (Ride #{id}) — {n} driver(s) online.",
    ride_requested_sched: "Ride request sent (Ride #{id}) — Scheduled: {when}.",
    recent_dest: "Recent destinations", no_recent: "No recent destinations yet.",
    driver_offers: "Driver offers", offers_hint: "Choose an offer — compare fare, driver, vehicle, rating and ETA.",
    no_offers: "No pending offers yet — a driver may counter-offer. Please wait a moment.",
    choose_driver: "Choose this driver — Accept", eta_min: "ETA ~{min} min",
    driver_accepted: "Driver accepted — agreed fare Rs {fare}. Your driver is on the way.",
    live_trip: "Your ride", trip_cash: "Pay cash to the driver.", cash_confirmed: "✅ Cash confirmed.",
    trip_done: "✅ Ride complete — thank you!", status: "Status", fare: "Fare",
    offered: "you offered Rs {fare}",
    driver_live: "📍 Driver live location", driver_live_dist: " • {km} km from {place}, ETA ~{min} min",
    driver_loc_missing: "📍 Driver's live location is not available — the driver has not shared location or GPS is off.",
    share_trip: "🔗 Share trip", sos: "🆘 SOS", cancel: "Cancel",
    share_copied: "Trip details copied.", no_active_ride: "No active ride.",
    sos_sent: "SOS sent — help has been alerted.", ride_cancelled: "Ride cancelled.",
    chat_title: "Chat with driver", chat_title_driver: "Chat with rider",
    chat_note: "Only for this ride — phone numbers are not shared.",
    chat_empty: "No messages yet.", chat_ph: "Write a message…", btn_send: "Send",
    rate_driver: "Rate the driver", rating_saved: "Thank you! Your rating has been saved.",
    tip_title: "💰 Give a tip — thank your driver", tip_note: "The tip goes 100% to the driver — no commission is charged on it.",
    tip_custom_ph: "Your own tip amount (Rs)", btn_tip: "Give tip",
    tip_saved: "Thank you! Tip Rs {tip} given to the driver — no commission was charged on it.",
    tip_enter: "Please enter a tip amount.", tip_once: "Tip already given.",
    history_title: "My rides — history & receipts", btn_history: "Show history",
    no_rides: "No rides found.", platform_fee: "Platform fee Rs {fee}",
    wallet_title: "Wallet", balance: "Balance", transactions: "Transactions",
    wallet_unavailable: "Wallet is not available yet — please try again later.",
    no_tx: "No transactions yet.",
    profile_title: "Profile", rating: "Rating", documents: "Documents", vehicle: "Vehicle",
    docs_pending: "Pending approval", docs_approved: "Approved",
    change_pw: "Change password", current_pw_ph: "Current password", new_pw_ph: "New password (at least 6 characters)",
    btn_change_pw: "Change password", pw_changed: "Password changed.",
    err_pw_both: "Please enter both the current and the new password.",
    support: "Support", police: "Police 15", rescue: "Rescue 1122",
    support_owner: "Owner support", not_set: "Not set",
    language: "Language",
    rates_title: "Our rates — live fares", rates_note: "Per-km rate with minimum fare. The rider can offer a fare — the driver can accept or counter-offer.",
    rates_loading: "Loading rates…",
    // Driver
    driver_home: "Driver dashboard", status_card: "Your status",
    online: "Online", offline: "Offline", go_online: "Go Online", go_offline: "Go Offline",
    loc_sharing: "📍 Live location is being shared",
    loc_sharing_on: "📍 Live location sharing is on",
    wallet: "Wallet", earnings: "Earnings", today: "Today", days_7: "7 days",
    earnings_line: "{label}: {rides} rides • Gross fares Rs {gross} • Platform fees Rs {fees} • Tips Rs {tips} (100% driver, no commission) • You kept: Rs {kept}",
    requests_title: "Ride requests", no_requests: "No open requests.",
    rider_offer: "Rider offer", suggested: "suggested Rs {fare}",
    accept_offer: "Accept (rider's offer)", counter_ph: "Counter-offer Rs", btn_counter: "Counter-offer",
    decline: "Decline (no penalty)", counter_sent: "Counter-offer sent.", declined: "Declined — no penalty.",
    no_pending_offer: "Your pending offer was not found — please send a counter-offer first or refresh.",
    ride_accepted_driver: "Ride accepted — fare Rs {fare}. Go to the pickup.",
    counter_enter: "Please enter a counter fare.",
    start_trip: "Start trip", end_trip: "End trip — confirm cash", cash_received: "I received the cash",
    cash_tick_first: "Please tick 'I received the cash' first — a trip cannot end without cash confirmation.",
    trip_started: "Trip started.",
    trip_completed: "Trip complete! Fare Rs {fare}, platform fee Rs {fee} (commission {pct}% + Rs {booking} fee). You kept Rs {kept}. Wallet balance: Rs {balance}.",
    rate_rider_5: "Give the rider 5⭐", rider_rated: "You gave the rider 5 stars.",
    topup_title: "Top-up — prepaid wallet", topup_amount_ph: "Top-up amount (Rs) — minimum Rs {min}",
    topup_tid_ph: "JazzCash TID (transaction ID)",
    btn_topup: "Send top-up request — send payment to JazzCash {num}",
    topup_note: "Send the payment to JazzCash {num}, then write the TID here. Your balance will only increase after the owner verifies the TID and approves it — a fake TID gives no balance. Sadapay number is set by the owner (Admin settings).",
    topup_history: "Top-up requests", topup_sent: "Top-up request #{id} sent (Rs {amount}) — status: pending. Your balance will only increase after the owner verifies the TID and approves it.",
    topup_enter_amount: "Please enter an amount.",
    register_title: "Driver registration — new driver",
    register_sub: "CNIC, driving licence and vehicle registration are required. The owner will approve.",
    model_ph: "Vehicle model — e.g. Honda CD 70", plate_ph: "Number plate",
    cnic_ph: "CNIC — e.g. 35202-1234567-1", licence_ph: "Driving licence number", vehreg_ph: "Vehicle registration number",
    btn_register: "Register", reg_submitted: "Registration submitted — status: {status}. The owner will approve.",
    err_reg_fields: "Please enter your name, phone and password.",
    my_rides: "My rides", new_driver: "New driver",
    doc_status: "Document status", driver_details: "Driver & vehicle details",
    map_hint: "Tap the map — pickup first, then destination.",
    err_login_first: "Please sign up / log in first.",
    err_generic: "Something went wrong. Please try again.",
    loading: "Loading…", retry: "Retry",
    scheduled: "Scheduled", distance_km: "{km} km",
    new_driver_label: "New driver", new_rider_label: "New rider",
    // Promo (v2.1)
    promo_label: "Promo code (optional)", promo_ph: "e.g. CHUNIAN10",
    promo_applied: "Promo {code} applied — discount Rs {discount}",
    fare_base: "Base fare Rs {base}", fare_discount: "Discount Rs {discount}",
    // Notifications (v2.1)
    notif_title: "Notifications", notif_empty: "No notifications yet.",
    notif_mark_all: "Mark all read",
    // Withdrawals (v2.1)
    withdraw_title: "Withdraw — driver earnings",
    withdraw_amount_ph: "Withdrawal amount (Rs) — minimum Rs {min}",
    withdraw_jazzcash_ph: "Your JazzCash number",
    withdraw_note: "The amount is held from your wallet when you request. The owner pays manually to your JazzCash and approves — if rejected, the hold is refunded automatically.",
    withdraw_btn: "Request withdrawal",
    withdraw_sent: "Withdrawal request #{id} sent (Rs {amount}) — status: pending. The amount is held from your wallet.",
    withdraw_history: "Withdrawal requests",
    withdraw_enter_amount: "Please enter an amount.",
    withdraw_enter_number: "Please enter your JazzCash number.",
    withdraw_min: "Minimum withdrawal is Rs {min}.",
    withdraw_exceeds: "Withdrawal is more than your wallet balance.",
    // Documents — photo upload (v2.1; vehicle document added in v2.2)
    docs_title: "Documents — photo upload",
    docs_note: "Upload clear photos of your CNIC (front + back), driving licence and vehicle registration document. Photos are stored securely and only the owner can see them. All three are required before your account can be approved.",
    doc_cnic_front: "CNIC — front", doc_cnic_back: "CNIC — back", doc_cnic: "CNIC", doc_licence: "Driving licence", doc_vehicle: "Vehicle registration document", doc_other: "Other document",
    doc_upload: "Upload photo",
    doc_uploaded: "{doc} uploaded — status: pending approval.",
    doc_approved: "Approved", doc_rejected: "Rejected — please re-upload", doc_pending: "Pending approval",
    doc_too_large: "Photo is too large — max 1.5 MB after compression.",
    doc_bad_type: "Only JPG or PNG photos are allowed.",
    docs_checklist: "Verification: CNIC {cnic} • Licence {licence} • Vehicle {vehicle}",
    docs_checklist_ok: "✓",
    docs_checklist_no: "✗",
    pilot_only_note: "Pilot phase: rides are Chunian City only — intercity rides are not available yet.",
    // v2.3 — request cards, GPS states, calls, complaints, top-up picker, push
    new_request: "NEW RIDE REQUEST",
    offer_expires_in: "Expires in {time}",
    countdown_expired: "Expired",
    pickup_dist: "{km} km away",
    pickup_eta: "ETA ~{min} min",
    estimated_badge: "estimated",
    trip_duration: "{km} km • ~{min} min",
    more_requests: "{n} more requests nearby",
    no_my_offer: "You have no pending offer on this ride.",
    gps_last_update: "GPS updated {time}",
    gps_accuracy: "±{m} m",
    gps_off_banner: "Location is off — turn on GPS to receive requests.",
    gps_denied_banner: "Location permission denied — allow location in your phone settings to receive requests.",
    gps_weak_banner: "Weak GPS signal — move outdoors for a better fix.",
    gps_retry: "Retry GPS",
    gps_settings_hint: "Open your phone Settings → Location → allow Chunian Ride.",
    call_btn: "📞 Call",
    call_incoming: "Incoming call…",
    call_accept: "Accept call",
    call_reject: "Reject",
    call_mute: "Mute",
    call_unmute: "Unmute",
    call_end: "End call",
    call_no_answer: "No answer — the other person did not pick up.",
    call_ended: "Call ended.",
    call_connecting: "Calling…",
    call_in_call: "On call",
    call_failed: "Call could not start — check microphone permission and try again.",
    call_only_active: "Calls are only available during an active ride.",
    nav_pickup: "Navigate to pickup",
    nav_dest: "Navigate to destination",
    nav_route_direct: "Direct route (estimated — not road distance)",
    nav_route_road: "Road route",
    nav_osrm_failed: "Road route unavailable — showing a direct line instead.",
    complaint_title: "Report a problem with this ride",
    complaint_ph: "Describe the problem…",
    complaint_btn: "Send complaint",
    complaint_sent: "Complaint sent — the owner will review it.",
    complaint_enter: "Please write what happened first.",
    topup_method: "Payment method",
    method_jazzcash: "JazzCash",
    method_sadapay: "Sadapay",
    sadapay_not_set: "Sadapay number abhi set nahi — owner se rabta karein",
    topup_tid_ph_sadapay: "Sadapay TID (transaction ID)",
    btn_topup_method: "Send top-up request — send payment to {method} {num}",
    topup_note_method: "Send the payment to {method} {num}, then write the TID here. Your balance will only increase after the owner verifies the TID and approves it — a fake TID gives no balance.",
    support_whatsapp: "WhatsApp support",
    push_title: "Notifications (push)",
    push_subscribed: "Push notifications: ON",
    push_not_subscribed: "Push notifications: OFF",
    push_not_supported: "Push notifications are not supported on this device/browser.",
    push_enable: "Turn on push notifications",
    push_disable: "Turn off push notifications",
    push_denied: "Notifications are blocked — allow them in your browser/phone settings.",
    agreed_fare_label: "Agreed fare",
    chat_unread: "{n} new",
    gps_pickup_failed: "GPS pickup failed — using {place} as pickup instead.",
    nav_external_gmaps: "Open in Google Maps",
    nav_external_osm: "Open in OpenStreetMap",
    google_continue: "Continue with Google",
    google_coming_soon: "Google login jald aa raha hai",
    google_update_app: "Google login ke liye app ko v2.5 par update karein",
    google_phone_title: "Apna phone number likhein",
    google_phone_sub: "Pilot check ke liye phone number chahiye. Naya account hai to password khali chhor dein — purana account hai to uska password likhein, Google us se link ho jayega.",
    google_continue_btn: "Continue",
    google_account_label: "Google account",
    back_to_login: "Back to login",
    settings_title: "Settings",
  },
  ur: {
    app_name: "چونیاں رائیڈ", tagline: "چونیاں • پتوکی • قصور • لاہور",
    nav_home: "ہوم", nav_rides: "رائڈز", nav_wallet: "والیٹ", nav_profile: "پروفائل", nav_requests: "درخواستیں",
    lang_toggle: "English", lang_name: "اردو",
    hero_title: "چونیاں کی اپنی رائیڈ سروس", hero_sub: "بائیک • رکشہ • کار • اے سی کار — طے شدہ کرایہ، نقد ادائیگی، کم کمیشن۔",
    hero_cta_rider: "سواری بک کریں", hero_cta_rider_sub: "رائیڈر — بائیک، رکشہ، کار یا اے سی کار بک کریں",
    hero_cta_driver: "چلائیں اور کمائیں", hero_cta_driver_sub: "ڈرائیور — رائیڈز لیں اور کمائیں",
    owner_admin: "مالک / ایڈمن", emergency: "ایمرجنسی: پولیس 15 • ریسکیو 1122",
    footer_about: "چونیاں رائیڈ — چونیاں، تحصیل چونیاں، ضلع قصور کے لیے ان ڈرائیو طرز کی رائیڈ بکنگ۔ بائیک، رکشہ، کار اور اے سی کار۔ نقد ادائیگی، طے شدہ کرایہ۔",
    footer_note: "اوبر پاکستان میں 30 اپریل 2024 سے بند ہے اور کریم رائیڈ ہیلنگ 18 جولائی 2025 سے بند — یہ مقامی ان ڈرائیو طرز کی سروس ہے۔",
    login_title: "لاگ ان", signup_title: "لاگ ان / سائن اپ",
    rider_login_sub: "فون + پاس ورڈ سے لاگ ان کریں۔ پہلی بار؟ نام + فون + پاس ورڈ لکھیں — آپ کا اکاؤنٹ بن جائے گا۔",
    driver_login_sub: "اپنے ڈرائیور فون + پاس ورڈ سے لاگ ان کریں۔",
    name_ph: "آپ کا نام", phone_ph: "فون — مثلاً 03XX-XXXXXXX", password_ph: "پاس ورڈ (کم از کم 6 حروف)",
    btn_signup: "سائن اپ", btn_login: "لاگ ان", btn_logout: "لاگ آؤٹ",
    err_name_phone_pw: "براہ کرم نام، فون اور پاس ورڈ تینوں لکھیں۔",
    err_phone_pw: "براہ کرم فون اور پاس ورڈ لکھیں۔",
    hello: "السلام علیکم", your_id: "آپ کی آئی ڈی",
    welcome_back: "خوش آمدید",
    where_to_go: "کہاں جانا ہے؟", pickup_label: "پک اپ — کہاں سے؟", dest_label: "منزل — کہاں جانا ہے؟",
    current_location: "موجودہ مقام (جی پی ایس)", use_my_location: "📍 میری لوکیشن استعمال کریں",
    gps_ok: "آپ کی لوکیشن مل گئی — منزل تک فاصلہ نکال لیا گیا۔",
    gps_denied: "لوکیشن کی اجازت نہیں ملی — فون کی سیٹنگز میں لوکیشن آن کریں۔",
    gps_unavailable: "اس فون پر لوکیشن دستیاب نہیں ہے۔",
    gps_waiting: "آپ کی لوکیشن تلاش کی جا رہی ہے…",
    vehicle_label: "سواری چنیں", bike: "بائیک", rickshaw: "رکشہ", car: "کار", ac_car: "اے سی کار",
    per_km: "روپے {rate}/کلومیٹر", min_fare: "کم از کم روپے {min}",
    fare_estimate: "تجویز کردہ کرایہ", fare_distance: "{km} کلومیٹر، روپے {per_km}/کلومیٹر (کم از کم روپے {min})",
    fare_estimated_note: "فاصلہ اندازاً ہے", fare_unknown: "پہلے منزل چنیں۔",
    offer_label: "اپنا کرایہ بتائیں (روپے)", offer_hint: "ڈرائیور قبول کر سکتا ہے یا جوابی پیشکش دے سکتا ہے۔ تجویز کردہ کرایہ آپ کے لیے بھر دیا گیا ہے۔",
    book_later: "🕐 بعد کے لیے بک کریں (اختیاری)", book_later_hint: "ابھی کی رائیڈ کے لیے خالی چھوڑ دیں۔ 7 دن تک آگے کی تاریخ + وقت چنیں۔",
    sched_both: "شیڈول رائیڈ کے لیے تاریخ اور وقت دونوں دیں۔",
    sched_past: "شیڈول وقت آنے والا وقت ہونا چاہیے۔",
    sched_7d: "صرف 7 دن تک کی بکنگ ہو سکتی ہے۔",
    sched_bad: "تاریخ/وقت درست نہیں ہے۔",
    find_driver: "ڈرائیور تلاش کریں", finding_driver: "ڈرائیور تلاش کیا جا رہا ہے…",
    ride_requested: "رائڈ درخواست بھیج دی گئی (رائڈ #{id}) — {n} ڈرائیور آن لائن ہیں۔",
    ride_requested_sched: "رائڈ درخواست بھیج دی گئی (رائڈ #{id}) — شیڈول: {when}۔",
    recent_dest: "حالیہ منزلیں", no_recent: "ابھی کوئی حالیہ منزل نہیں۔",
    driver_offers: "ڈرائیورز کی پیشکشیں", offers_hint: "پیشکش چنیں — کرایہ، ڈرائیور، گاڑی، ریٹنگ اور وقت دیکھ کر۔",
    no_offers: "ابھی کوئی زیر التوا پیشکش نہیں — ڈرائیور جوابی پیشکش دے سکتا ہے، تھوڑی دیر بعد دیکھیں۔",
    choose_driver: "یہ ڈرائیور چنیں — قبول کریں", eta_min: "تقریباً {min} منٹ",
    driver_accepted: "ڈرائیور قبول ہو گیا — طے شدہ کرایہ روپے {fare}۔ ڈرائیور آ رہا ہے۔",
    live_trip: "آپ کی رائیڈ", trip_cash: "نقد رقم ڈرائیور کو دیں۔", cash_confirmed: "✅ نقد رقم کی تصدیق ہو گئی۔",
    trip_done: "✅ رائیڈ مکمل — شکریہ!", status: "حالت", fare: "کرایہ",
    offered: "آپ نے روپے {fare} کی پیشکش کی تھی",
    driver_live: "📍 ڈرائیور کی لائیو لوکیشن", driver_live_dist: " • {place} سے {km} کلومیٹر دور، تقریباً {min} منٹ",
    driver_loc_missing: "📍 ڈرائیور کی لائیو لوکیشن نہیں مل رہی — ڈرائیور نے لوکیشن شیئر نہیں کی یا جی پی ایس بند ہے۔",
    share_trip: "🔗 ٹرپ شیئر کریں", sos: "🆘 ایس او ایس", cancel: "منسوخ کریں",
    share_copied: "ٹرپ کی تفصیل کاپی ہو گئی۔", no_active_ride: "کوئی فعال رائیڈ نہیں۔",
    sos_sent: "ایس او ایس بھیج دیا گیا — مدد کو اطلاع دے دی گئی۔", ride_cancelled: "رائڈ منسوخ ہو گئی۔",
    chat_title: "ڈرائیور سے چیٹ", chat_title_driver: "رائیڈر سے چیٹ",
    chat_note: "صرف اس رائیڈ کے لیے — فون نمبر شیئر نہیں ہوتا۔",
    chat_empty: "ابھی کوئی پیغام نہیں۔", chat_ph: "پیغام لکھیں…", btn_send: "بھیجیں",
    rate_driver: "ڈرائیور کو ریٹ کریں", rating_saved: "شکریہ! ریٹنگ محفوظ ہو گئی۔",
    tip_title: "💰 ٹپ دیں — ڈرائیور کا شکریہ", tip_note: "ٹپ 100% ڈرائیور کو ملتی ہے — اس پر کوئی کمیشن نہیں کٹتا۔",
    tip_custom_ph: "اپنی مرضی کی ٹپ (روپے)", btn_tip: "ٹپ دیں",
    tip_saved: "شکریہ! ٹپ روپے {tip} ڈرائیور کو مل گئی — اس پر کوئی کمیشن نہیں کٹی۔",
    tip_enter: "براہ کرم ٹپ کی رقم لکھیں۔", tip_once: "ٹپ پہلے ہی دی جا چکی ہے۔",
    history_title: "میری رائیڈز — ہسٹری اور رسیدیں", btn_history: "ہسٹری دیکھیں",
    no_rides: "کوئی رائیڈ نہیں ملی۔", platform_fee: "پلیٹ فارم فیس روپے {fee}",
    wallet_title: "والیٹ", balance: "بیلنس", transactions: "لین دین",
    wallet_unavailable: "والیٹ ابھی دستیاب نہیں — براہ کرم بعد میں دوبارہ کوشش کریں۔",
    no_tx: "ابھی کوئی لین دین نہیں۔",
    profile_title: "پروفائل", rating: "ریٹنگ", documents: "دستاویزات", vehicle: "گاڑی",
    docs_pending: "منظوری زیر التوا", docs_approved: "منظور شدہ",
    change_pw: "پاس ورڈ بدلیں", current_pw_ph: "موجودہ پاس ورڈ", new_pw_ph: "نیا پاس ورڈ (کم از کم 6 حروف)",
    btn_change_pw: "پاس ورڈ بدلیں", pw_changed: "پاس ورڈ بدل گیا۔",
    err_pw_both: "براہ کرم موجودہ اور نیا پاس ورڈ دونوں لکھیں۔",
    support: "مدد", police: "پولیس 15", rescue: "ریسکیو 1122",
    support_owner: "مالک سے رابطہ", not_set: "سیٹ نہیں ہے",
    language: "زبان",
    rates_title: "ہمارے کرایے — لائیو ریٹ", rates_note: "فی کلومیٹر ریٹ اور کم از کم کرایہ۔ رائیڈر اپنا کرایہ بتا سکتا ہے — ڈرائیور قبول کر سکتا ہے یا جوابی پیشکش دے سکتا ہے۔",
    rates_loading: "کرایے لوڈ ہو رہے ہیں…",
    driver_home: "ڈرائیور ڈیش بورڈ", status_card: "آپ کی حالت",
    online: "آن لائن", offline: "آف لائن", go_online: "آن لائن ہوں", go_offline: "آف لائن ہوں",
    loc_sharing: "📍 لائیو لوکیشن شیئر ہو رہی ہے",
    loc_sharing_on: "📍 لائیو لوکیشن شیئرنگ آن ہے",
    wallet: "والیٹ", earnings: "کمائی", today: "آج", days_7: "7 دن",
    earnings_line: "{label}: {rides} رائیڈز • کل کرایہ روپے {gross} • پلیٹ فارم فیس روپے {fees} • ٹپس روپے {tips} (100% ڈرائیور، کوئی کمیشن نہیں) • آپ نے رکھا: روپے {kept}",
    requests_title: "رائڈ کی درخواستیں", no_requests: "کوئی کھلی درخواست نہیں۔",
    rider_offer: "رائیڈر کی پیشکش", suggested: "تجویز کردہ روپے {fare}",
    accept_offer: "قبول کریں (رائیڈر کی پیشکش)", counter_ph: "جوابی پیشکش روپے", btn_counter: "جوابی پیشکش",
    decline: "انکار کریں (کوئی جرمانہ نہیں)", counter_sent: "جوابی پیشکش بھیج دی گئی۔", declined: "انکار ہو گیا — کوئی جرمانہ نہیں۔",
    no_pending_offer: "آپ کی زیر التوا پیشکش نہیں ملی — پہلے جوابی پیشکش بھیجیں یا ریفریش کریں۔",
    ride_accepted_driver: "رائڈ قبول ہو گئی — کرایہ روپے {fare}۔ پک اپ پر جائیں۔",
    counter_enter: "براہ کرم جوابی کرایہ لکھیں۔",
    start_trip: "ٹرپ شروع کریں", end_trip: "ٹرپ ختم کریں — نقد تصدیق", cash_received: "نقد رقم مل گئی",
    cash_tick_first: "پہلے 'نقد رقم مل گئی' پر ٹک کریں — نقد تصدیق کے بغیر ٹرپ ختم نہیں ہو سکتا۔",
    trip_started: "ٹرپ شروع ہو گیا۔",
    trip_completed: "ٹرپ مکمل! کرایہ روپے {fare}، پلیٹ فارم فیس روپے {fee} (کمیشن {pct}% + روپے {booking} فیس)۔ آپ نے رکھا روپے {kept}۔ والیٹ بیلنس: روپے {balance}۔",
    rate_rider_5: "رائیڈر کو 5⭐ دیں", rider_rated: "آپ نے رائیڈر کو 5 ستارے دیے۔",
    topup_title: "ٹاپ اپ — پری پیڈ والیٹ", topup_amount_ph: "ٹاپ اپ رقم (روپے) — کم از کم روپے {min}",
    topup_tid_ph: "جاز کیش ٹی آئی ڈی (ٹرانزیکشن آئی ڈی)",
    btn_topup: "ٹاپ اپ درخواست بھیجیں — جاز کیش {num} پر ادائیگی بھیجیں",
    topup_note: "جاز کیش {num} پر ادائیگی بھیجیں، پھر ٹی آئی ڈی یہاں لکھیں۔ بیلنس تب ہی بڑھے گا جب مالک ٹی آئی ڈی کی تصدیق کر کے منظور کرے گا — جعلی ٹی آئی ڈی سے بیلنس نہیں ملتا۔ سدا پے نمبر مالک سیٹ کرے گا (ایڈمن سیٹنگز)۔",
    topup_history: "ٹاپ اپ درخواستیں", topup_sent: "ٹاپ اپ درخواست #{id} بھیج دی گئی (روپے {amount}) — حالت: زیر التوا۔ بیلنس تب ہی بڑھے گا جب مالک ٹی آئی ڈی کی تصدیق کر کے منظور کرے گا۔",
    topup_enter_amount: "براہ کرم رقم لکھیں۔",
    register_title: "ڈرائیور رجسٹریشن — نیا ڈرائیور",
    register_sub: "شناختی کارڈ، ڈرائیونگ لائسنس اور گاڑی کی رجسٹریشن ضروری ہے۔ مالک منظور کرے گا۔",
    model_ph: "گاڑی / بائیک کا ماڈل — مثلاً ہونڈا سی ڈی 70", plate_ph: "نمبر پلیٹ",
    cnic_ph: "شناختی کارڈ — مثلاً 35202-1234567-1", licence_ph: "ڈرائیونگ لائسنس نمبر", vehreg_ph: "گاڑی کی رجسٹریشن نمبر",
    btn_register: "رجسٹر کریں", reg_submitted: "رجسٹریشن جمع ہو گئی — حالت: {status}۔ مالک منظور کرے گا۔",
    err_reg_fields: "براہ کرم نام، فون اور پاس ورڈ لکھیں۔",
    my_rides: "میری رائیڈز", new_driver: "نیا ڈرائیور",
    doc_status: "دستاویزات کی حالت", driver_details: "ڈرائیور اور گاڑی کی تفصیل",
    map_hint: "نقشے پر ٹیپ کریں — پہلے پک اپ، پھر منزل۔",
    err_login_first: "پہلے سائن اپ / لاگ ان کریں۔",
    err_generic: "کچھ غلط ہو گیا۔ براہ کرم دوبارہ کوشش کریں۔",
    loading: "لوڈ ہو رہا ہے…", retry: "دوبارہ کوشش کریں",
    scheduled: "شیڈول", distance_km: "{km} کلومیٹر",
    new_driver_label: "نیا ڈرائیور", new_rider_label: "نیا رائیڈر",
    // Promo (v2.1)
    promo_label: "پرومو کوڈ (اختیاری)", promo_ph: "مثلاً CHUNIAN10",
    promo_applied: "پرومو {code} لگ گیا — ڈسکاؤنٹ روپے {discount}",
    fare_base: "اصل کرایہ روپے {base}", fare_discount: "ڈسکاؤنٹ روپے {discount}",
    // Notifications (v2.1)
    notif_title: "اطلاعات", notif_empty: "ابھی کوئی اطلاع نہیں۔",
    notif_mark_all: "سب پڑھی ہوئی کریں",
    // Withdrawals (v2.1)
    withdraw_title: "نکالنا — ڈرائیور کی کمائی",
    withdraw_amount_ph: "نکالنے کی رقم (روپے) — کم از کم روپے {min}",
    withdraw_jazzcash_ph: "آپ کا جاز کیش نمبر",
    withdraw_note: "درخواست پر رقم آپ کے والیٹ سے روک لی جاتی ہے۔ مالک آپ کے جاز کیش پر دستی ادائیگی کر کے منظور کرے گا — مسترد ہونے پر رقم خودبخود واپس آ جائے گی۔",
    withdraw_btn: "نکالنے کی درخواست بھیجیں",
    withdraw_sent: "نکالنے کی درخواست #{id} بھیج دی گئی (روپے {amount}) — حالت: زیر التواء۔ رقم آپ کے والیٹ سے روک لی گئی ہے۔",
    withdraw_history: "نکالنے کی درخواستیں",
    withdraw_enter_amount: "براہ کرم رقم لکھیں۔",
    withdraw_enter_number: "براہ کرم اپنا جاز کیش نمبر لکھیں۔",
    withdraw_min: "کم از کم نکالنا روپے {min} ہے۔",
    withdraw_exceeds: "نکالنے کی رقم آپ کے والیٹ بیلنس سے زیادہ ہے۔",
    // Documents — photo upload (v2.1)
    docs_title: "دستاویزات — تصویر اپ لوڈ کریں",
    docs_note: "اپنے شناختی کارڈ (سامنے + پیچھے)، ڈرائیونگ لائسنس اور گاڑی کی رجسٹریشن دستاویز کی واضح تصویریں اپ لوڈ کریں۔ تصویریں محفوظ طریقے سے رکھی جاتی ہیں اور صرف مالک دیکھ سکتا ہے۔ اکاؤنٹ منظور ہونے سے پہلے تینوں ضروری ہیں۔",
    doc_cnic_front: "شناختی کارڈ — سامنے", doc_cnic_back: "شناختی کارڈ — پیچھے", doc_cnic: "شناختی کارڈ", doc_licence: "ڈرائیونگ لائسنس", doc_vehicle: "گاڑی کی رجسٹریشن دستاویز", doc_other: "دیگر دستاویز",
    doc_upload: "تصویر اپ لوڈ کریں",
    doc_uploaded: "{doc} اپ لوڈ ہو گئی — حالت: منظوری زیر التواء۔",
    doc_approved: "منظور شدہ", doc_rejected: "مسترد — دوبارہ اپ لوڈ کریں", doc_pending: "منظوری زیر التواء",
    doc_too_large: "تصویر بہت بڑی ہے — کمپریشن کے بعد زیادہ سے زیادہ 1.5 MB۔",
    doc_bad_type: "صرف JPG یا PNG تصویر چلتی ہے۔",
    docs_checklist: "تصدیق: شناختی کارڈ {cnic} • لائسنس {licence} • گاڑی {vehicle}",
    docs_checklist_ok: "✓",
    docs_checklist_no: "✗",
    pilot_only_note: "پائلٹ مرحلہ: صرف چونیاں شہر کی رائیڈز — بین شہر رائیڈز ابھی بند ہیں۔",
    // v2.3 — request cards, GPS states, calls, complaints, top-up picker, push
    new_request: "نئی رائیڈ درخواست",
    offer_expires_in: "{time} میں ختم ہوگی",
    countdown_expired: "ختم ہو گئی",
    pickup_dist: "{km} کلومیٹر دور",
    pickup_eta: "تقریباً {min} منٹ",
    estimated_badge: "اندازاً",
    trip_duration: "{km} کلومیٹر • تقریباً {min} منٹ",
    more_requests: "{n} مزید درخواستیں قریب ہیں",
    no_my_offer: "اس رائیڈ پر آپ کی کوئی زیر التوا پیشکش نہیں۔",
    gps_last_update: "جی پی ایس اپ ڈیٹ {time}",
    gps_accuracy: "±{m} میٹر",
    gps_off_banner: "لوکیشن بند ہے — درخواستیں لینے کے لیے جی پی ایس آن کریں۔",
    gps_denied_banner: "لوکیشن کی اجازت نہیں ملی — فون کی سیٹنگز میں لوکیشن کی اجازت دیں۔",
    gps_weak_banner: "جی پی ایس سگنل کمزور ہے — بہتر سگنل کے لیے باہر جائیں۔",
    gps_retry: "دوبارہ کوشش کریں",
    gps_settings_hint: "فون کی سیٹنگز → لوکیشن کھولیں → چونیاں رائیڈ کو اجازت دیں۔",
    call_btn: "📞 کال کریں",
    call_incoming: "کال آ رہی ہے…",
    call_accept: "کال قبول کریں",
    call_reject: "مسترد کریں",
    call_mute: "خاموش کریں",
    call_unmute: "آواز کھولیں",
    call_end: "کال ختم کریں",
    call_no_answer: "کوئی جواب نہیں — دوسرے شخص نے کال نہیں اٹھائی۔",
    call_ended: "کال ختم ہو گئی۔",
    call_connecting: "کال ہو رہی ہے…",
    call_in_call: "کال جاری ہے",
    call_failed: "کال شروع نہیں ہو سکی — مائیک کی اجازت دیکھ کر دوبارہ کوشش کریں۔",
    call_only_active: "کال صرف فعال رائیڈ کے دوران ہو سکتی ہے۔",
    nav_pickup: "پک اپ تک جائیں",
    nav_dest: "منزل تک جائیں",
    nav_route_direct: "سیدھا راستہ (اندازاً — سڑک کا فاصلہ نہیں)",
    nav_route_road: "سڑک کا راستہ",
    nav_osrm_failed: "سڑک کا راستہ نہیں ملا — سیدھی لکیر دکھائی جا رہی ہے۔",
    complaint_title: "اس رائیڈ کی شکایت کریں",
    complaint_ph: "مسئلہ بتائیں…",
    complaint_btn: "شکایت بھیجیں",
    complaint_sent: "شکایت بھیج دی گئی — مالک جائزہ لے گا۔",
    complaint_enter: "پہلے مسئلہ لکھیں۔",
    topup_method: "ادائیگی کا طریقہ",
    method_jazzcash: "جاز کیش",
    method_sadapay: "سدا پے",
    sadapay_not_set: "Sadapay number abhi set nahi — owner se rabta karein",
    topup_tid_ph_sadapay: "سدا پے ٹی آئی ڈی (ٹرانزیکشن آئی ڈی)",
    btn_topup_method: "ٹاپ اپ درخواست بھیجیں — {method} {num} پر ادائیگی بھیجیں",
    topup_note_method: "{method} {num} پر ادائیگی بھیجیں، پھر ٹی آئی ڈی یہاں لکھیں۔ بیلنس تب ہی بڑھے گا جب مالک ٹی آئی ڈی کی تصدیق کر کے منظور کرے گا — جعلی ٹی آئی ڈی سے بیلنس نہیں ملتا۔",
    support_whatsapp: "واٹس ایپ مدد",
    push_title: "اطلاعات (پش)",
    push_subscribed: "پش اطلاعات: آن",
    push_not_subscribed: "پش اطلاعات: آف",
    push_not_supported: "اس ڈیوائس/براؤزر پر پش اطلاعات نہیں چلتیں۔",
    push_enable: "پش اطلاعات آن کریں",
    push_disable: "پش اطلاعات آف کریں",
    push_denied: "اطلاعات بلاک ہیں — براؤزر/فون کی سیٹنگز میں اجازت دیں۔",
    agreed_fare_label: "طے شدہ کرایہ",
    chat_unread: "{n} نئے",
    gps_pickup_failed: "جی پی ایس پک اپ ناکام — {place} کو پک اپ بنایا گیا۔",
    nav_external_gmaps: "گوگل میپس میں کھولیں",
    nav_external_osm: "اوپن اسٹریٹ میپ میں کھولیں",
    google_continue: "گوگل سے جاری رکھیں",
    google_coming_soon: "گوگل لاگ ان جلد آ رہا ہے",
    google_update_app: "گوگل لاگ ان کے لیے ایپ کو ورژن 2.5 پر اپ ڈیٹ کریں",
    google_phone_title: "اپنا فون نمبر لکھیں",
    google_phone_sub: "پائلٹ چیک کے لیے فون نمبر چاہیے۔ نیا اکاؤنٹ ہے تو پاس ورڈ خالی چھوڑ دیں — پرانا اکاؤنٹ ہے تو اس کا پاس ورڈ لکھیں، گوگل اس سے لنک ہو جائے گا۔",
    google_continue_btn: "جاری رکھیں",
    google_account_label: "گوگل اکاؤنٹ",
    back_to_login: "لاگ ان پر واپس جائیں",
    settings_title: "سیٹنگز",
  },
};

// ---------- Notification templates (v2.1) ----------
// The API returns {type, params}; the client renders localized title/body.
// Param names must match the server's notify() calls in server/index.mjs
// and server/db.mjs. Any {placeholder} with no value is dropped on render.
const NOTIF_TEMPLATES = {
  en: {
    offer_received: { title: "New offer on Ride #{ride}", body: "{driver} offered Rs {fare}." },
    ride_accepted: { title: "Ride #{ride} accepted", body: "Agreed fare Rs {fare} — go to the pickup." },
    ride_started: { title: "Your trip has started", body: "Ride #{ride} is on the way." },
    ride_completed: { title: "Ride complete", body: "Thank you! Ride #{ride} is complete — fare Rs {fare}." },
    trip_completed: { title: "Trip complete", body: "Ride #{ride} complete — fare Rs {fare}, you kept Rs {kept}." },
    tip_received: { title: "Tip received", body: "Tip Rs {tip} on Ride #{ride} — 100% yours, no commission." },
    topup_approved: { title: "Top-up approved", body: "Rs {amount} added to your wallet (TID {tid})." },
    topup_rejected: { title: "Top-up rejected", body: "Rs {amount} was not credited. {reason}" },
    topup_requested: { title: "New top-up request", body: "{name} requested Rs {amount} ({method}, TID {tid})." },
    driver_approved: { title: "Driver account approved", body: "You can go online now and take rides." },
    driver_blocked: { title: "Driver account blocked", body: "Your driver account was blocked. Contact the owner." },
    withdrawal_requested: { title: "New withdrawal request", body: "{name} requested Rs {amount} to JazzCash {number}." },
    withdrawal_approved: { title: "Withdrawal approved", body: "Rs {amount} will be paid to your JazzCash {number}." },
    withdrawal_rejected: { title: "Withdrawal rejected", body: "Rs {amount} refunded to your wallet. {reason}" },
    complaint_resolved: { title: "Complaint resolved", body: "Your complaint #{id} has been resolved." },
    scheduled_booked: { title: "Scheduled ride booked", body: "Ride #{ride} booked for {when}." },
    scheduled_request: { title: "Scheduled ride request", body: "Ride #{ride} — {pickup} → {destination} on {when}." },
    refund_credited: { title: "Refund credited", body: "Rs {amount} refunded to your wallet. {reason}" },
    doc_approved: { title: "Document approved", body: "Your {doc} was approved." },
    doc_rejected: { title: "Document rejected", body: "Your {doc} was rejected. Please re-upload." },
    sos_alert: { title: "🚨 SOS ALERT — Ride #{ride}", body: "Emergency! {message}" },
    new_ride_request: { title: "New ride request", body: "Ride #{ride_id} — {pickup} → {destination} ({vehicle_type}), Rs {proposed_fare}." },
    scheduled_ride_reminder: { title: "Ride in 30 minutes", body: "Your scheduled ride #{ride} — {pickup} → {destination} — is coming up in 30 minutes." },
  },
  ur: {
    offer_received: { title: "رائڈ #{ride} پر نئی پیشکش", body: "{driver} نے روپے {fare} کی پیشکش کی۔" },
    ride_accepted: { title: "رائڈ #{ride} قبول ہو گئی", body: "طے شدہ کرایہ روپے {fare} — پک اپ پر جائیں۔" },
    ride_started: { title: "آپ کا سفر شروع ہو گیا", body: "رائڈ #{ride} راستے میں ہے۔" },
    ride_completed: { title: "رائڈ مکمل", body: "شکریہ! رائیڈ #{ride} مکمل — کرایہ روپے {fare}۔" },
    trip_completed: { title: "ٹرپ مکمل", body: "رائڈ #{ride} مکمل — کرایہ روپے {fare}، آپ نے روپے {kept} رکھے۔" },
    tip_received: { title: "ٹپ مل گئی", body: "رائڈ #{ride} پر ٹپ روپے {tip} — 100% آپ کی، کوئی کمیشن نہیں۔" },
    topup_approved: { title: "ٹاپ اپ منظور", body: "روپے {amount} آپ کے والیٹ میں آ گئے (ٹی آئی ڈی {tid})۔" },
    topup_rejected: { title: "ٹاپ اپ مسترد", body: "روپے {amount} جمع نہیں ہوئے۔ {reason}" },
    topup_requested: { title: "نئی ٹاپ اپ درخواست", body: "{name} نے روپے {amount} کی درخواست کی ({method}، ٹی آئی ڈی {tid})۔" },
    driver_approved: { title: "ڈرائیور اکاؤنٹ منظور", body: "اب آپ آن لائن ہو کر رائیڈز لے سکتے ہیں۔" },
    driver_blocked: { title: "ڈرائیور اکاؤنٹ بلاک", body: "آپ کا ڈرائیور اکاؤنٹ بلاک کر دیا گیا۔ مالک سے رابطہ کریں۔" },
    withdrawal_requested: { title: "نئی نکالنے کی درخواست", body: "{name} نے روپے {amount} جاز کیش {number} پر مانگے۔" },
    withdrawal_approved: { title: "نکالنا منظور", body: "روپے {amount} آپ کے جاز کیش {number} پر بھیجے جائیں گے۔" },
    withdrawal_rejected: { title: "نکالنا مسترد", body: "روپے {amount} آپ کے والیٹ میں واپس آ گئے۔ {reason}" },
    complaint_resolved: { title: "شکایت حل ہو گئی", body: "آپ کی شکایت #{id} حل ہو گئی۔" },
    scheduled_booked: { title: "شیڈول رائیڈ بک ہو گئی", body: "رائڈ #{ride} {when} کے لیے بک ہو گئی۔" },
    scheduled_request: { title: "شیڈول رائیڈ کی درخواست", body: "رائڈ #{ride} — {pickup} سے {destination}، {when}۔" },
    refund_credited: { title: "ریفنڈ جمع ہو گیا", body: "روپے {amount} آپ کے والیٹ میں واپس آ گئے۔ {reason}" },
    doc_approved: { title: "دستاویز منظور", body: "آپ کی {doc} منظور ہو گئی۔" },
    doc_rejected: { title: "دستاویز مسترد", body: "آپ کی {doc} مسترد ہو گئی۔ براہ کرم دوبارہ اپ لوڈ کریں۔" },
    sos_alert: { title: "🚨 SOS الرٹ — رائیڈ #{ride}", body: "ایمرجنسی! {message}" },
    new_ride_request: { title: "نئی رائیڈ درخواست", body: "رائڈ #{ride_id} — {pickup} سے {destination} ({vehicle_type})، روپے {proposed_fare}۔" },
    scheduled_ride_reminder: { title: "30 منٹ میں رائیڈ", body: "آپ کی شیڈول رائیڈ #{ride} — {pickup} سے {destination} — 30 منٹ میں ہے۔" },
  },
};

let LANG = localStorage.getItem("cr_lang") || "en";
if (!STRINGS[LANG]) LANG = "en";
function t(key, vars) {
  let s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split("{" + k + "}").join(String(v));
  return s;
}
function setLang(l) {
  if (!STRINGS[l]) return;
  LANG = l;
  localStorage.setItem("cr_lang", l);
  document.documentElement.lang = l === "ur" ? "ur" : "en";
  // v2.3 RTL: Urdu mirrors the whole layout ([dir="rtl"] rules in style.css).
  document.documentElement.dir = l === "ur" ? "rtl" : "ltr";
  applyI18n();
}
function applyI18n() {
  $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  // Segmented EN | اردو control: mark the active language, never hide the
  // other one — the old single "اردو" button was too easy to miss.
  $$(".lang-opt").forEach((el) => {
    el.classList.toggle("active", el.dataset.lang === LANG);
    el.setAttribute("aria-pressed", el.dataset.lang === LANG ? "true" : "false");
  });
  $$(".lang-toggle").forEach((el) => { el.textContent = t("lang_toggle"); });
  if (typeof onLangChange === "function") onLangChange();
}
function initLangToggle() {
  $$(".lang-opt").forEach((el) => el.addEventListener("click", () => setLang(el.dataset.lang)));
  $$(".lang-toggle").forEach((el) => el.addEventListener("click", () => setLang(LANG === "en" ? "ur" : "en")));
  document.documentElement.lang = LANG === "ur" ? "ur" : "en";
  document.documentElement.dir = LANG === "ur" ? "rtl" : "ltr";
}

// ---------- Toast (replaces every alert()) ----------
// v2.4.1: only ONE toast visible at a time. A new toast replaces whatever
// is showing instead of stacking — repeated GPS-denial taps used to pile
// up identical red banners (six on the owner's phone). The ~4.2s
// auto-dismiss is unchanged; the timer of a replaced toast removes the
// detached element, which is harmless.
function toast(msg, kind) {
  let box = $("toast-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast-box";
    box.className = "toast-box";
    document.body.appendChild(box);
  }
  box.replaceChildren();
  const el = document.createElement("div");
  el.className = "toast" + (kind === "error" ? " toast-error" : kind === "ok" ? " toast-ok" : "");
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add("toast-out"); setTimeout(() => el.remove(), 300); }, 4200);
}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(translateError(data.error || ("HTTP " + res.status)));
  return data;
}

// ---------- Google sign-in (v2.5) ----------
// Google blocks OAuth inside embedded WebViews, so in the installed app
// the auth URL opens in the system browser (intent://) and comes back via
// an App Link. The button is shown only when the server says Google is
// configured; in the APK it also needs v2.5+ (MainActivity appends
// "ChunianRide/2.5" to the user agent) — older APKs get the update note
// instead of a dead end.
function isApkWebView() { return /wv/.test(navigator.userAgent); }
function apkVersion() {
  const m = navigator.userAgent.match(/ChunianRide\/([\d.]+)/);
  return m ? m[1] : null;
}
function googleLoginSupported() {
  if (!isApkWebView()) return true;
  const v = apkVersion();
  if (!v) return false;
  const parts = v.split(".").map((x) => Number(x) || 0);
  return parts[0] > 2 || (parts[0] === 2 && (parts[1] || 0) >= 5);
}
function startGoogleLogin(role) {
  const source = isApkWebView() ? "apk" : "web";
  const url = `/api/auth/google?role=${role}&source=${source}`;
  if (source === "apk") {
    location.href = `intent://chunian-ride.onrender.com${url}#Intent;scheme=https;action=android.intent.action.VIEW;end`;
  } else {
    location.href = url;
  }
}
function initGoogleLogin(role, enabled) {
  const btn = $("btn-google");
  const note = $("google-note");
  if (!btn) return;
  if (!enabled) {
    btn.style.display = "none";
    if (note) { note.classList.remove("hidden"); note.textContent = t("google_coming_soon"); }
    return;
  }
  if (!googleLoginSupported()) {
    btn.style.display = "none";
    if (note) { note.classList.remove("hidden"); note.textContent = t("google_update_app"); }
    return;
  }
  btn.addEventListener("click", () => startGoogleLogin(role));
}
// Every server error string (server/index.mjs + server/auth.mjs + server/db.mjs),
// shown in the user's language. Keys must match the server strings exactly.
const ERR_MAP = {
  "Is phone par account pehle se hai — login karein": { en: "An account already exists on this phone — please log in.", ur: "اس فون پر اکاؤنٹ پہلے سے موجود ہے — براہ کرم لاگ ان کریں۔" },
  "Maujooda password ghalat hai": { en: "The current password is wrong.", ur: "موجودہ پاس ورڈ غلط ہے۔" },
  "Sirf logged-in rider apni ride book kar sakta hai": { en: "Only a logged-in rider can book a ride.", ur: "صرف لاگ ان رائیڈر ہی رائیڈ بک کر سکتا ہے۔" },
  "distance unknown — enter km manually": { en: "Distance is unknown — please enter the km manually.", ur: "فاصلہ معلوم نہیں — براہ کرم کلومیٹر خود لکھیں۔" },
  "vehicle must be bike, rickshaw, car or ac_car": { en: "Please choose a valid vehicle.", ur: "براہ کرم درست سواری چنیں۔" },
  "Login zaroori hai — pehle login karein": { en: "Please log in first.", ur: "براہ کرم پہلے لاگ ان کریں۔" },
  "Admin login zaroori hai": { en: "Admin login is required.", ur: "ایڈمن لاگ ان ضروری ہے۔" },
  "Sirf admin kar sakta hai": { en: "Only an admin can do this.", ur: "یہ صرف ایڈمن کر سکتا ہے۔" },
  "Is kaam ki ijazat nahi hai": { en: "You don't have permission for this.", ur: "آپ کو اس کام کی اجازت نہیں ہے۔" },
  "Ye kaam sirf usi user ka hai": { en: "This is only for that user.", ur: "یہ کام صرف اسی صارف کا ہے۔" },
  "Bohat zyada ghalat koshishein — 15 minute baad dobara koshish karein": { en: "Too many wrong attempts — try again after 15 minutes.", ur: "بہت زیادہ غلط کوششیں — 15 منٹ بعد دوبارہ کوشش کریں۔" },
  "Phone ya password ghalat hai": { en: "Phone or password is wrong.", ur: "فون یا پاس ورڈ غلط ہے۔" },
  "Setup code ghalat hai": { en: "The setup code is wrong.", ur: "سیٹ اپ کوڈ غلط ہے۔" },
  "Ye account suspend hai — owner se rabta karein": { en: "This account is suspended — contact the owner.", ur: "یہ اکاؤنٹ معطل ہے — مالک سے رابطہ کریں۔" },
  "Is account ka password abhi set nahi — owner se rabta karein": { en: "No password is set on this account yet — contact the owner.", ur: "اس اکاؤنٹ کا پاس ورڈ ابھی سیٹ نہیں — مالک سے رابطہ کریں۔" },
  "Admin account pehle se bana hua hai — login karein": { en: "An admin account already exists — please log in.", ur: "ایڈمن اکاؤنٹ پہلے سے بنا ہوا ہے — براہ کرم لاگ ان کریں۔" },
  "Server error — dobara koshish karein": { en: "Server error — please try again.", ur: "سرور میں خرابی — دوبارہ کوشش کریں۔" },
  "Ye ride aap ki nahi hai": { en: "This ride is not yours.", ur: "یہ رائیڈ آپ کی نہیں ہے۔" },
  "Sirf is ride ka rider offer accept kar sakta hai": { en: "Only this ride's rider can accept an offer.", ur: "صرف اس رائیڈ کا رائیڈر آفر قبول کر سکتا ہے۔" },
  "Sirf is ride ka rider ya driver cancel kar sakta hai": { en: "Only this ride's rider or driver can cancel it.", ur: "صرف اس رائیڈ کا رائیڈر یا ڈرائیور اسے منسوخ کر سکتا ہے۔" },
  "Sirf is ride ka rider ya driver SOS bhej sakta hai": { en: "Only this ride's rider or driver can send an SOS.", ur: "صرف اس رائیڈ کا رائیڈر یا ڈرائیور SOS بھیج سکتا ہے۔" },
  "Sirf is ride ka driver trip start kar sakta hai": { en: "Only this ride's driver can start the trip.", ur: "صرف اس رائیڈ کا ڈرائیور سفر شروع کر سکتا ہے۔" },
  "Sirf is ride ka driver trip complete kar sakta hai": { en: "Only this ride's driver can complete the trip.", ur: "صرف اس رائیڈ کا ڈرائیور سفر مکمل کر سکتا ہے۔" },
  "Sirf apne naam se counter-offer bhej sakte hain": { en: "You can only send a counter-offer in your own name.", ur: "آپ صرف اپنے نام سے کاؤنٹر آفر بھیج سکتے ہیں۔" },
  "Sirf apne naam se decline kar sakte hain": { en: "You can only decline in your own name.", ur: "آپ صرف اپنے نام سے انکار کر سکتے ہیں۔" },
  "Sirf apne naam se message bhej sakte hain": { en: "You can only send a message in your own name.", ur: "آپ صرف اپنے نام سے پیغام بھیج سکتے ہیں۔" },
  "Sirf apni registration kar sakte hain": { en: "You can only register yourself.", ur: "آپ صرف اپنی رجسٹریشن کر سکتے ہیں۔" },
  "Sirf apni rides dekh sakte hain": { en: "You can only see your own rides.", ur: "آپ صرف اپنی رائیڈز دیکھ سکتے ہیں۔" },
  "Sirf is ride ka rider driver ko rate kar sakta hai": { en: "Only this ride's rider can rate the driver.", ur: "صرف اس رائیڈ کا رائیڈر ڈرائیور کو ریٹ کر سکتا ہے۔" },
  "Sirf is ride ka driver rider ko rate kar sakta hai": { en: "Only this ride's driver can rate the rider.", ur: "صرف اس رائیڈ کا ڈرائیور رائیڈر کو ریٹ کر سکتا ہے۔" },
  "Sirf user account ka password yahan badalta hai": { en: "Only a user account password can be changed here.", ur: "یہاں صرف صارف اکاؤنٹ کا پاس ورڈ بدلتا ہے۔" },
  "Sirf user account ka wallet yahan dikhta hai": { en: "Only a user account wallet is shown here.", ur: "یہاں صرف صارف اکاؤنٹ کا والیٹ دکھتا ہے۔" },
  "Is naam ka sheher pehle se hai": { en: "A city with this name already exists.", ur: "اس نام کا شہر پہلے سے موجود ہے۔" },
  "Is code par promo pehle se hai": { en: "A promo with this code already exists.", ur: "اس کوڈ پر پرومو پہلے سے موجود ہے۔" },
  "driver is not approved yet": { en: "Driver is not approved yet.", ur: "ڈرائیور کی ابھی منظوری نہیں ہوئی۔" },
  "driver profile already exists — wait for owner approval": { en: "Driver profile already exists — wait for owner approval.", ur: "ڈرائیور پروفائل پہلے سے موجود ہے — مالک کی منظوری کا انتظار کریں۔" },
  "ride is no longer open": { en: "Ride is no longer open.", ur: "رائڈ اب کھلی نہیں ہے۔" },
  "ride must be accepted before it can start": { en: "Ride must be accepted before it can start.", ur: "رائڈ شروع ہونے سے پہلے قبول ہونی چاہیے۔" },
  "ride must be ongoing before it can be completed": { en: "Ride must be ongoing before it can be completed.", ur: "رائڈ مکمل ہونے سے پہلے جاری ہونی چاہیے۔" },
  "Confirm cash received from the rider first — a trip cannot be completed without it": { en: "Confirm cash received from the rider first — a trip cannot be completed without it.", ur: "پہلے رائیڈر سے نقد رقم ملنے کی تصدیق کریں — اس کے بغیر سفر مکمل نہیں ہو سکتا۔" },
  "completed ride cannot be cancelled": { en: "A completed ride cannot be cancelled.", ur: "مکمل شدہ رائیڈ منسوخ نہیں ہو سکتی۔" },
  "offer not found or no longer pending": { en: "Offer not found or no longer pending.", ur: "آفر نہیں ملی یا اب زیرِ التوا نہیں ہے۔" },
  // v2.3
  "offer has expired": { en: "This offer has expired.", ur: "یہ پیشکش ختم ہو گئی۔" },
  "offer is no longer pending": { en: "Offer is no longer pending.", ur: "آفر اب زیرِ التوا نہیں ہے۔" },
  "Sirf driver apni offer accept kar sakta hai": { en: "Only a driver can accept their own offer.", ur: "صرف ڈرائیور ہی اپنی آفر قبول کر سکتا ہے۔" },
  "Sirf apni offer accept kar sakte hain": { en: "You can only accept your own offer.", ur: "آپ صرف اپنی آفر قبول کر سکتے ہیں۔" },
  "calls are only available to the rider or assigned driver of an active ride": { en: "Calls are only available to the rider or assigned driver of an active ride.", ur: "کال صرف فعال رائیڈ کے رائیڈر یا مقررہ ڈرائیور کے لیے ہے۔" },
  "document has expired — ask the driver to re-upload": { en: "Document has expired — ask the driver to re-upload.", ur: "دستاویز کی مدت ختم ہو گئی — ڈرائیور سے دوبارہ اپ لوڈ کرنے کو کہیں۔" },
  "expires_at must be a future date": { en: "Expiry must be a future date.", ur: "ختم ہونے کی تاریخ مستقبل کی ہونی چاہیے۔" },
  "fare must be more than 0": { en: "Fare must be more than 0.", ur: "کرایہ 0 سے زیادہ ہونا چاہیے۔" },
  "scheduled time must be in the future": { en: "Scheduled time must be in the future.", ur: "طے شدہ وقت مستقبل میں ہونا چاہیے۔" },
  "you can only book up to 7 days ahead": { en: "You can only book up to 7 days ahead.", ur: "آپ صرف 7 دن آگے تک بک کر سکتے ہیں۔" },
  "tip can only be added after the ride is completed": { en: "Tip can only be added after the ride is completed.", ur: "ٹپ صرف رائیڈ مکمل ہونے کے بعد دی جا سکتی ہے۔" },
  "rating can only be given after the ride is completed": { en: "Rating can only be given after the ride is completed.", ur: "ریٹنگ صرف رائیڈ مکمل ہونے کے بعد دی جا سکتی ہے۔" },
  "tip already added for this ride": { en: "Tip already added for this ride.", ur: "اس رائیڈ کے لیے ٹپ پہلے سے دی جا چکی ہے۔" },
  "tip cannot be more than Rs 5000": { en: "Tip cannot be more than Rs 5000.", ur: "ٹپ 5000 روپے سے زیادہ نہیں ہو سکتی۔" },
  "tip must be more than 0": { en: "Tip must be more than 0.", ur: "ٹپ 0 سے زیادہ ہونی چاہیے۔" },
  "only the rider of this ride can add a tip": { en: "Only the rider of this ride can add a tip.", ur: "صرف اس رائیڈ کا رائیڈر ٹپ دے سکتا ہے۔" },
  "only the rider or driver of this ride can chat here": { en: "Only the rider or driver of this ride can chat here.", ur: "یہاں صرف اس رائیڈ کا رائیڈر یا ڈرائیور چیٹ کر سکتا ہے۔" },
  "only the rider or driver of this ride can read this chat": { en: "Only the rider or driver of this ride can read this chat.", ur: "یہ چیٹ صرف اس رائیڈ کا رائیڈر یا ڈرائیور پڑھ سکتا ہے۔" },
  "message must be 1-500 characters": { en: "Message must be 1–500 characters.", ur: "پیغام 1 سے 500 حروف کا ہونا چاہیے۔" },
  "name and phone are required": { en: "Name and phone are required.", ur: "نام اور فون ضروری ہیں۔" },
  "phone and password are required": { en: "Phone and password are required.", ur: "فون اور پاس ورڈ ضروری ہیں۔" },
  "phone is required": { en: "Phone is required.", ur: "فون ضروری ہے۔" },
  "name is required": { en: "Name is required.", ur: "نام ضروری ہے۔" },
  "code is required": { en: "Code is required.", ur: "کوڈ ضروری ہے۔" },
  "rider_id or driver_id is required": { en: "Rider or driver ID is required.", ur: "رائیڈر یا ڈرائیور آئی ڈی ضروری ہے۔" },
  "rider_id, pickup, destination and vehicle are required": { en: "Rider, pickup, destination and vehicle are required.", ur: "رائیڈر، پک اپ، منزل اور سواری ضروری ہیں۔" },
  "user_id and a valid vehicle_type are required": { en: "User ID and a valid vehicle type are required.", ur: "صارف آئی ڈی اور درست سواری کی قسم ضروری ہے۔" },
  "CNIC, driving licence and vehicle registration are all required": { en: "CNIC, driving licence and vehicle registration are all required.", ur: "شناختی کارڈ، ڈرائیونگ لائسنس اور گاڑی کی رجسٹریشن تینوں ضروری ہیں۔" },
  "discount_value must be more than 0": { en: "Discount value must be more than 0.", ur: "ڈسکاؤنٹ کی رقم 0 سے زیادہ ہونی چاہیے۔" },
  "percent discount cannot be more than 100": { en: "Percent discount cannot be more than 100.", ur: "فیصد ڈسکاؤنٹ 100 سے زیادہ نہیں ہو سکتی۔" },
  "km_from_chunian must be a number": { en: "Distance from Chunian must be a number.", ur: "چونیاں سے فاصلہ ایک عدد ہونا چاہیے۔" },
  "by must be 'rider' or 'driver'": { en: "Rating must be by 'rider' or 'driver'.", ur: "ریٹنگ 'rider' یا 'driver' کی طرف سے ہونی چاہیے۔" },
  "valid lat/lng required": { en: "Valid latitude/longitude required.", ur: "درست عرض بلد / طول بلد ضروری ہے۔" },
  "valid lat/lng are required": { en: "Valid latitude/longitude are required.", ur: "درست عرض بلد / طول بلد ضروری ہیں۔" },
  "ride not found": { en: "Ride not found.", ur: "رائڈ نہیں ملی۔" },
  "driver not found": { en: "Driver not found.", ur: "ڈرائیور نہیں ملا۔" },
  "user not found": { en: "User not found.", ur: "صارف نہیں ملا۔" },
  "city not found": { en: "City not found.", ur: "شہر نہیں ملا۔" },
  "not logged in": { en: "Not logged in.", ur: "لاگ ان نہیں ہیں۔" },
  "admin not found": { en: "Admin not found.", ur: "ایڈمن نہیں ملا۔" },
  "topup request not found": { en: "Top-up request not found.", ur: "ٹاپ اپ درخواست نہیں ملی۔" },
  "topup request already reviewed": { en: "Top-up request already reviewed.", ur: "ٹاپ اپ درخواست پہلے سے جائزہ شدہ ہے۔" },
  // v2.1
  "minimum top-up not met": { en: "The top-up amount is below the minimum.", ur: "ٹاپ اپ رقم کم از کم حد سے کم ہے۔" },
  "minimum withdrawal not met": { en: "The withdrawal amount is below the minimum.", ur: "نکالنے کی رقم کم از کم حد سے کم ہے۔" },
  "withdrawal amount is more than your wallet balance": { en: "Withdrawal is more than your wallet balance.", ur: "نکالنے کی رقم آپ کے والیٹ بیلنس سے زیادہ ہے۔" },
  "withdrawal request not found": { en: "Withdrawal request not found.", ur: "نکالنے کی درخواست نہیں ملی۔" },
  "withdrawal request already reviewed": { en: "Withdrawal request already reviewed.", ur: "نکالنے کی درخواست پہلے سے جائزہ شدہ ہے۔" },
  "JazzCash number is required": { en: "JazzCash number is required.", ur: "جاز کیش نمبر ضروری ہے۔" },
  "promo code is required": { en: "Promo code is required.", ur: "پرومو کوڈ ضروری ہے۔" },
  "promo code not found": { en: "Promo code not found.", ur: "پرومو کوڈ نہیں ملا۔" },
  "promo code is not active": { en: "Promo code is not active.", ur: "پرومو کوڈ فعال نہیں ہے۔" },
  "promo code is not valid yet": { en: "Promo code is not valid yet.", ur: "پرومو کوڈ ابھی لاگو نہیں ہوا۔" },
  "promo code has expired": { en: "Promo code has expired.", ur: "پرومو کوڈ کی مدت ختم ہو گئی ہے۔" },
  "promo code has reached its maximum uses": { en: "Promo code has reached its maximum uses.", ur: "پرومو کوڈ کی حد مکمل ہو چکی ہے۔" },
  "invalid document type": { en: "Invalid document type.", ur: "دستاویز کی قسم غلط ہے۔" },
  "only JPG or PNG photos are allowed": { en: "Only JPG or PNG photos are allowed.", ur: "صرف JPG یا PNG تصویر چلتی ہے۔" },
  "document is too large — max 1.5 MB": { en: "Document is too large — max 1.5 MB.", ur: "دستاویز بہت بڑی ہے — زیادہ سے زیادہ 1.5 MB۔" },
  "document not found": { en: "Document not found.", ur: "دستاویز نہیں ملی۔" },
  "notification not found": { en: "Notification not found.", ur: "اطلاع نہیں ملی۔" },
  "user_id and a refund amount are required": { en: "User ID and a refund amount are required.", ur: "یوزر آئی ڈی اور ریفنڈ رقم ضروری ہیں۔" },
  "Sirf driver apni withdrawal bhej sakta hai": { en: "Only a driver can request a withdrawal.", ur: "صرف ڈرائیور ہی نکالنے کی درخواست بھیج سکتا ہے۔" },
  "Sirf apni withdrawal bhej sakte hain": { en: "You can only request a withdrawal for yourself.", ur: "آپ صرف اپنی نکالنے کی درخواست بھیج سکتے ہیں۔" },
  "Sirf driver apni withdrawals dekh sakta hai": { en: "Only a driver can see their own withdrawals.", ur: "صرف ڈرائیور ہی اپنی نکالنے کی درخواستیں دیکھ سکتا ہے۔" },
  "Sirf driver apni documents upload kar sakta hai": { en: "Only a driver can upload their own documents.", ur: "صرف ڈرائیور ہی اپنی دستاویزات اپ لوڈ کر سکتا ہے۔" },
  "Sirf driver apni documents dekh sakta hai": { en: "Only a driver can see their own documents.", ur: "صرف ڈرائیور ہی اپنی دستاویزات دیکھ سکتا ہے۔" },
  "Sirf user account ka top-up yahan hota hai": { en: "Only a user account can top up here.", ur: "یہاں صرف صارف اکاؤنٹ کا ٹاپ اپ ہوتا ہے۔" },
  // v2.2 — pilot launch
  "Pilot registration sirf whitelist par hai — owner se rabta karein": { en: "Pilot registration only — contact the owner.", ur: "پائلٹ رجسٹریشن صرف وائٹ لسٹ پر ہے — مالک سے رابطہ کریں۔" },
  "Pilot phase: sirf Chunian City ki rides — intercity rides abhi band hain": { en: "Pilot phase: rides are Chunian City only — intercity rides are not available yet.", ur: "پائلٹ مرحلہ: صرف چونیاں شہر کی رائیڈز — بین شہر رائیڈز ابھی بند ہیں۔" },
  "Pilot limit poori ho gayi — registration band hai": { en: "The pilot limit is full — registration is closed.", ur: "پائلٹ کی حد پوری ہو گئی — رجسٹریشن بند ہے۔" },
  "Pilot driver limit poori ho gayi — mazeed drivers add nahi ho sakte": { en: "The pilot driver limit is full — no more drivers can be added.", ur: "پائلٹ ڈرائیور کی حد پوری ہو گئی — مزید ڈرائیور شامل نہیں ہو سکتے۔" },
  "Pilot rider limit poori ho gayi — mazeed riders add nahi ho sakte": { en: "The pilot rider limit is full — no more riders can be added.", ur: "پائلٹ رائیڈر کی حد پوری ہو گئی — مزید رائیڈر شامل نہیں ہو سکتے۔" },
  "Is phone par whitelist entry pehle se hai": { en: "This phone is already on the whitelist.", ur: "یہ فون پہلے سے وائٹ لسٹ پر ہے۔" },
  "Driver ki documents verify nahi — pehle documents approve karwain": { en: "The driver's documents are not verified yet — get the documents approved first.", ur: "ڈرائیور کی دستاویزات ابھی تصدیق شدہ نہیں — پہلے دستاویزات منظور کروائیں۔" },
  "whitelist entry not found": { en: "Whitelist entry not found.", ur: "وائٹ لسٹ انٹری نہیں ملی۔" },
  "pilot_mode must be 0 or 1": { en: "Pilot mode must be 0 or 1.", ur: "پائلٹ موڈ 0 یا 1 ہونا چاہیے۔" },
  "pilot cap must be a number": { en: "The pilot cap must be a number.", ur: "پائلٹ کی حد ایک عدد ہونی چاہیے۔" },
};
function translateError(msg) {
  const m = ERR_MAP[msg];
  return m ? (m[LANG] || m.en) : msg;
}

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Ratings: only REAL ratings from completed rides are ever shown.
function ratingText(rating, count, who) {
  const n = Number(count || 0);
  if (n > 0) return `⭐ ${Number(rating).toFixed(1)}`;
  return t(who === "driver" ? "new_driver_label" : "new_rider_label");
}
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function fmtSched(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function schedLine(ts) {
  return ts ? `<p class="sched-line">🕐 ${t("scheduled")}: <b>${escapeHtml(fmtSched(ts))}</b></p>` : "";
}
function tipLine(tip) {
  return tip ? ` • 💰 Tip Rs ${tip} (100% driver)` : "";
}
function fmtRs(n) { return "Rs " + Number(n || 0).toLocaleString("en-US"); }
// Button loading state: disable + show loading text while a request runs.
function setLoading(btn, on) {
  if (!btn) return;
  if (on) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = t("loading");
  } else {
    btn.disabled = false;
    // Only restore the saved label if the button still shows "Loading…".
    // A handler may have legitimately changed the label mid-flight (e.g.
    // the driver online toggle flips Go Offline <-> Go Online in
    // renderDriver); restoring the stale saved label would undo that.
    // Always clear the saved label so it can never go stale across clicks.
    if (btn.dataset.label && btn.textContent === t("loading")) btn.textContent = btn.dataset.label;
    delete btn.dataset.label;
  }
}
function setErr(el, msg) { if (el) el.textContent = msg || ""; }
// Shared change-password flow (POST /api/auth/change-password {current, next}).
async function changePassword(currentEl, nextEl, outEl, btn) {
  const current = currentEl.value, next = nextEl.value;
  if (!current || !next) { setErr(outEl, t("err_pw_both")); return false; }
  setLoading(btn, true);
  try {
    await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ current, next }) });
    currentEl.value = ""; nextEl.value = "";
    setErr(outEl, t("pw_changed"));
    toast(t("pw_changed"), "ok");
    return true;
  } catch (e) { setErr(outEl, e.message); return false; }
  finally { setLoading(btn, false); }
}
async function logoutUser() {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
  location.href = "/";
}
// ---------- Map helpers (Leaflet + OpenStreetMap, free) ----------
function initBaseMap(elId) {
  const map = L.map(elId).setView([30.9667, 74.0333], 10);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap" }).addTo(map);
  return map;
}
function addPlacePins(map, places, onPick) {
  const markers = {};
  places.forEach((p) => {
    const m = L.marker([p.lat, p.lng]).addTo(map).bindPopup(`<b>${escapeHtml(p.name)}</b><br>${escapeHtml(p.note || "")}`);
    m.on("click", () => onPick(p));
    markers[p.name] = m;
  });
  return markers;
}

// ---------- Notifications (v2.1, in-app feed) ----------
// Renders a notification from its type + params in the current language.
// The doc param holds a doc_type key (cnic_front/cnic_back/licence) —
// translate it through the doc_* keys. The when param is an ISO date.
function notifText(n) {
  const tpl = (NOTIF_TEMPLATES[LANG] && NOTIF_TEMPLATES[LANG][n.type]) || NOTIF_TEMPLATES.en[n.type];
  if (!tpl) return { title: n.type, body: "" };
  const vars = { ...(n.params || {}) };
  if (vars.doc) vars.doc = t({ cnic_front: "doc_cnic_front", cnic_back: "doc_cnic_back", cnic: "doc_cnic", licence: "doc_licence", vehicle: "doc_vehicle", other: "doc_other" }[vars.doc] || "doc_licence");
  if (vars.when) { try { vars.when = fmtSched(new Date(vars.when).getTime()); } catch { /* keep raw */ } }
  let title = tpl.title, body = tpl.body;
  for (const [k, v] of Object.entries(vars)) {
    title = title.split("{" + k + "}").join(String(v));
    body = body.split("{" + k + "}").join(String(v));
  }
  return { title, body: body.replace(/\{[a-z_]+\}/g, "").replace(/\s+([.,])/g, "$1").trim() };
}
// Fetches the feed and updates the badge + panel list (if the panel exists).
async function loadNotifications() {
  const badge = $("notif-badge"), list = $("notif-list");
  let data;
  try { data = await api("/api/notifications"); } catch { return; }
  if (badge) {
    badge.textContent = data.unread_count > 99 ? "99+" : String(data.unread_count);
    badge.style.display = data.unread_count ? "" : "none";
  }
  if (list) {
    list.innerHTML = "";
    if (!data.notifications.length) {
      list.innerHTML = `<p class="muted">${escapeHtml(t("notif_empty"))}</p>`;
    } else {
      for (const n of data.notifications) {
        const { title, body } = notifText(n);
        const item = document.createElement("div");
        item.className = "notif-item" + (n.is_read ? "" : " unread");
        item.innerHTML = `<b>${escapeHtml(title)}</b><span>${escapeHtml(body)}</span><time>${escapeHtml(new Date(n.created_at).toLocaleString())}</time>`;
        item.addEventListener("click", async () => {
          if (!n.is_read) {
            try { await api("/api/notifications/" + n.id + "/read", { method: "POST", body: "{}" }); } catch {}
            loadNotifications();
          }
        });
        list.appendChild(item);
      }
    }
  }
}
let notifTimer = null;
function initNotifications() {
  const bell = $("notif-bell"), panel = $("notif-panel");
  if (!bell || !panel) return;
  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) loadNotifications();
  });
  document.addEventListener("click", (e) => { if (!panel.contains(e.target)) panel.classList.add("hidden"); });
  const markAll = $("notif-mark-all");
  if (markAll) markAll.addEventListener("click", async () => {
    try { await api("/api/notifications/read-all", { method: "POST", body: "{}" }); } catch {}
    loadNotifications();
  });
  loadNotifications();
  if (!notifTimer) notifTimer = setInterval(loadNotifications, 15000);
}

// ---------- PWA (v2.1) ----------
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}
document.addEventListener("DOMContentLoaded", registerServiceWorker);

// ---------- v2.3 shared helpers ----------
// Countdown from the SERVER clock: remaining = expires_at - serverNow,
// where serverNow = server_time_ms + (Date.now() - fetchedAtMs).
function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}
function serverRemainingMs(expiresAt, serverTimeMs, fetchedAtMs) {
  if (expiresAt == null || serverTimeMs == null) return null;
  return expiresAt - (serverTimeMs + (Date.now() - fetchedAtMs));
}
function fmtClockTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
// WhatsApp link for a Pakistani number (03XX... -> 92...). Empty -> "".
function waLink(number) {
  const d = String(number || "").replace(/\D/g, "");
  if (!d) return "";
  return "https://wa.me/" + (d.startsWith("0") ? "92" + d.slice(1) : d);
}
// Support contact block from settings: phone + WhatsApp link, or "not set".
// Never invents a number.
function renderSupportInfo(el, settings) {
  if (!el) return;
  const phone = (settings && settings.support_phone) || "";
  const wa = (settings && settings.support_whatsapp) || "";
  const phoneLine = phone
    ? `<br>${escapeHtml(t("support_owner"))}: <a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>`
    : `<br>${escapeHtml(t("support_owner"))}: ${escapeHtml(t("not_set"))}`;
  const waLine = wa
    ? `<br>${escapeHtml(t("support_whatsapp"))}: <a target="_blank" rel="noopener" href="${escapeHtml(waLink(wa))}">${escapeHtml(wa)}</a>`
    : `<br>${escapeHtml(t("support_whatsapp"))}: ${escapeHtml(t("not_set"))}`;
  el.innerHTML = `<p>${escapeHtml(t("police"))}: <a href="tel:15"><strong>15</strong></a> &nbsp;•&nbsp; ${escapeHtml(t("rescue"))}: <a href="tel:1122"><strong>1122</strong></a>${phoneLine}${waLine}</p>`;
}

// ---------- Client error reporting (v2.3, POST /api/client-error) ----------
// Only when logged in; max 1 report per distinct message per page load;
// a reporting failure must never break the app.
const __clientErrorSeen = new Set();
let __crLoggedIn = false;
function markClientLoggedIn() { __crLoggedIn = true; }
function reportClientError(message, stack) {
  if (!__crLoggedIn || !message) return;
  const msg = String(message).slice(0, 2000);
  if (__clientErrorSeen.has(msg)) return;
  __clientErrorSeen.add(msg);
  try {
    fetch("/api/client-error", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, stack: String(stack || "").slice(0, 4000), url: location.href }),
    }).catch(() => {});
  } catch {}
}
window.addEventListener("error", (e) => {
  reportClientError(e.message || "Uncaught error", e.error && e.error.stack ? e.error.stack : "");
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  reportClientError("Unhandled rejection: " + (r && r.message ? r.message : String(r)), r && r.stack ? r.stack : "");
});

// ---------- Complaint (v2.3, POST /api/complaints) ----------
async function postComplaint(rideId, message) {
  return api("/api/complaints", { method: "POST", body: JSON.stringify({ ride_id: rideId, message }) });
}

// ---------- Top-up method picker (v2.3 — JazzCash + Sadapay ONLY) ----------
// Renders the picker into `box` and returns { getMethod, isBlocked, refresh }.
// onChange(method, number, blocked) fires on every selection change.
// Sadapay with an empty number blocks submit and shows the owner-contact
// note; no number is ever invented. Only these two methods exist.
function initTopupPicker(box, settings, onChange) {
  if (!box) return { getMethod: () => "JazzCash", isBlocked: () => false, refresh: () => {} };
  let method = "JazzCash";
  const state = {
    getMethod: () => method,
    isBlocked: () => method === "Sadapay" && !((settings && settings.sadapay_number) || "").trim(),
    refresh: (s) => { if (s) settings = s; render(); },
  };
  function render() {
    const jc = (settings && settings.jazzcash_number) || "";
    const sp = (settings && settings.sadapay_number) || "";
    const num = method === "JazzCash" ? jc : sp;
    const blocked = state.isBlocked();
    box.innerHTML = `
      <label>${escapeHtml(t("topup_method"))}</label>
      <div class="v23-methods" role="group" aria-label="${escapeHtml(t("topup_method"))}">
        <button type="button" class="v23-method${method === "JazzCash" ? " active" : ""}" data-method="JazzCash">${escapeHtml(t("method_jazzcash"))}</button>
        <button type="button" class="v23-method${method === "Sadapay" ? " active" : ""}" data-method="Sadapay">${escapeHtml(t("method_sadapay"))}</button>
      </div>
      <p class="muted v23-method-note">${blocked ? escapeHtml(t("sadapay_not_set")) : escapeHtml(t("topup_note_method", { method: t(method === "JazzCash" ? "method_jazzcash" : "method_sadapay"), num: num || t("not_set") }))}</p>`;
    $$("[data-method]", box).forEach((b) => b.addEventListener("click", () => {
      method = b.dataset.method;
      render();
      if (typeof onChange === "function") onChange(method, method === "JazzCash" ? jc : sp, state.isBlocked());
    }));
    if (typeof onChange === "function") onChange(method, num, blocked);
  }
  render();
  return state;
}

// ---------- Web Push (v2.3, VAPID) ----------
function urlBase64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const b = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function pushStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { supported: false, subscribed: false };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return { supported: true, subscribed: !!sub, endpoint: sub ? sub.endpoint : null };
  } catch { return { supported: true, subscribed: false }; }
}
async function pushSubscribe() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return { supported: false, subscribed: false };
  if (Notification.permission === "denied") throw new Error(t("push_denied"));
  const reg = await navigator.serviceWorker.ready;
  const { public_key } = await api("/api/push/public-key");
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(public_key) });
  const j = sub.toJSON();
  await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint, keys: j.keys }) });
  return { supported: true, subscribed: true, endpoint: sub.endpoint };
}
async function pushUnsubscribe() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return { subscribed: false };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try { await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch {}
    try { await sub.unsubscribe(); } catch {}
  }
  return { subscribed: false };
}
// Renders an honest push toggle into `box`: subscribed / not subscribed /
// not supported. Re-rendering is cheap — call it from profile renders.
async function renderPushToggle(box) {
  if (!box) return;
  box.innerHTML = `<h3>${escapeHtml(t("push_title"))}</h3><p class="muted">${escapeHtml(t("loading"))}</p>`;
  let st;
  try { st = await pushStatus(); } catch { st = { supported: false, subscribed: false }; }
  if (!st.supported) {
    box.innerHTML = `<h3>${escapeHtml(t("push_title"))}</h3><p class="muted">${escapeHtml(t("push_not_supported"))}</p>`;
    return;
  }
  box.innerHTML = `<h3>${escapeHtml(t("push_title"))}</h3>
    <p class="muted" data-push-state>${escapeHtml(st.subscribed ? t("push_subscribed") : t("push_not_subscribed"))}</p>
    <button type="button" class="secondary" data-push-btn>${escapeHtml(st.subscribed ? t("push_disable") : t("push_enable"))}</button>`;
  const btn = box.querySelector("[data-push-btn]");
  const stateEl = box.querySelector("[data-push-state]");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const cur = await pushStatus();
      if (cur.subscribed) {
        await pushUnsubscribe();
        stateEl.textContent = t("push_not_subscribed");
        btn.textContent = t("push_enable");
      } else {
        await pushSubscribe();
        stateEl.textContent = t("push_subscribed");
        btn.textContent = t("push_disable");
        toast(t("push_subscribed"), "ok");
      }
    } catch (e) { toast(e.message, "error"); }
    finally { btn.disabled = false; }
  });
}

// ---------- OSRM route (v2.3, free demo router, best-effort) ----------
// Returns {coords:[[lat,lng]...], distanceKm, durationMin} or null on any
// failure. Callers must fall back to a straight line labelled as direct /
// estimated — never present it as road distance.
async function fetchOsrmRoute(from, to) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.routes || !d.routes.length) return null;
    return {
      coords: d.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceKm: Math.round((d.routes[0].distance / 1000) * 10) / 10,
      durationMin: Math.max(1, Math.round(d.routes[0].duration / 60)),
    };
  } catch { return null; }
}
function gmapsDirUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lat + "," + lng)}`;
}
function osmDirUrl(lat, lng) {
  return `https://www.openstreetmap.org/directions?to=${encodeURIComponent(lat + "," + lng)}`;
}

// ---------- In-app voice call (v2.3, WebRTC P2P — STUN only, NO TURN) ----------
// Signalling via POST/GET /api/rides/:id/call-signal (kinds offer/answer/
// ice/end). No phone numbers anywhere. One controller per active ride.
// opts: { rideId, myRole: "rider"|"driver", myUserId, mount (audio element
// parent), onState(state, info) } — states: idle, calling, incoming,
// in-call, ended, no-answer, failed. Caller polls for answer+ice; callee
// polls for offer. startPolling() must run while the ride screen is open
// so incoming calls are detected; stopPolling() when it closes.
function createRideCall(opts) {
  const { rideId, myRole, myUserId, mount, onState } = opts;
  const ICE = [{ urls: "stun:stun.l.google.com:19302" }];
  let pc = null, localStream = null, remoteAudio = null;
  let lastSignalId = 0, pollTimer = null, noAnswerTimer = null;
  let state = "idle", remoteOffer = null, muted = false;
  function setState(s, info) {
    state = s;
    if (typeof onState === "function") { try { onState(s, info || {}); } catch {} }
  }
  function ensureAudio() {
    if (!remoteAudio) {
      remoteAudio = document.createElement("audio");
      remoteAudio.autoplay = true;
      remoteAudio.playsInline = true;
      (mount || document.body).appendChild(remoteAudio);
    }
    return remoteAudio;
  }
  function makePc() {
    const p = new RTCPeerConnection({ iceServers: ICE });
    p.onicecandidate = (e) => {
      if (e.candidate) postSignal("ice", { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }).catch(() => {});
    };
    p.ontrack = (e) => { const a = ensureAudio(); a.srcObject = e.streams[0]; };
    return p;
  }
  async function postSignal(kind, payload) {
    return api(`/api/rides/${rideId}/call-signal`, { method: "POST", body: JSON.stringify({ kind, payload }) });
  }
  async function pollOnce() {
    let d;
    try { d = await api(`/api/rides/${rideId}/call-signal?after=${lastSignalId}`); } catch { return; }
    for (const s of d.signals || []) {
      lastSignalId = Math.max(lastSignalId, s.id);
      if (s.sender_role === myRole) continue; // ignore my own signals
      await handleSignal(s);
    }
  }
  async function handleSignal(s) {
    try {
      if (s.kind === "offer" && state === "idle") {
        remoteOffer = s.payload;
        setState("incoming");
      } else if (s.kind === "answer" && state === "calling" && pc) {
        clearTimeout(noAnswerTimer); noAnswerTimer = null;
        await pc.setRemoteDescription(new RTCSessionDescription(s.payload));
        setState("in-call");
      } else if (s.kind === "ice" && pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(s.payload.candidate || s.payload)); } catch {}
      } else if (s.kind === "end") {
        endLocal("ended");
      }
    } catch {}
  }
  async function startCall() {
    if (state !== "idle") return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch { setState("failed"); return; }
    pc = makePc();
    localStream.getTracks().forEach((tr) => pc.addTrack(tr, localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    try { await postSignal("offer", { type: offer.type, sdp: offer.sdp }); } catch { cleanup(); setState("failed"); return; }
    setState("calling");
    startPolling();
    noAnswerTimer = setTimeout(() => {
      if (state === "calling") { endCall("no-answer"); }
    }, 30000);
  }
  async function acceptIncoming() {
    if (state !== "incoming" || !remoteOffer) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch { setState("failed"); return; }
    pc = makePc();
    localStream.getTracks().forEach((tr) => pc.addTrack(tr, localStream));
    await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    try { await postSignal("answer", { type: answer.type, sdp: answer.sdp }); } catch { cleanup(); setState("failed"); return; }
    setState("in-call");
  }
  async function rejectIncoming() {
    try { await postSignal("end", {}); } catch {}
    remoteOffer = null;
    setState("idle");
  }
  function toggleMute() {
    muted = !muted;
    if (localStream) localStream.getAudioTracks().forEach((tr) => { tr.enabled = !muted; });
    return muted;
  }
  function cleanup() {
    clearTimeout(noAnswerTimer); noAnswerTimer = null;
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (localStream) { localStream.getTracks().forEach((tr) => { try { tr.stop(); } catch {} }); localStream = null; }
    if (remoteAudio) { try { remoteAudio.srcObject = null; } catch {} }
    remoteOffer = null;
  }
  function endLocal(finalState) {
    cleanup();
    setState(finalState || "ended");
  }
  async function endCall(finalState) {
    try { await postSignal("end", {}); } catch {}
    endLocal(finalState || "ended");
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollOnce, 2000);
    pollOnce();
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  function reset() {
    stopPolling();
    cleanup();
    lastSignalId = 0;
    setState("idle");
  }
  return {
    startCall, acceptIncoming, rejectIncoming, endCall, toggleMute,
    startPolling, stopPolling, reset,
    getState: () => state, isMuted: () => muted,
    setLastSignalId: (id) => { lastSignalId = id; },
  };
}
