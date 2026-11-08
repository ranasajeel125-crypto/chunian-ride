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
}

// ---------- Toast (replaces every alert()) ----------
function toast(msg, kind) {
  let box = $("toast-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast-box";
    box.className = "toast-box";
    document.body.appendChild(box);
  }
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
