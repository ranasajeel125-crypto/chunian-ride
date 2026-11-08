// Chunian Ride — Admin dashboard (separate page, /admin).
// Session-cookie auth (same-origin). No PIN or credential is ever stored
// in the browser; the server session cookie is what authenticates requests.
// All numbers come from real API responses — no fake/demo data anywhere.
const $ = (id) => document.getElementById(id);
const store = { admin: null };
let lang = localStorage.getItem("cr_lang") || "en";
if (lang !== "ur") lang = "en";

// AC Car rate — APPROVED by the owner 2026-11-08: Rs 85/km, minimum Rs 200.
// Used as the fallback until the backend seeds rate_ac_car_per_km / min_ac_car.
const AC_CAR_RATE_DEFAULT = 85;
const AC_CAR_MIN_DEFAULT = 200;

const STRINGS = {
  en: {
    brand_sub: "Owner Admin",
    logout: "Logout",
    setup_title: "Owner account — first-time setup",
    setup_note: "This PIN works only once, to create the first owner account. After this, the PIN stops working and only phone + password login works.",
    setup_create: "Create owner account",
    login_title: "Owner / Admin — Login",
    login_note: "Only the owner admin account can open this dashboard.",
    login_open: "Open admin",
    back_to_app: "← Back to Chunian Ride app",
    label_name: "Owner name",
    label_phone: "Admin phone",
    label_pin: "One-time Admin PIN",
    label_password: "Admin password",
    label_new_password: "New password (at least 6 characters)",
    label_current_password: "Current password",
    nav_title: "Admin",
    nav_overview: "Overview",
    nav_rides: "Rides",
    nav_drivers: "Drivers",
    nav_users: "Users",
    nav_topups: "Top-ups",
    nav_wallets: "Wallets",
    nav_promos: "Promo Codes",
    nav_complaints: "Complaints",
    nav_cities: "Cities",
    nav_settings: "Settings",
    nav_audit: "Audit Log",
    nav_security: "Security",
    refresh: "Refresh",
    loading: "Loading…",
    overview_title: "Overview",
    live_drivers_title: "Live Drivers — Online now",
    report_title: "7-Day Report",
    profit_title: "Profit Calculator — ESTIMATES ONLY",
    profit_note: "Research estimate: lean monthly cost ~Rs 60,000. Break-even needs about 30–50 rides/day. This is only an estimate — no guarantee.",
    calc_fare: "Average fare (Rs)",
    calc_cost: "Monthly cost (Rs)",
    calculate: "Calculate",
    rides_title: "All Rides",
    drivers_title: "Drivers — Approve / Block",
    users_title: "Passengers & Drivers — Manage",
    topups_title: "Top-up Requests",
    topup_warning: "Approve only after you have verified the TID in your own JazzCash app. The driver's wallet is credited only when you approve — a fake TID buys nothing.",
    wallets_title: "Wallet Ledger — Driver's account",
    ledger_label: "Driver user ID",
    ledger_show: "Show ledger",
    promos_title: "Promo Codes",
    promo_note: "Promo codes are created here. Applying a discount to the fare comes in a later phase.",
    promo_create_title: "Create promo code",
    promo_code: "Code — e.g. CHUNIAN10",
    promo_type: "Discount type",
    promo_percent: "Percent %",
    promo_fixed: "Fixed Rs",
    promo_value: "Discount — % or Rs",
    promo_max: "Max uses (0 = unlimited)",
    promo_from: "Valid from (optional)",
    promo_to: "Valid to (optional)",
    promo_create: "Create promo",
    complaints_title: "Complaints & SOS",
    sos_note: "SOS is an emergency — Police 15, Rescue 1122. Resolve a complaint here only after it has been handled.",
    cities_title: "Cities — Service areas",
    cities_note: "Cities added here appear in the rider app's pickup / destination list. Deactivating a city hides it from riders.",
    city_add_title: "Add a city",
    city_name: "City name",
    city_km: "Distance from Chunian (km)",
    city_lat: "Latitude",
    city_lng: "Longitude",
    city_note: "Note (optional)",
    city_add: "Add city",
    settings_title: "Fare & Commission Settings",
    settings_note: "Settings apply immediately to new fare estimates. Commission default 12% + Rs 20 booking fee. AC Car rate Rs 85/km, minimum Rs 200.",
    settings_fares: "Fare rates (Rs per km)",
    rate_bike: "Bike Rs/km",
    rate_rickshaw: "Rickshaw Rs/km",
    rate_car: "Car Rs/km",
    rate_ac_car: "AC Car Rs/km",
    settings_mins: "Minimum fares (Rs)",
    min_bike: "Minimum — Bike",
    min_rickshaw: "Minimum — Rickshaw",
    min_car: "Minimum — Car",
    min_ac_car: "Minimum — AC Car",
    settings_fees: "Commission & fees",
    commission: "Commission %",
    booking_fee: "Booking fee Rs / ride",
    min_topup: "Minimum top-up (Rs)",
    settings_numbers: "Payment & support numbers",
    jazzcash: "JazzCash number",
    sadapay: "Sadapay number",
    support_phone: "Support phone",
    support_whatsapp: "Support WhatsApp",
    settings_save: "Save settings",
    audit_title: "Audit Log",
    security_title: "Security",
    pw_title: "Change admin password",
    pw_change: "Change password",
    demo_title: "Demo accounts",
    demo_note: "Suspends every demo account and takes demo drivers offline. Demo data is for testing only — a real launch must not have claimable demo accounts offering rides.",
    demo_disable: "Disable all demo accounts",
    logout_title: "Logout",
    logout_note: "Signs you out of the admin dashboard on this device.",
    // Stat labels
    stat_users: "Users",
    stat_riders: "Riders",
    stat_drivers: "Drivers",
    stat_online: "Drivers online",
    stat_rides_today: "Rides today",
    stat_rides_total: "Rides total",
    stat_completed_today: "Completed today",
    stat_pending_topups: "Pending top-ups",
    stat_open_complaints: "Open complaints",
    stat_pending_drivers: "Pending drivers",
    stat_rev_today: "Revenue today",
    stat_rev_7d: "Revenue 7 days",
    // Dynamic / toasts / errors
    err_setup_fields: "Phone, PIN and new password are required.",
    err_login_fields: "Phone and password are required.",
    err_pw_fields: "Current and new password are both required.",
    err_ledger_id: "Enter a driver user ID.",
    err_promo_fields: "Code and discount are required.",
    err_city_fields: "City name, latitude and longitude are required.",
    err_not_available: "This data is not available yet — the server endpoint is not live.",
    err_load: "Could not load this section. Please try again.",
    err_session: "Your session ended — please log in again.",
    toast_setup_done: "Owner account created. The PIN will not work again — use phone + password from now on.",
    toast_login: "Admin opened.",
    toast_saved: "Settings saved — new fares apply immediately.",
    toast_pw_changed: "Password changed.",
    toast_demo_disabled: "Demo accounts disabled.",
    toast_logged_out: "Logged out.",
    toast_topup_approved: "Top-up approved — driver wallet credited.",
    toast_topup_rejected: "Top-up rejected — no balance changed.",
    toast_driver_approved: "Driver approved.",
    toast_driver_blocked: "Driver blocked.",
    toast_user_suspended: "User suspended.",
    toast_user_reactivated: "User reactivated.",
    toast_complaint_resolved: "Complaint resolved.",
    toast_promo_created: "Promo code created.",
    toast_promo_deactivated: "Promo deactivated.",
    toast_city_added: "City added — it now shows in the rider app.",
    toast_city_deactivated: "City deactivated.",
    toast_city_activated: "City activated.",
    empty_rides: "No rides yet.",
    empty_drivers: "No drivers yet.",
    empty_users: "No users yet.",
    empty_topups: "No pending top-ups.",
    empty_tx: "No transactions yet.",
    empty_complaints: "No complaints.",
    empty_cities: "No cities yet.",
    empty_promos: "No promo codes yet.",
    empty_audit: "No audit log entries yet.",
    empty_live: "No driver online right now.",
    empty_report: "No completed rides in the last 7 days.",
    approve: "Approve",
    block: "Block",
    suspend: "Suspend",
    reactivate: "Reactivate",
    resolve: "Resolve",
    deactivate: "Deactivate",
    activate: "Activate",
    reject: "Reject",
    reject_reason_ph: "Reject reason (optional)",
    approve_topup: "Approve — TID verified",
    status: "Status",
    online: "Online",
    offline: "Offline",
    wallet: "Wallet",
    rating_new: "New driver",
    rating_new_rider: "New rider",
    demo: "Demo",
    scheduled: "Scheduled",
    fee: "Fee",
    tip: "Tip",
    active: "Active",
    inactive: "Inactive",
    uses: "uses",
    unlimited: "unlimited",
    by_vehicle: "By vehicle",
    by_driver: "By driver",
    completed_rides: "completed rides",
    gross_fares: "Gross fares",
    platform_revenue: "Platform revenue",
    keep_per_ride: "Platform keep per ride",
    break_even: "Break-even",
    rides_per_day: "rides/day",
    per_month: "per month",
    monthly_gross: "Monthly gross",
    monthly_net: "Monthly net",
    balance: "Balance",
    tx_type: "Type",
    tx_note: "Note",
    tx_date: "Date",
    ride: "Ride",
    driver: "Driver",
    rider: "Rider",
    route: "Route",
    vehicle: "Vehicle",
    fare: "Fare",
    unknown: "—",
  },
  ur: {
    brand_sub: "اونر ایڈمن",
    logout: "لاگ آؤٹ",
    setup_title: "اونر اکاؤنٹ — پہلی بار سیٹ اپ",
    setup_note: "یہ PIN صرف ایک بار کام کرے گا، پہلا اونر اکاؤنٹ بنانے کے لیے۔ اس کے بعد PIN بند ہو جائے گا اور صرف فون + پاس ورڈ سے لاگ ان ہوگا۔",
    setup_create: "اونر اکاؤنٹ بنائیں",
    login_title: "اونر / ایڈمن — لاگ ان",
    login_note: "یہ ڈیش بورڈ صرف اونر ایڈمن اکاؤنٹ کھول سکتا ہے۔",
    login_open: "ایڈمن کھولیں",
    back_to_app: "← چنیاں رائیڈ ایپ پر واپس",
    label_name: "اونر کا نام",
    label_phone: "ایڈمن فون",
    label_pin: "ایک بار کا ایڈمن PIN",
    label_password: "ایڈمن پاس ورڈ",
    label_new_password: "نیا پاس ورڈ (کم از کم 6 حروف)",
    label_current_password: "موجودہ پاس ورڈ",
    nav_title: "ایڈمن",
    nav_overview: "جائزہ",
    nav_rides: "رائڈز",
    nav_drivers: "ڈرائیورز",
    nav_users: "یوزرز",
    nav_topups: "ٹاپ اپس",
    nav_wallets: "والیٹس",
    nav_promos: "پرومو کوڈز",
    nav_complaints: "شکایات",
    nav_cities: "شہر",
    nav_settings: "سیٹنگز",
    nav_audit: "آڈٹ لاگ",
    nav_security: "سیکیورٹی",
    refresh: "ریفریش",
    loading: "لوڈ ہو رہا ہے…",
    overview_title: "جائزہ",
    live_drivers_title: "لائیو ڈرائیورز — ابھی آن لائن",
    report_title: "7 دن کی رپورٹ",
    profit_title: "پرافٹ کیلکولیٹر — صرف اندازہ",
    profit_note: "ریسرچ کا اندازہ: ماہانہ خرچ تقریباً 60,000 روپے۔ بریک ایون کے لیے روزانہ تقریباً 30–50 رائڈز چاہئیں۔ یہ صرف اندازہ ہے — کوئی گارنٹی نہیں۔",
    calc_fare: "اوسط کرایہ (روپے)",
    calc_cost: "ماہانہ خرچ (روپے)",
    calculate: "حساب کریں",
    rides_title: "تمام رائڈز",
    drivers_title: "ڈرائیورز — منظور / بلاک کریں",
    users_title: "مسافر اور ڈرائیورز — مینج کریں",
    topups_title: "ٹاپ اپ درخواستیں",
    topup_warning: "اپروو صرف اس وقت کریں جب آپ نے اپنے جاز کیش ایپ میں TID چیک کر لیا ہو۔ ڈرائیور کا والیٹ صرف آپ کے اپروو کرنے پر بڑھے گا — جعلی TID سے کچھ نہیں ملتا۔",
    wallets_title: "والیٹ لیجر — ڈرائیور کا حساب",
    ledger_label: "ڈرائیور یوزر ID",
    ledger_show: "لیجر دکھائیں",
    promos_title: "پرومو کوڈز",
    promo_note: "پرومو کوڈز یہاں بنتے ہیں۔ کرائے پر ڈسکاؤنٹ لگانا اگلے مرحلے میں آئے گا۔",
    promo_create_title: "پرومو کوڈ بنائیں",
    promo_code: "کوڈ — مثال: CHUNIAN10",
    promo_type: "ڈسکاؤنٹ کی قسم",
    promo_percent: "فیصد %",
    promo_fixed: "مقررہ روپے",
    promo_value: "ڈسکاؤنٹ — % یا روپے",
    promo_max: "زیادہ سے زیادہ استعمال (0 = لا محدود)",
    promo_from: "کب سے (اختیاری)",
    promo_to: "کب تک (اختیاری)",
    promo_create: "پرومو بنائیں",
    complaints_title: "شکایات اور SOS",
    sos_note: "SOS ایمرجنسی ہے — پولیس 15، ریسکیو 1122۔ شکایت یہاں صرف اس وقت حل شدہ کریں جب اس پر کارروائی ہو چکی ہو۔",
    cities_title: "شہر — سروس ایریا",
    cities_note: "یہاں شامل کیے گئے شہر رائیڈر ایپ کی پک اپ / منزل کی فہرست میں آ جاتے ہیں۔ شہر بند کرنے سے وہ رائیڈرز کو نظر نہیں آئے گا۔",
    city_add_title: "شہر شامل کریں",
    city_name: "شہر کا نام",
    city_km: "چنیاں سے فاصلہ (کلومیٹر)",
    city_lat: "عرض بلد",
    city_lng: "طول بلد",
    city_note: "نوٹ (اختیاری)",
    city_add: "شہر شامل کریں",
    settings_title: "کرایہ اور کمیشن سیٹنگز",
    settings_note: "سیٹنگز نئے کرایہ کے اندازے پر فوراً لاگو ہوتی ہیں۔ کمیشن بطور ڈیفالٹ 12% + 20 روپے بکنگ فیس۔ AC کار ریٹ 85 روپے/کلومیٹر، کم از کم 200 روپے۔",
    settings_fares: "کرایہ ریٹ (روپے فی کلومیٹر)",
    rate_bike: "بائیک روپے/کلومیٹر",
    rate_rickshaw: "رکشہ روپے/کلومیٹر",
    rate_car: "کار روپے/کلومیٹر",
    rate_ac_car: "AC کار روپے/کلومیٹر",
    settings_mins: "کم از کم کرایہ (روپے)",
    min_bike: "کم از کم — بائیک",
    min_rickshaw: "کم از کم — رکشہ",
    min_car: "کم از کم — کار",
    min_ac_car: "کم از کم — AC کار",
    settings_fees: "کمیشن اور فیس",
    commission: "کمیشن %",
    booking_fee: "بکنگ فیس روپے / رائڈ",
    min_topup: "کم از کم ٹاپ اپ (روپے)",
    settings_numbers: "ادائیگی اور سپورٹ نمبر",
    jazzcash: "جاز کیش نمبر",
    sadapay: "سدا پے نمبر",
    support_phone: "سپورٹ فون",
    support_whatsapp: "سپورٹ واٹس ایپ",
    settings_save: "سیٹنگز محفوظ کریں",
    audit_title: "آڈٹ لاگ",
    security_title: "سیکیورٹی",
    pw_title: "ایڈمن پاس ورڈ بدلیں",
    pw_change: "پاس ورڈ بدلیں",
    demo_title: "ڈیمو اکاؤنٹس",
    demo_note: "تمام ڈیمو اکاؤنٹس معطل کر دیتا ہے اور ڈیمو ڈرائیورز کو آف لائن کر دیتا ہے۔ ڈیمو ڈیٹا صرف ٹیسٹنگ کے لیے ہے — اصل لانچ میں ڈیمو اکاؤنٹس نہیں ہونے چاہئیں۔",
    demo_disable: "تمام ڈیمو اکاؤنٹس بند کریں",
    logout_title: "لاگ آؤٹ",
    logout_note: "اس ڈیوائس پر ایڈمن ڈیش بورڈ سے سائن آؤٹ کرتا ہے۔",
    stat_users: "یوزرز",
    stat_riders: "رائڈرز",
    stat_drivers: "ڈرائیورز",
    stat_online: "ڈرائیورز آن لائن",
    stat_rides_today: "آج کی رائڈز",
    stat_rides_total: "کل رائڈز",
    stat_completed_today: "آج مکمل",
    stat_pending_topups: "زیر التواء ٹاپ اپس",
    stat_open_complaints: "کھلی شکایات",
    stat_pending_drivers: "زیر التواء ڈرائیورز",
    stat_rev_today: "آج کی آمدنی",
    stat_rev_7d: "7 دن کی آمدنی",
    err_setup_fields: "فون، PIN اور نیا پاس ورڈ ضروری ہیں۔",
    err_login_fields: "فون اور پاس ورڈ ضروری ہیں۔",
    err_pw_fields: "موجودہ اور نیا پاس ورڈ دونوں ضروری ہیں۔",
    err_ledger_id: "ڈرائیور یوزر ID لکھیں۔",
    err_promo_fields: "کوڈ اور ڈسکاؤنٹ ضروری ہیں۔",
    err_city_fields: "شہر کا نام، عرض بلد اور طول بلد ضروری ہیں۔",
    err_not_available: "یہ ڈیٹا ابھی دستیاب نہیں — سرور کا اینڈ پوائنٹ ابھی لائیو نہیں۔",
    err_load: "یہ سیکشن لوڈ نہیں ہو سکا۔ دوبارہ کوشش کریں۔",
    err_session: "آپ کا سیشن ختم ہو گیا — دوبارہ لاگ ان کریں۔",
    toast_setup_done: "اونر اکاؤنٹ بن گیا۔ PIN دوبارہ کام نہیں کرے گا — اب سے فون + پاس ورڈ استعمال کریں۔",
    toast_login: "ایڈمن کھل گیا۔",
    toast_saved: "سیٹنگز محفوظ — نئے کرائے فوراً لاگو۔",
    toast_pw_changed: "پاس ورڈ بدل گیا۔",
    toast_demo_disabled: "ڈیمو اکاؤنٹس بند کر دیے گئے۔",
    toast_logged_out: "لاگ آؤٹ ہو گیا۔",
    toast_topup_approved: "ٹاپ اپ اپروو — ڈرائیور والیٹ میں رقم آ گئی۔",
    toast_topup_rejected: "ٹاپ اپ مسترد — کوئی بیلنس نہیں بدلا۔",
    toast_driver_approved: "ڈرائیور منظور ہو گیا۔",
    toast_driver_blocked: "ڈرائیور بلاک ہو گیا۔",
    toast_user_suspended: "یوزر معطل ہو گیا۔",
    toast_user_reactivated: "یوزر بحال ہو گیا۔",
    toast_complaint_resolved: "شکایت حل ہو گئی۔",
    toast_promo_created: "پرومو کوڈ بن گیا۔",
    toast_promo_deactivated: "پرومو بند کر دیا گیا۔",
    toast_city_added: "شہر شامل ہو گیا — اب یہ رائیڈر ایپ میں نظر آئے گا۔",
    toast_city_deactivated: "شہر بند کر دیا گیا۔",
    toast_city_activated: "شہر فعال کر دیا گیا۔",
    empty_rides: "ابھی کوئی رائڈ نہیں۔",
    empty_drivers: "ابھی کوئی ڈرائیور نہیں۔",
    empty_users: "ابھی کوئی یوزر نہیں۔",
    empty_topups: "کوئی زیر التواء ٹاپ اپ نہیں۔",
    empty_tx: "ابھی کوئی لین دین نہیں۔",
    empty_complaints: "کوئی شکایت نہیں۔",
    empty_cities: "ابھی کوئی شہر نہیں۔",
    empty_promos: "ابھی کوئی پرومو کوڈ نہیں۔",
    empty_audit: "ابھی کوئی آڈٹ لاگ نہیں۔",
    empty_live: "ابھی کوئی ڈرائیور آن لائن نہیں۔",
    empty_report: "پچھلے 7 دنوں میں کوئی مکمل رائڈ نہیں۔",
    approve: "منظور کریں",
    block: "بلاک کریں",
    suspend: "معطل کریں",
    reactivate: "بحال کریں",
    resolve: "حل شدہ کریں",
    deactivate: "بند کریں",
    activate: "فعال کریں",
    reject: "مسترد کریں",
    reject_reason_ph: "مسترد کرنے کی وجہ (اختیاری)",
    approve_topup: "اپروو — TID چیک شدہ",
    status: "حالت",
    online: "آن لائن",
    offline: "آف لائن",
    wallet: "والیٹ",
    rating_new: "نیا ڈرائیور",
    rating_new_rider: "نیا رائیڈر",
    demo: "ڈیمو",
    scheduled: "شیڈول شدہ",
    fee: "فیس",
    tip: "ٹپ",
    active: "فعال",
    inactive: "غیر فعال",
    uses: "استعمال",
    unlimited: "لا محدود",
    by_vehicle: "گاڑی کے لحاظ سے",
    by_driver: "ڈرائیور کے لحاظ سے",
    completed_rides: "مکمل رائڈز",
    gross_fares: "کل کرائے",
    platform_revenue: "پلیٹ فارم آمدنی",
    keep_per_ride: "فی رائڈ پلیٹ فارم حصہ",
    break_even: "بریک ایون",
    rides_per_day: "رائڈز/دن",
    per_month: "فی مہینہ",
    monthly_gross: "ماہانہ کل",
    monthly_net: "ماہانہ خالص",
    balance: "بیلنس",
    tx_type: "قسم",
    tx_note: "نوٹ",
    tx_date: "تاریخ",
    ride: "رائڈ",
    driver: "ڈرائیور",
    rider: "رائڈر",
    route: "راستہ",
    vehicle: "گاڑی",
    fare: "کرایہ",
    unknown: "—",
  },
};

function t(key) {
  return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(ts) {
  if (!ts) return t("unknown");
  return new Date(Number(ts)).toLocaleString();
}
function fmtSched(ts) {
  if (!ts) return "";
  return new Date(Number(ts)).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function ratingText(rating, count, who) {
  const n = Number(count || 0);
  if (n > 0) return `⭐ ${Number(rating).toFixed(1)}`;
  return who === "rider" ? t("rating_new_rider") : t("rating_new");
}
function statusBadge(s) {
  const map = {
    approved: "green", active: "green", completed: "green", resolved: "green",
    pending: "amber", requested: "amber", open: "amber",
    blocked: "red", suspended: "red", rejected: "red", cancelled: "red",
    ongoing: "amber", accepted: "amber",
  };
  return `<span class="badge ${map[String(s || "").toLowerCase()] || "grey"}">${escapeHtml(s || t("unknown"))}</span>`;
}

function toast(msg, kind) {
  const el = document.createElement("div");
  el.className = "toast" + (kind === "ok" ? " ok" : kind === "err" ? " err" : "");
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || ("HTTP " + res.status), res.status);
  return data;
}

// Any 401 returns to the login screen (plan §6).
function handleApiError(e, inlineEl) {
  if (e && e.status === 401) { showLogin(t("err_session")); return; }
  const msg = (e && e.message) || t("err_load");
  if (inlineEl) inlineEl.textContent = msg;
  else toast(msg, "err");
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  btn.disabled = !!busy;
  if (label != null) btn.textContent = label;
}

// ---- i18n ----
function applyLang() {
  document.documentElement.lang = lang === "ur" ? "ur" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (STRINGS[lang][key] != null) el.textContent = t(key);
  });
  $("lang-toggle").textContent = lang === "ur" ? "English" : "اردو";
  localStorage.setItem("cr_lang", lang);
  // Re-render the visible section so dynamic strings switch too.
  if (store.admin) loadSection(currentSection, true);
}
function toggleLang() {
  lang = lang === "ur" ? "en" : "ur";
  applyLang();
}

// ---- Views ----
function showView(name) {
  ["setup", "login", "dash"].forEach((v) => $("view-" + v).classList.toggle("hidden", v !== name));
  $("logout-btn").classList.toggle("hidden", name !== "dash");
  $("admin-who").classList.toggle("hidden", name !== "dash");
}
function showSetup() {
  store.admin = null;
  $("admin-who").textContent = "";
  showView("setup");
}
function showLogin(msg) {
  store.admin = null;
  $("admin-who").textContent = "";
  if (msg) $("login-error").textContent = msg;
  showView("login");
}
function openDash(admin) {
  store.admin = admin;
  $("admin-who").textContent = `${admin.name} (${admin.phone})`;
  showView("dash");
  loadSection("overview");
  refreshBadges();
}

// ---- Section router ----
let currentSection = "overview";
const loaders = {
  overview: loadOverview,
  rides: loadRides,
  drivers: loadDrivers,
  users: loadUsers,
  topups: loadTopups,
  wallets: null, // form-driven; nothing to auto-load
  promos: loadPromos,
  complaints: loadComplaints,
  cities: loadCities,
  settings: loadSettings,
  audit: loadAudit,
  security: null, // form-driven
};
function showSection(name) {
  currentSection = name;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.section === name));
  document.querySelectorAll(".dash-section").forEach((s) => s.classList.toggle("hidden", s.id !== "sec-" + name));
  const picker = $("section-picker");
  if (picker.value !== name) picker.value = name;
  loadSection(name);
}
function loadSection(name, keepScroll) {
  const fn = loaders[name];
  if (fn) fn();
}
async function refreshBadges() {
  try {
    const d = await api("/api/admin/overview");
    setBadge("badge-topups", d.pending_topups);
    setBadge("badge-complaints", d.open_complaints);
    setBadge("badge-drivers", d.pending_drivers);
  } catch { /* overview endpoint may not exist yet; badges stay hidden */ }
}
function setBadge(id, n) {
  const el = $(id);
  if (!el) return;
  const num = Number(n || 0);
  el.classList.toggle("hidden", num <= 0);
  el.textContent = String(num);
}

// ---- Auth ----
async function checkSetup() {
  try {
    const d = await api("/api/admin/setup-needed");
    if (d.setup_needed) { showSetup(); return; }
    // Session restore: if the admin cookie is still valid, open the dashboard.
    try {
      const me = await api("/api/auth/me");
      if (me.admin) { openDash(me.admin); return; }
    } catch { /* not logged in — show login */ }
    showLogin();
  } catch (e) {
    $("login-error").textContent = (e && e.message) || t("err_load");
    showLogin();
  }
}
async function doSetup(btn) {
  const name = $("setup-name").value.trim();
  const phone = $("setup-phone").value.trim();
  const pin = $("setup-pin").value.trim();
  const password = $("setup-password").value;
  const err = $("setup-error");
  err.textContent = "";
  if (!phone || !pin || !password) { err.textContent = t("err_setup_fields"); return; }
  setBusy(btn, true, "…");
  try {
    const d = await api("/api/admin/setup", { method: "POST", body: JSON.stringify({ pin, name: name || "Owner", phone, password }) });
    $("setup-pin").value = ""; $("setup-password").value = "";
    toast(d.message || t("toast_setup_done"), "ok");
    openDash(d.admin);
  } catch (e) { handleApiError(e, err); }
  finally { setBusy(btn, false); btn.textContent = t("setup_create"); }
}
async function doLogin(btn) {
  const phone = $("login-phone").value.trim();
  const password = $("login-password").value;
  const err = $("login-error");
  err.textContent = "";
  if (!phone || !password) { err.textContent = t("err_login_fields"); return; }
  setBusy(btn, true, "…");
  try {
    const d = await api("/api/admin/login", { method: "POST", body: JSON.stringify({ phone, password }) });
    $("login-password").value = "";
    toast(t("toast_login"), "ok");
    openDash(d.admin);
  } catch (e) { handleApiError(e, err); }
  finally { setBusy(btn, false); btn.textContent = t("login_open"); }
}
async function doLogout() {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch { /* session may already be gone */ }
  toast(t("toast_logged_out"));
  showLogin();
}

// ---- Overview ----
async function loadOverview() {
  const errEl = $("overview-error");
  errEl.textContent = "";
  const statsEl = $("overview-stats");
  statsEl.innerHTML = `<p class="loading">${escapeHtml(t("loading"))}</p>`;
  try {
    const d = await api("/api/admin/overview");
    const tot = d.totals || {};
    const cards = [
      ["stat_users", tot.users], ["stat_riders", tot.riders], ["stat_drivers", tot.drivers],
      ["stat_online", tot.drivers_online], ["stat_rides_today", tot.rides_today],
      ["stat_rides_total", tot.rides_total], ["stat_completed_today", tot.completed_today],
      ["stat_pending_topups", d.pending_topups], ["stat_open_complaints", d.open_complaints],
      ["stat_pending_drivers", d.pending_drivers],
      ["stat_rev_today", d.platform_revenue_today != null ? "Rs " + d.platform_revenue_today : t("unknown")],
      ["stat_rev_7d", d.platform_revenue_7d != null ? "Rs " + d.platform_revenue_7d : t("unknown")],
    ];
    statsEl.innerHTML = cards.map(([k, v]) => `<div class="stat"><div class="label">${escapeHtml(t(k))}</div><div class="value">${escapeHtml(v == null ? t("unknown") : v)}</div></div>`).join("");
    setBadge("badge-topups", d.pending_topups);
    setBadge("badge-complaints", d.open_complaints);
    setBadge("badge-drivers", d.pending_drivers);
  } catch (e) {
    if (e && e.status === 401) { showLogin(t("err_session")); return; }
    statsEl.innerHTML = "";
    errEl.textContent = e && e.status === 404 ? t("err_not_available") : ((e && e.message) || t("err_load"));
  }
  loadLiveDrivers();
  loadReport();
}
async function loadLiveDrivers() {
  const el = $("live-drivers");
  try {
    const d = await api("/api/admin/live-drivers");
    el.innerHTML = d.drivers.length
      ? d.drivers.map((x) => `<div class="row-item"><b>${escapeHtml(x.name)}</b> — ${escapeHtml(x.vehicle_type)} • ${escapeHtml(x.vehicle_model || "")} • ${escapeHtml(x.plate || "")} • ${escapeHtml(ratingText(x.rating, x.rating_count, "driver"))} • ${escapeHtml(t("wallet"))} Rs ${Number(x.wallet_balance || 0)} • (${Number(x.lat)}, ${Number(x.lng)})</div>`).join("")
      : `<div class="empty">${escapeHtml(t("empty_live"))}</div>`;
  } catch (e) {
    if (e && e.status === 401) { showLogin(t("err_session")); return; }
    el.innerHTML = `<p class="inline-error">${escapeHtml((e && e.message) || t("err_load"))}</p>`;
  }
}
async function loadReport() {
  const el = $("report-out");
  try {
    const d = await api("/api/admin/reports?days=7");
    if (!d.rides) { el.innerHTML = `<div class="empty">${escapeHtml(t("empty_report"))}</div>`; return; }
    el.innerHTML = `<p><b>7 days:</b> ${Number(d.rides)} ${escapeHtml(t("completed_rides"))} • ${escapeHtml(t("gross_fares"))} Rs ${Number(d.gross_fares)} • ${escapeHtml(t("platform_revenue"))} Rs ${Number(d.platform_revenue)}</p>`
      + (d.by_vehicle || []).map((v) => `<p>${escapeHtml(v.vehicle_type)}: ${Number(v.rides)} ${escapeHtml(t("completed_rides"))}, Rs ${Number(v.gross)}</p>`).join("")
      + `<h3 style="margin-top:12px">${escapeHtml(t("by_driver"))}</h3>`
      + (d.by_driver || []).map((x) => `<p>${escapeHtml(x.name)}: ${Number(x.rides)} ${escapeHtml(t("completed_rides"))}, ${escapeHtml(t("gross_fares"))} Rs ${Number(x.gross)}, ${escapeHtml(t("platform_revenue"))} Rs ${Number(x.platform)}</p>`).join("");
  } catch (e) {
    if (e && e.status === 401) { showLogin(t("err_session")); return; }
    el.innerHTML = `<p class="inline-error">${escapeHtml((e && e.message) || t("err_load"))}</p>`;
  }
}
async function loadProfit() {
  const el = $("profit-out");
  const fare = $("calc-fare").value || 300;
  const cost = $("calc-cost").value || 60000;
  el.innerHTML = `<p class="loading">${escapeHtml(t("loading"))}</p>`;
  try {
    const d = await api(`/api/admin/profit?avg_fare=${encodeURIComponent(fare)}&monthly_cost=${encodeURIComponent(cost)}`);
    el.innerHTML = `<p><b>ESTIMATES ONLY</b></p>
      <p>${escapeHtml(t("keep_per_ride"))}: Rs ${Number(d.platform_keep_per_ride)} (${escapeHtml(t("commission"))} ${Number(d.commission_pct)}% + Rs ${Number(d.booking_fee)} ${escapeHtml(t("booking_fee"))}, ${escapeHtml(t("calc_fare"))} Rs ${Number(d.avg_fare)})</p>
      <p>${escapeHtml(t("break_even"))}: <b>${Number(d.break_even_rides_per_day)} ${escapeHtml(t("rides_per_day"))}</b> (${Number(d.break_even_rides_per_month)} ${escapeHtml(t("per_month"))}) — ${escapeHtml(t("calc_cost"))} Rs ${Number(d.monthly_cost)}</p>`
      + (d.scenarios || []).map((s) => `<p>${Number(s.rides_per_day)} ${escapeHtml(t("rides_per_day"))} → ${escapeHtml(t("monthly_gross"))} Rs ${Number(s.monthly_gross)}, ${escapeHtml(t("monthly_net"))} Rs ${Number(s.monthly_net)}</p>`).join("");
  } catch (e) {
    if (e && e.status === 401) { showLogin(t("err_session")); return; }
    el.innerHTML = `<p class="inline-error">${escapeHtml((e && e.message) || t("err_load"))}</p>`;
  }
}

// ---- Rides ----
async function loadRides() {
  const el = $("rides-out");
  el.innerHTML = `<p class="loading">${escapeHtml(t("loading"))}</p>`;
  try {
    const d = await api("/api/admin/rides");
    if (!d.rides.length) { el.innerHTML = `<div class="empty">${escapeHtml(t("empty_rides"))}</div>`; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>#</th><th>${escapeHtml(t("rider"))}</th><th>${escapeHtml(t("driver"))}</th><th>${escapeHtml(t("route"))}</th><th>${escapeHtml(t("vehicle"))}</th><th>${escapeHtml(t("fare"))}</th><th>${escapeHtml(t("fee"))}</th><th>${escapeHtml(t("status"))}</th><th>${escapeHtml(t("tx_date"))}</th></tr></thead><tbody>`
      + d.rides.map((r) => `<tr><td>${Number(r.id)}</td><td>${escapeHtml(r.rider_name)}</td><td>${escapeHtml(r.driver_name || t("unknown"))}</td><td>${escapeHtml(r.pickup)} → ${escapeHtml(r.destination)}${r.scheduled_for ? `<br><span class="badge amber">🕐 ${escapeHtml(t("scheduled"))}: ${escapeHtml(fmtSched(r.scheduled_for))}</span>` : ""}</td><td>${escapeHtml(r.vehicle_type)}</td><td>Rs ${Number(r.agreed_fare || r.suggested_fare)}${r.tip_amount ? `<br>${escapeHtml(t("tip"))} Rs ${Number(r.tip_amount)}` : ""}</td><td>${r.commission_charged ? "Rs " + Number(r.commission_charged) : t("unknown")}</td><td>${statusBadge(r.status)}</td><td>${escapeHtml(fmtDate(r.created_at))}</td></tr>`).join("")
      + "</tbody></table></div>";
  } catch (e) { handleApiError(e); el.innerHTML = `<p class="inline-error">${escapeHtml((e && e.message) || t("err_load"))}</p>`; }
}

// ---- Drivers ----
async function loadDrivers() {
  const el = $("drivers-out");
  el.innerHTML = `<p class="loading">${escapeHtml(t("loading"))}</p>`;
  try {
    const d = await api("/api/admin/drivers");
    if (!d.drivers.length) { el.innerHTML = `<div class="empty">${escapeHtml(t("empty_drivers"))}</div>`; return; }
    el.innerHTML = d.drivers.map((x) => `<div class="row-item">
      <b>${escapeHtml(x.name)}</b> (${escapeHtml(x.phone)}) — ${escapeHtml(x.vehicle_type)} • ${escapeHtml(x.vehicle_model || "")} • ${escapeHtml(x.plate || "")}<br>
      <span class="muted">CNIC: ${escapeHtml(x.cnic || t("unknown"))} • Licence: ${escapeHtml(x.licence || t("unknown"))} • Reg: ${escapeHtml(x.vehicle_reg || t("unknown"))}</span><br>
      ${escapeHtml(t("status"))}: ${statusBadge(x.status)} • Docs: ${statusBadge(x.documents_status || "pending")} • Rating: ${escapeHtml(ratingText(x.rating, x.rating_count, "driver"))}${x.demo ? ` • ${escapeHtml(t("demo"))}` : ""} • ${escapeHtml(t("wallet"))} Rs ${Number(x.wallet_balance || 0)} • ${x.online ? escapeHtml(t("online")) : escapeHtml(t("offline"))}
      <div class="row-actions">
        ${x.status !== "approved" ? `<button type="button" class="primary small" data-driver-action="approve" data-id="${Number(x.user_id)}">${escapeHtml(t("approve"))}</button>` : ""}
        ${x.status !== "blocked" ? `<button type="button" class="danger small" data-driver-action="block" data-id="${Number(x.user_id)}">${escapeHtml(t("block"))}</button>` : ""}
      </div></div>`).join("");
  } catch (e) { handleApiError(e); el.innerHTML = `<p class="inline-error">${escapeHtml((e && e.message) || t("err_load"))}</p>`; }
}
async function driverAction(id, action) {
  try {
    await api(`/api/admin/drivers/${id}/${action}`, { method: "POST", body: "{}" });
    toast(action === "approve" ? t("toast_driver_approved") : t("toast_driver_blocked"), "ok");
    loadDrivers(); refreshBadges();
  } catch (e) { handleApiError(e); }
}

// ---- Users ----
async function loadUsers() {
  const el = $("users-out");
  el.innerHTML = `<p class="loading">${escapeHtml(t("loading"))}</p>`;
  try {
    const d = await api("/api/admin/users");
    if (!d.users.length) { el.innerHTML = `<div class="empty">${escapeHtml(t("empty_users"))}</div>`; return; }
    el.innerHTML = d.users.map((u) => `<div class="row-item">
      <b>${escapeHtml(u.name)}</b> (${escapeHtml(u.phone)}) — ${escapeHtml(u.role)} • ${escapeHtml(t("status"))}: ${statusBadge(u.status || "active")}${u.demo ? ` • ${escapeHtml(t("demo"))}` : ""} • ${escapeHtml(ratingText(u.rating, u.rating_count, u.role === "driver" ? "driver" : "rider"))} • ${escapeHtml(t("wallet"))} Rs ${Number(u.wallet_balance || 0)}${u.driver_status ? ` • ${escapeHtml(t("driver"))}: ${escapeHtml(u.driver_status)}` : ""}
      <div class="row-actions">${u.status === "suspended"
        ? `<button type="button" class="small" data-user-action="reactivate" data-id="${Number(u.id)}">${escapeHtml(t("reactivate"))}</button>`
        : `<button type="button" class="danger small" data-user-action="suspend" data-id="${Number(u.id)}">${escapeHtml(t("suspend"))}</button>`}</div></div>`).join("");
  } catch (e) { handleApiError(e); el.innerHTML = `<p class="inline-error">${escapeHtml((e && e.message) || t("err_load"))}</p>`; }
}
async function userAction(id, action) {
  try {
    await api(`/api/admin/users/${id}/${action}`, { method: "POST", body: "{}" });
    toast(action === "suspend" ? t("toast_user_suspended") : t("toast_user_reactivated"), "ok");
    loadUsers();
  } catch (e) { handleApiError(e); }
}

// ---- Top-ups ----
async function loadTopups() {
  const el = $("topups-out");
  el.innerHTML = `<p class="loading">${escapeHtml(t("loading"))}</p>`;
  try {
    const d = await api("/api/admin/topups?status=pending");
    if (!d.topups.length) { el.innerHTML = `<div class="empty">${escapeHtml(t("empty_topups"))}</div>`; return; }
    el.innerHTML = d.topups.map((x) => `<div class="row-item">
      <b>${escapeHtml(t("topups_title"))} #${Number(x.id)}</b> — ${escapeHtml(x.driver_name)} (${escapeHtml(x.driver_phone)}) • Rs ${Number(x.amount)} • ${escapeHtml(x.method || "JazzCash")} • TID <b>${escapeHtml(x.tid || t("unknown"))}</b><br>
      <span class="muted">${escapeHtml(fmtDate(x.created_at))}</span>
      <div class="row-actions">
        <button type="button" class="primary small" data-topup-action="approve" data-id="${Number(x.id)}">${escapeHtml(t("approve_topup"))}</button>
        <input type="text" data-reject-reason="${Number(x.id)}" placeholder="${escapeHtml(t("reject_reason_ph"))}" maxlength="200">
        <button type="button" class="danger small" data-topup-action="reject" data-id="${Number(x.id)}">${escapeHtml(t("reject"))}</button>
      </div></div>`).join("");
  } catch (e) { handleApiError(e); el.innerHTML = `<p class="inline-error">${escapeHtml((e && e.message) || t("err_load"))}</p>`; }
}
async function topupAction(id, action) {
  try {
    const body = {};
    if (action === "reject") {
      const input = document.querySelector(`[data-reject-reason="${id}"]`);
      body.reason = input ? input.value.trim() : "";
    }
    const d = await api(`/api/admin/topups/${id}/${action}`, { method: "POST", body: JSON.stringify(body) });
    toast(action === "approve" ? `${t("toast_topup_approved")} (Rs ${Number(d.amount || 0)})` : t("toast_topup_rejected"), "ok");
    loadTopups(); refreshBadges();
  } catch (e) { handleApiError(e); }
}

// ---- Wallets ----
async function loadLedger(btn) {
  const id = $("ledger-driver").value.trim();
  const el = $("ledger-out");
  if (!id) { el.innerHTML = `<p class="inline-error">${escapeHtml(t("err_ledger_id"))}</p>`; return; }
  el.innerHTML = `<p class="loading">${escapeHtml(t("loading"))}</p>`;
  setBusy(btn, true, "…");
  try {
    const d = await api(`/api/admin/wallet/${encodeURIComponent(id)}`);
    el.innerHTML = `<p><b>${escapeHtml(t("balance"))}: Rs ${Number(d.wallet_balance || 0)}</b> (user #${escapeHtml(id)})</p>`
      + (d.transactions && d.transactions.length
        ? `<div class="table-wrap"><table><thead><tr><th>${escapeHtml(t("tx_type"))}</th><th>Rs</th><th>${escapeHtml(t("tx_note"))}</th><th>${escapeHtml(t("tx_date"))}</th></tr></thead><tbody>`
          + d.transactions.map((tx) => `<tr><td>${escapeHtml(tx.type)}</td><td>${Number(tx.amount)}</td><td>${escapeHtml(tx.note || "")}${tx.tid ? ` • TID ${escapeHtml(tx.tid)}` : ""}</td><td>${escapeHtml(fmtDate(tx.created_at))}</td></tr>`).join("") + "</tbody></table></div>"
        : `<div class="empty">${escapeHtml(t("empty_tx"))}</div>`);
  } catch (e) {
    if (e && e.status === 401) { showLogin(t("err_session")); return; }
    el.innerHTML = `<p class="inline-error">${escapeHtml((e && e.message) || t("err_load"))}</p>`;
  } finally { setBusy(btn, false); btn.textContent = t("ledger_show"); }
}

// ---- Promo codes ----
async function createPromo(btn) {
  const code = $("promo-code").value.trim();
  const discount_type = $("promo-type").value;
  const discount_value = Number($("promo-value").value);
  const max_uses = Number($("promo-max").value || 0);
  const from = $("promo-from").value ? new Date($("promo-from").value + "T00:00:00").getTime() : null;
  const to = $("promo-to").value ? new Date($("promo-to").value + "T23:59:59").getTime() : null;
  const err = $("promo-error");
  err.textContent = "";
  if (!code || !discount_value) { err.textContent = t("err_promo_fields"); return; }
  setBusy(btn, true, "…");
  try {
    const d = await api("/api/admin/promo-codes", { method: "POST", body: JSON.stringify({ code, discount_type, discount_value, max_uses, valid_from: from, valid_to: to }) });
    toast(`${t("toast_promo_created")} (${d.code})`, "ok");
    $("promo-code").value = ""; $("promo-value").value = ""; $("promo-max").value = "0"; $("promo-from").value = ""; $("promo-to").value = "";
    loadPromos();
  } catch (e) { handleApiError(e, err); }
  finally { setBusy(btn, false); btn.textContent = t("promo_create"); }
}
async function loadPromos() {
  const el = $("promos-out");
  el.innerHTML = `<p class="loading">${escapeHtml(t("loading"))}</p>`;
  try {
    const d = await api("/api/admin/promo-codes");
    if (!d.promo_codes.length) { el.innerHTML = `<div class="empty">${escapeHtml(t("empty_promos"))}</div>`; return; }
    el.innerHTML = d.promo_codes.map((p) => `<div class="row-item">
      <b>${escapeHtml(p.code)}</b> — ${escapeHtml(p.discount_type)} ${Number(p.discount_value)} • ${escapeHtml(t("status"))}: ${p.active ? `<span class="badge green">${escapeHtml(t("active"))}</span>` : `<span class="badge grey">${escapeHtml(t("inactive"))}</span>`} • ${Number(p.uses || 0)}/${Number(p.max_uses || 0) ? Number(p.max_uses) : escapeHtml(t("unlimited"))} ${escapeHtml(t("uses"))}${p.valid_from ? ` • ${escapeHtml(fmtDate(p.valid_from))}` : ""}${p.valid_to ? ` → ${escapeHtml(fmtDate(p.valid_to))}` : ""}
      <div class="row-actions">${p.active ? `<button type="button" class="danger small" data-promo-action="deactivate" data-id="${Number(p.id)}">${escapeHtml(t("deactivate"))}</button>` : ""}</div></div>`).join("");
  } catch (e) { handleApiError(e); el.innerHTML = `<p class="inline-error">${escapeHtml((e && e.message) || t("err_load"))}</p>`; }
}
async function deactivatePromo(id) {
  try {
    await api(`/api/admin/promo-codes/${id}/deactivate`, { method: "POST", body: "{}" });
    toast(t("toast_promo_deactivated"), "ok");
    loadPromos();
  } catch (e) { handleApiError(e); }
}

// ---- Complaints ----
async function loadComplaints() {
  const el = $("complaints-out");
  el.innerHTML = `<p class="loading">${escapeHtml(t("loading"))}</p>`;
  try {
    const d = await api("/api/admin/complaints");
    if (!d.complaints.length) { el.innerHTML = `<div class="empty">${escapeHtml(t("empty_complaints"))}</div>`; return; }
    el.innerHTML = d.complaints.map((c) => `<div class="row-item">
      <b>${escapeHtml(String(c.kind || "").toUpperCase())}</b> — ${escapeHtml(t("ride"))} #${c.ride_id ? Number(c.ride_id) : t("unknown")} • ${escapeHtml(c.message || "")} • ${escapeHtml(t("status"))}: ${statusBadge(c.status)}<br>
      <span class="muted">${escapeHtml(fmtDate(c.created_at))}</span>
      <div class="row-actions">${c.status === "open" ? `<button type="button" class="primary small" data-complaint-action="resolve" data-id="${Number(c.id)}">${escapeHtml(t("resolve"))}</button>` : ""}</div></div>`).join("");
  } catch (e) { handleApiError(e); el.innerHTML = `<p class="inline-error">${escapeHtml((e && e.message) || t("err_load"))}</p>`; }
}
async function resolveComplaint(id) {
  try {
    await api(`/api/admin/complaints/${id}/resolve`, { method: "POST", body: "{}" });
    toast(t("toast_complaint_resolved"), "ok");
    loadComplaints(); refreshBadges();
  } catch (e) { handleApiError(e); }
}

// ---- Cities ----
async function loadCities() {
  const el = $("cities-out");
  el.innerHTML = `<p class="loading">${escapeHtml(t("loading"))}</p>`;
  try {
    const d = await api("/api/admin/cities");
    if (!d.cities || !d.cities.length) { el.innerHTML = `<div class="empty">${escapeHtml(t("empty_cities"))}</div>`; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>${escapeHtml(t("city_name"))}</th><th>${escapeHtml(t("city_km"))}</th><th>${escapeHtml(t("city_lat"))} / ${escapeHtml(t("city_lng"))}</th><th>${escapeHtml(t("status"))}</th><th></th></tr></thead><tbody>`
      + d.cities.map((c) => `<tr><td><b>${escapeHtml(c.name)}</b>${c.note ? `<br><span class="muted">${escapeHtml(c.note)}</span>` : ""}</td><td>${c.km_from_chunian != null ? Number(c.km_from_chunian) + " km" : t("unknown")}</td><td>${Number(c.lat)}, ${Number(c.lng)}</td><td>${Number(c.active) ? `<span class="badge green">${escapeHtml(t("active"))}</span>` : `<span class="badge grey">${escapeHtml(t("inactive"))}</span>`}</td><td>${Number(c.active) ? `<button type="button" class="danger small" data-city-action="deactivate" data-id="${Number(c.id)}">${escapeHtml(t("deactivate"))}</button>` : `<button type="button" class="primary small" data-city-action="activate" data-id="${Number(c.id)}">${escapeHtml(t("activate"))}</button>`}</td></tr>`).join("")
      + "</tbody></table></div>";
  } catch (e) {
    if (e && e.status === 401) { showLogin(t("err_session")); return; }
    el.innerHTML = `<p class="inline-error">${escapeHtml(e && e.status === 404 ? t("err_not_available") : ((e && e.message) || t("err_load")))}</p>`;
  }
}
async function addCity(btn) {
  const name = $("city-name").value.trim();
  const lat = Number($("city-lat").value);
  const lng = Number($("city-lng").value);
  const km = $("city-km").value === "" ? null : Number($("city-km").value);
  const note = $("city-note").value.trim();
  const err = $("city-error");
  err.textContent = "";
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) { err.textContent = t("err_city_fields"); return; }
  setBusy(btn, true, "…");
  try {
    await api("/api/admin/cities", { method: "POST", body: JSON.stringify({ name, lat, lng, km_from_chunian: km, note }) });
    toast(t("toast_city_added"), "ok");
    $("city-name").value = ""; $("city-lat").value = ""; $("city-lng").value = ""; $("city-km").value = ""; $("city-note").value = "";
    loadCities();
  } catch (e) { handleApiError(e, err); }
  finally { setBusy(btn, false); btn.textContent = t("city_add"); }
}
async function cityAction(id, action) {
  try {
    await api(`/api/admin/cities/${id}/${action}`, { method: "POST", body: "{}" });
    toast(action === "activate" ? t("toast_city_activated") : t("toast_city_deactivated"), "ok");
    loadCities();
  } catch (e) { handleApiError(e); }
}

// ---- Settings ----
async function loadSettings() {
  const err = $("settings-error");
  err.textContent = "";
  try {
    const s = (await api("/api/settings")).settings || {};
    $("set-bike").value = s.rate_bike_per_km ?? "";
    $("set-rickshaw").value = s.rate_rickshaw_per_km ?? "";
    $("set-car").value = s.rate_car_per_km ?? "";
    // AC Car: approved rate Rs 85/km, min Rs 200 — fall back to those until
    // the backend seeds rate_ac_car_per_km / min_ac_car.
    $("set-ac-car").value = s.rate_ac_car_per_km ?? AC_CAR_RATE_DEFAULT;
    $("set-min-bike").value = s.min_bike ?? "";
    $("set-min-rickshaw").value = s.min_rickshaw ?? "";
    $("set-min-car").value = s.min_car ?? "";
    $("set-min-ac-car").value = s.min_ac_car ?? AC_CAR_MIN_DEFAULT;
    $("set-commission").value = s.commission_pct ?? 12;
    $("set-fee").value = s.booking_fee ?? 20;
    $("set-jazzcash").value = s.jazzcash_number ?? "";
    $("set-sadapay").value = s.sadapay_number ?? "";
    $("set-support-phone").value = s.support_phone ?? "";
    $("set-support-whatsapp").value = s.support_whatsapp ?? "";
    $("set-min-topup").value = s.min_topup ?? 500;
  } catch (e) { handleApiError(e, err); }
}
async function saveSettings(btn) {
  const err = $("settings-error");
  err.textContent = "";
  $("settings-out").textContent = "";
  const body = {
    rate_bike_per_km: $("set-bike").value,
    rate_rickshaw_per_km: $("set-rickshaw").value,
    rate_car_per_km: $("set-car").value,
    rate_ac_car_per_km: $("set-ac-car").value,
    min_bike: $("set-min-bike").value,
    min_rickshaw: $("set-min-rickshaw").value,
    min_car: $("set-min-car").value,
    min_ac_car: $("set-min-ac-car").value,
    commission_pct: $("set-commission").value,
    booking_fee: $("set-fee").value,
    jazzcash_number: $("set-jazzcash").value,
    sadapay_number: $("set-sadapay").value,
    support_phone: $("set-support-phone").value,
    support_whatsapp: $("set-support-whatsapp").value,
    min_topup: $("set-min-topup").value,
  };
  setBusy(btn, true, "…");
  try {
    await api("/api/admin/settings", { method: "POST", body: JSON.stringify(body) });
    $("settings-out").textContent = t("toast_saved");
    toast(t("toast_saved"), "ok");
  } catch (e) { handleApiError(e, err); }
  finally { setBusy(btn, false); btn.textContent = t("settings_save"); }
}

// ---- Audit log ----
async function loadAudit() {
  const el = $("audit-out");
  el.innerHTML = `<p class="loading">${escapeHtml(t("loading"))}</p>`;
  try {
    const d = await api("/api/admin/audit-log");
    if (!d.audit_log.length) { el.innerHTML = `<div class="empty">${escapeHtml(t("empty_audit"))}</div>`; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>${escapeHtml(t("tx_date"))}</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>`
      + d.audit_log.map((a) => `<tr><td>${escapeHtml(fmtDate(a.created_at))}</td><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.target_type || "")}${a.target_id != null ? " #" + Number(a.target_id) : ""}</td><td>${escapeHtml(a.detail || "")}</td></tr>`).join("")
      + "</tbody></table></div>";
  } catch (e) { handleApiError(e); el.innerHTML = `<p class="inline-error">${escapeHtml((e && e.message) || t("err_load"))}</p>`; }
}

// ---- Security ----
async function changePassword(btn) {
  const current = $("admin-current-pw").value;
  const next = $("admin-new-pw").value;
  const err = $("pw-error");
  err.textContent = ""; $("pw-out").textContent = "";
  if (!current || !next) { err.textContent = t("err_pw_fields"); return; }
  setBusy(btn, true, "…");
  try {
    const d = await api("/api/admin/change-password", { method: "POST", body: JSON.stringify({ current, next }) });
    $("admin-current-pw").value = ""; $("admin-new-pw").value = "";
    $("pw-out").textContent = d.message || t("toast_pw_changed");
    toast(t("toast_pw_changed"), "ok");
  } catch (e) { handleApiError(e, err); }
  finally { setBusy(btn, false); btn.textContent = t("pw_change"); }
}
async function disableDemo(btn) {
  setBusy(btn, true, "…");
  try {
    const d = await api("/api/admin/demo/disable", { method: "POST", body: "{}" });
    $("demo-out").textContent = `${t("toast_demo_disabled")} (${Number(d.suspended || 0)})`;
    toast(t("toast_demo_disabled"), "ok");
  } catch (e) { handleApiError(e); }
  finally { setBusy(btn, false); btn.textContent = t("demo_disable"); }
}

// ---- Wiring (every button has a handler — no dead buttons) ----
document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => showSection(b.dataset.section)));
$("section-picker").addEventListener("change", (e) => showSection(e.target.value));
document.querySelectorAll("[data-refresh]").forEach((b) => b.addEventListener("click", () => loadSection(b.dataset.refresh)));
$("lang-toggle").addEventListener("click", toggleLang);
$("logout-btn").addEventListener("click", doLogout);
$("logout-btn-2").addEventListener("click", doLogout);
$("setup-btn").addEventListener("click", (e) => doSetup(e.currentTarget));
$("login-btn").addEventListener("click", (e) => doLogin(e.currentTarget));
$("login-password").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin($("login-btn")); });
$("setup-password").addEventListener("keydown", (e) => { if (e.key === "Enter") doSetup($("setup-btn")); });
$("calc-btn").addEventListener("click", loadProfit);
$("ledger-btn").addEventListener("click", (e) => loadLedger(e.currentTarget));
$("ledger-driver").addEventListener("keydown", (e) => { if (e.key === "Enter") loadLedger($("ledger-btn")); });
$("promo-create-btn").addEventListener("click", (e) => createPromo(e.currentTarget));
$("city-add-btn").addEventListener("click", (e) => addCity(e.currentTarget));
$("settings-save-btn").addEventListener("click", (e) => saveSettings(e.currentTarget));
$("pw-change-btn").addEventListener("click", (e) => changePassword(e.currentTarget));
$("demo-disable-btn").addEventListener("click", (e) => disableDemo(e.currentTarget));

// Delegated actions for rows rendered from API data.
document.addEventListener("click", (e) => {
  const drv = e.target.closest("[data-driver-action]");
  if (drv) { driverAction(Number(drv.dataset.id), drv.dataset.driverAction); return; }
  const usr = e.target.closest("[data-user-action]");
  if (usr) { userAction(Number(usr.dataset.id), usr.dataset.userAction); return; }
  const tp = e.target.closest("[data-topup-action]");
  if (tp) { topupAction(Number(tp.dataset.id), tp.dataset.topupAction); return; }
  const pr = e.target.closest("[data-promo-action]");
  if (pr) { deactivatePromo(Number(pr.dataset.id)); return; }
  const cp = e.target.closest("[data-complaint-action]");
  if (cp) { resolveComplaint(Number(cp.dataset.id)); return; }
  const ct = e.target.closest("[data-city-action]");
  if (ct) { cityAction(Number(ct.dataset.id), ct.dataset.cityAction); return; }
});

applyLang();
checkSetup();
