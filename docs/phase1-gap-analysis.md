# Chunian Ride — Phase 1 Gap Analysis

**Date:** 2026-11-08
**Decision (user, 2026-11-08):** UPGRADE THE LIVE APP. No fresh Firebase rebuild.
**Live app:** https://chunian-ride.onrender.com — Node/Express + SQLite, repo
`github.com/ranasajeel125-crypto/chunian-ride`, currently **v2.2** (commit `51017ba`).
**Spec under review:** user's full rebuild spec (Firebase Auth/Firestore, React, OTP login,
driver CNIC/licence verification, AC Car, separate admin website, promo codes, FCM,
phases 1–9) + STRICT zero-budget rule (PKR 0: no paid APIs/subscriptions, Spark free
only, OpenStreetMap, free GitHub/hosting/APK tools, no paid SMS OTP, manual JazzCash
only, never ask for card details).
**Status of this file:** living document for the repo. It is a read-only analysis —
nothing in the live codebase was modified to produce it. Live site re-verified
2026-11-08: `/api/health`
`{"ok":true,"app":"chunian-ride","version":"1.0.0","db":"local-sqlite"}`, homepage HTTP 200.

> **Corrections to the source analysis** (spot-checked against the code in
> `~/workspace/chunian-ride/` on 2026-11-08):
> 1. File sizes: `server/index.mjs` is 601 lines (the source said ~700) and
>    `server/db.mjs` is 258 lines (the source said ~230). No conclusion changes.
> 2. The source analysis stated the value of the current live admin PIN. That value
>    cannot be verified from the repo — the code reads `ADMIN_PIN` from the
>    environment (with a code default) and the live value is a Render env var.
>    Per the no-secrets rule for this document, no PIN value is published here;
>    the PIN is referred to only as "the temporary shared PIN" and it must not
>    survive Phase 1 (see §6.3).

## 1. Executive summary

The live app already implements most of the spec's *functional* surface — rider booking,
fare negotiation, counter-offers, scheduled rides, tips, in-ride chat, live GPS,
driver wallet + commission, SOS, ratings, owner admin, OpenStreetMap, and a working
Android APK. It is a real working product, not a prototype.

What it does **not** have is the spec's *trust* layer: there is no real authentication
(anyone can claim any phone number), the shared-PIN admin is not role-based, driver
wallet top-ups are credited instantly with no owner approval, and all live data resets
on every Render redeploy (local SQLite). Those four items — auth, top-up approval,
persistence, and admin hardening — are Phase 1. Everything else (AC Car, rider wallet,
withdrawals, promo codes, push notifications, PWA, multi-city model, call-driver) is
a real gap too, and is ordered in §4.

The Firebase stack in the spec cannot be delivered as written at PKR 0: phone-OTP
login and Cloud Functions both require the paid Blaze plan (billing account/card), and
Firebase Storage has required Blaze since 3 Feb 2026. The live Express backend already
provides the trusted server the spec's own §8 (security) demands — that is the main
reason the upgrade path is the right call.

## 2. Live app inventory (verified by reading the code)

| Piece | File(s) | What it is |
|---|---|---|
| Backend | `server/index.mjs` (601 lines), `server/db.mjs` (258 lines) | Express 4.21, Node ≥ 20, `@libsql/client`. JSON API + static frontend. No build step. |
| Database | `server/db.mjs`, `data/chunian-ride.db` | SQLite (local file by default; Turso-ready via `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`). 8 tables: `settings`, `users`, `drivers`, `rides`, `offers`, `wallet_tx`, `complaints`, `ride_messages`. |
| Frontend | `public/index.html` (329 lines), `public/app.js` (563 lines), `public/style.css` (553 lines) | Vanilla JS, no framework. Login-first welcome screen, Rider/Driver/Owner bottom tabs. Leaflet 1.9.4 + `tile.openstreetmap.org`. Inter font. Green theme (`#0b6e2f`). |
| Maps | `public/app.js` (`initMap`, `setPin`), `server/db.mjs` (`PLACES`, `distanceBetween`) | 8 saved places (Chunian City, Theeng Mor 12 km, Changa Manga 13 km, Pattoki 14 km, Kot Radha Kishan 30 km, Kasur 48 km, Lahore 89 km by road, Allahabad unverified). Verified road distances for Chunian-anchored pairs; other pairs = haversine × 1.3, labelled estimated. Tap-map pickup/destination. Navigation links to Google Maps + OSM (links only, no paid API). |
| Hosting | `render.yaml` | Render free web service, Blueprint deploy, health check `/api/health`. No keep-alive cron. |
| APK | `~/workspace/chunian-ride-apk/` (`build-apk.sh`, `MainActivity.java`, `ChunianRide-v1-debug.apk`) | WebView wrapper loading `https://chunian-ride.onrender.com`, built with direct Android SDK tools (aapt2/d8/zipalign/apksigner), **debug-signed**. User run-tested 2026-11-06, working. |
| Tests | `scripts/smoke-test.mjs` | Boots server on a scratch port + scratch DB, full end-to-end API pass (health, places, fares, signup, booking, offers, completion). |
| Branding | `public/logo.png`, `public/favicon.png`, `scripts/make-logo.py` | White car on green rounded square (v2 logo). Green brand. |

**Live behaviour verified 2026-11-08:** `/api/health` ok, `db: local-sqlite`
(Turso still NOT configured), homepage HTTP 200.

## 3. Coverage map — spec §2–8 vs the live app

### §2 — Two platforms, one backend
- ✅ Responsive website (mobile-first, bottom tabs) — **but no PWA**: no
  `manifest.json`, no service worker, not installable from the web. (Gap G8)
- ✅ Android app (WebView APK, same backend/database).
- ✅ One shared backend/database for both.

### §3 — Passenger
| Spec item | Live status |
|---|---|
| Phone registration + secure OTP login | ⚠️ Phone + name signup only. **No OTP, no password — anyone who types a phone number is "logged in" as that user.** (Gap G1 — critical) |
| Passenger profile | ⚠️ Name + phone in localStorage only; no profile screen, no edit. |
| Pickup / destination selection | ✅ 8 saved places + manual km entry. ❌ No free-text address, no geocoding. |
| Current GPS location | ❌ Rider has no "use my location" — GPS pickup is driver-side only. (Gap G7) |
| Google Maps integration | ✅ OSM/Leaflet (per zero-budget rule) + Google Maps *links* for navigation. No paid Google API — correct. |
| Vehicle selection Bike / Rickshaw / Car / AC Car | ⚠️ Bike / Rickshaw / Car only. **No AC Car.** (Gap G5) |
| Fare offer system | ✅ Rider proposes a fare; suggested fare shown first. |
| Receive multiple driver offers | ✅ Offers list (fare, name, vehicle, plate, rating, ETA). Note: offers are **auto-seeded** from all online approved drivers at the suggested fare when a ride is created (`server/index.mjs`, `POST /api/rides`) — drivers do not send the first offer themselves. |
| Accept / reject offers | ✅ Accept one (others auto-decline). Reject = decline via driver side; rider has no explicit per-offer reject button (accepting another offer declines the rest). |
| Driver profile, vehicle, ratings | ✅ Shown in offers and trip card. Ratings only from real completed rides. |
| Live driver tracking | ✅ Driver GPS via `watchPosition` (posts throttled to ≥10 s), rider map shows moving marker + distance/ETA, honest "location nahi mil rahi" state when stale (>3 min). |
| Ride status + notifications | ⚠️ Status yes (polling). **No push notifications** — rider must keep the page open. (Gap G6) |
| Call + chat with driver | ⚠️ Chat yes (text-only, per-ride, no phone numbers). **Call: no** — no driver call button. (Gap G7) |
| Ride cancellation | ✅ Cancel endpoint (blocked once completed). |
| Ride history + receipts | ✅ History list with fare, fee, tip, scheduled time. |
| Wallet + transaction history | ❌ **Rider has no wallet at all.** (Gap G4) |
| Support + complaints | ✅ Complaint form + SOS (Police 15 / Rescue 1122, logged + shown in admin). No refund flow. |

### §3 — Driver
| Spec item | Live status |
|---|---|
| Driver registration | ✅ Name/phone/vehicle/CNIC/licence/vehicle-reg; owner approves. |
| CNIC + licence submission | ⚠️ **Text fields only** — no photo upload, no document image verification. (Gap G10) |
| Vehicle registration + verification | ⚠️ Text reg number only; verified by owner approval, no photo. |
| Profile + vehicle management | ⚠️ Set at registration; **no edit screen** afterwards. |
| Online / offline availability | ✅ Toggle (approved drivers only). |
| Receive nearby ride requests | ✅ Filtered by vehicle type, with pickup/destination/distance/rider fare + rider rating shown before accepting. |
| View pickup + destination | ✅ Yes. |
| Send custom fare offers | ✅ Counter-offer + quick buttons +10% / +15% / +20% of rider's offer. |
| Accept passenger offers | ✅ Accept rider's offer (via own pending offer). |
| Navigation + live location updates | ✅ Google Maps / OSM direction links; GPS posting while online. |
| Start ride + complete ride | ✅ Start; complete gated on "cash received" confirmation. |
| Daily / monthly earnings | ⚠️ Today + 7 days only. No monthly view. |
| Wallet + commission history | ✅ Balance + ledger (last 50 tx). |
| Withdrawal requests | ❌ **None.** (Gap G4) |
| Ratings + reviews | ⚠️ Driver can give rider 5 stars (fixed 5★ button, no choice); rider rates driver 1–5 after completion. No written reviews. |

### §3 — Super Admin dashboard
| Spec item | Live status |
|---|---|
| Separate admin website | ❌ Admin is a tab inside the same site, protected by one shared PIN. No separate site, no admin accounts. (Gap G9) |
| Dashboard analytics | ⚠️ 7-day report (rides, gross, platform revenue, by vehicle/driver) + profit calculator (labelled estimates). No charts, no live-ride monitor. |
| Manage passengers + drivers | ⚠️ Drivers yes (approve/block). **Passengers: no rider list or management at all.** |
| Approve / reject driver documents | ⚠️ Approve/block driver (text documents only). No per-document review. |
| Suspend / reactivate accounts | ⚠️ Block works; "reactivate" = approve again (works, but no explicit flow). No rider suspension. |
| Manage all active + completed rides | ✅ Admin rides list (200 latest). |
| Monitor live rides | ⚠️ Live *drivers* list only (online + location). No live-rides map. |
| Manage cities + service areas | ❌ Places hardcoded in `server/db.mjs` (`PLACES`). (Gap G13) |
| Manage vehicle categories | ❌ Bike/Rickshaw/Car hardcoded in `server/index.mjs` (`VEHICLES`) and the HTML. (Gap G5) |
| Set commissions + fares | ✅ Rates, minimums, commission %, booking fee — take effect immediately. |
| Manage passenger + driver wallets | ⚠️ Driver ledger view only (by driver ID). No adjustments, no rider wallet. |
| Approve manual top-ups | ❌ **Top-up credits the wallet instantly** (`POST /api/drivers/:id/topup` adds the balance immediately; the UI text says "Owner TID verify karega" but the code does not wait). **This is the single most dangerous gap: a fake TID buys real wallet balance.** (Gap G2 — critical) |
| Review withdrawal requests | ❌ None exist. (Gap G4) |
| Handle complaints + refunds | ⚠️ Complaints list + resolve. **No refunds.** |
| Manage promotional codes | ❌ **None.** (Gap G4) |
| View transaction reports | ✅ 7-day report + per-driver ledger. |
| Configure support contact | ⚠️ JazzCash/Sadapay numbers are settings; no separate support-contact config. |
| Control platform settings | ✅ Settings endpoint (rates, commission, numbers). |

### §4 — Fare + commission
- ✅ Fully implemented server-side: rider proposes, drivers counter, rider picks.
  Commission **12% + Rs 20 booking fee**, deducted from the driver's prepaid wallet on
  completion (`platformTake` in `server/db.mjs`). Spec's example (10% / Rs 1,000 →
  driver keeps Rs 900) is configurable — admin can set 10% + Rs 0 to match it exactly.
- ⚠️ No promo-code discount path in the fare math yet (Gap G4).

### §5 — Wallet + top-up
- ✅ Driver wallet + ledger + JazzCash number (03266040350, admin-configurable) +
  Sadapay number setting (empty — owner never gave it).
- ❌ Top-up approval flow missing (Gap G2 — instant credit, see above).
- ❌ No screenshot submission (TID text only).
- ❌ No rider wallet, no withdrawal requests, no receipts beyond ride history.
- ✅ "Do not claim payments successful until verified" — currently VIOLATED by the
  instant-credit top-up; Phase 1 fixes this.

### §6 — Technical architecture
- ❌ Not Firebase/React — Express + SQLite + vanilla JS. (Deliberate under the
  upgrade decision; see §5 for why this is acceptable.)
- ✅ OpenStreetMap (Leaflet) — zero-budget compliant, no Google key.
- ✅ Env vars for secrets (`ADMIN_PIN`, `TURSO_*`); no credentials in frontend code.
- ❌ No Firestore security rules (not applicable — no Firestore). Access control is
  a shared admin PIN + no user auth. (Gap G1)
- ✅ Free hosting (Render free tier) + free GitHub repo + free APK build tools.

### §7 — Visual design
- ✅ Professional logo (white car on green), login-first splash/welcome screen,
  bottom nav, Inter typography, hero banner, responsive layout.
- ⚠️ **Theme is green (`#0b6e2f`), spec asks blue / white / dark navy.** The green
  brand is already live and recognised; switching is a user decision, not a
  technical requirement. (Gap G12 — decision needed, not a build blocker.)
- ❌ No PWA manifest/service worker (Gap G8). Icons are emoji-based, not a custom
  icon set.

### §8 — Security + reliability
| Spec item | Live status |
|---|---|
| Secure authentication | ❌ None (Gap G1). |
| Role-based permissions | ❌ Shared admin PIN only. |
| Protect personal data | ⚠️ Rider phone is shown to drivers in requests; driver CNIC/licence text is visible to anyone with the admin PIN. No per-user data scoping. |
| Verify driver documents | ⚠️ Owner eyeballs text fields; no photo, no verification status per document. |
| Prevent unauthorised wallet modification | ❌ Top-up endpoint has no auth and credits instantly (Gap G2). Anyone who knows a driver ID can credit that wallet. |
| Prevent duplicate ride completion / payment | ✅ `complete` requires status `ongoing`; tip is once-per-ride, rider-only, post-completion only. |
| Validate backend inputs | ⚠️ Basic checks (required fields, ranges, lat/lng bounds). No rate limiting, no request-size limits beyond JSON default. |
| Store ride status history | ❌ Status is a single field; no history/audit table. |
| Handle network failures | ⚠️ Client alerts on API errors; polling retries implicitly. No offline queue. |
| Database indexes | ⚠️ Only primary keys; no secondary indexes (fine at this scale, add with growth). |
| Error messages + loading indicators | ⚠️ Errors via `alert()`; no loading spinners. |

## 4. Prioritised gap list

### P0 — Money-safety + trust (Phase 1, must fix before real launch)
| # | Gap | Why it matters |
|---|---|---|
| G1 | **No authentication.** Phone-claim login; any user ID can be used by anyone; admin = one shared PIN. | Anyone can impersonate a rider/driver, read others' rides, or credit wallets. |
| G2 | **Top-up credits instantly, no owner approval.** `POST /api/drivers/:id/topup` adds balance immediately; TID is never verified first. | Fake TID = free wallet balance = free commission cover. Directly breaks "hamy nuksan ni ho chy" and spec §5. |
| G3 | **Data resets on redeploy.** Live DB is local SQLite on Render's ephemeral disk (verified live: `db: local-sqlite`). | Every redeploy/restart wipes users, drivers, rides, wallets. Not launchable as-is. |
| G9a | **Admin has no accounts/RBAC.** One shared PIN; no audit of who did what. | PIN leak = full control; no accountability. |

### P1 — Spec features missing (Phases 2–4)
| # | Gap |
|---|---|
| G4 | No rider wallet; no withdrawal requests; no refunds; no promo codes. |
| G5 | No AC Car category; vehicle categories hardcoded (no admin management). |
| G6 | No push notifications (no FCM). Rider/driver must keep the page open; scheduled rides have no reminders. |
| G7 | No rider GPS pickup; no driver call button (chat only); no free-text addresses/geocoding. |
| G8 | No PWA (no manifest, no service worker) — web app is not installable. |
| G9b | No separate admin website; no rider management; no live-rides monitor. |
| G10 | Driver documents are text-only (no photo upload / per-document verification). |
| G13 | Single-city hardcoded places; no cities/service-areas data model for expansion. |

### P2 — Polish + scale (Phases 5–9)
| # | Gap |
|---|---|
| G11 | Polling (5–8 s) instead of realtime; no ride-status history/audit log; no rate limiting; no secondary indexes. |
| G12 | Theme is green; spec asks blue/white/dark navy — user decision, not a blocker. |
| G14 | APK is debug-signed WebView wrapper. Play Store needs a release keystore + signed AAB + the $25 one-time Play Console fee (NOT zero-budget — sideload only until/unless he pays). |
| G15 | Offers are auto-seeded from all online drivers at ride creation — drivers never send the first offer themselves. (Works, but differs from the spec's driver-initiated offer flow; revisit if drivers complain.) |
| — | Driver can only give a fixed 5★ to a rider; no monthly earnings view; no written reviews; no loading spinners (alerts only). |

## 5. Zero-budget reality check (verified 2026-11-08)

These facts decide what Phase 1 can and cannot use. Sources: Firebase pricing +
Auth limits docs and independent pricing write-ups checked 2026-11-08.

| Service / claim | Reality on the free tier | Consequence for this project |
|---|---|---|
| Firebase **phone-OTP login** | **NOT available on Spark.** Since Sept 2024, phone sign-in requires the Blaze plan (linked billing account = card). First 10 SMS/day are free on Blaze only. | The spec's "OTP login" **cannot be delivered at PKR 0**. Do not promise it. |
| Firebase **Cloud Functions** | **NOT available on Spark.** The 2M free invocations/month belong to Blaze. | No server-side wallet/commission enforcement in a pure-Firebase build. The live Express backend already does this job — keep it. |
| Firebase **Cloud Storage** | **Requires Blaze since 3 Feb 2026.** Spark projects get 402/403 on storage. | No driver-document photo uploads inside Firebase on Spark. Use text fields + owner checks photos via WhatsApp, or a separate free store (Cloudinary free tier: 25 GB storage). |
| Firebase **Auth (email/password, Google)** | Free on Spark, 50,000 MAU. Email verification ~1,000/day, password reset ~150/day. | Usable — but needs users to have an email address, which many local riders/drivers may not. |
| Firebase **FCM push** | Free on both plans. | Usable for notifications (Phase 4). Needs a service worker + Web Push setup. |
| Firebase **Firestore** | Spark: 1 GiB stored, 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day, 10 GiB egress/month. Over quota = product stops for the rest of the month. | Adequate for launch scale, but live GPS + chat are write-heavy — must throttle. Not needed if the Express backend stays. |
| Firebase **Hosting** | Spark: 10 GB stored, 360 MB/day transfer. | Free and fine for web + admin sites. |
| **Turso** (persistence fix) | Free tier is generous for this scale (verify current limits in the Turso dashboard at creation). Same libSQL client the app already uses — zero code change beyond env vars. | The right persistence fix for the live app. |
| **Render** free tier | 750 instance-hours/month shared across the user's services (already tight: Zoomly keep-alive ~720 h). This service has no keep-alive and sleeps when idle. | Keep as-is; do not add a keep-alive without the user's decision on the free-hours pool. |
| **OpenStreetMap** | `tile.openstreetmap.org` free with attribution for reasonable use; Nominatim geocoding 1 req/sec; OSRM demo routing free for light use. | Already used correctly. For geocoding, cache results; do not hammer Nominatim. |
| **GitHub** free | Repo + Actions 2,000 min/month. | Free APK builds via Actions, or keep the existing direct-SDK build script (already works). |
| **Play Store** | $25 one-time Console fee + release keystore + signed AAB. | NOT zero-budget. Sideload the APK until/unless he pays. |
| **SMS OTP (any provider)** | All paid per SMS. | No free SMS OTP exists. Any "OTP login" at PKR 0 is impossible — say so plainly. |

### Auth foundation — free login method (Phase 1 decision)
Phone is the natural identifier for Chunian riders/drivers, but SMS OTP costs money.
The free, honest options, ranked:

1. **Phone + password (RECOMMENDED for Phase 1).** Signup with phone + a password
   (bcrypt-hashed server-side, `bcryptjs` — free, no new service). Login returns a
   signed session (HTTP-only cookie or JWT). No SMS, no email, no card, works with
   the existing stack. Phone stays the username; password is the secret. Driver
   phones get additionally verified by the owner at document approval (the launch
   pool is small and vetted — owner already meets/approves every driver).
2. **Firebase Auth email/password (+ Google sign-in).** Genuinely free on Spark and
   gives verified emails + password reset. But it forces every rider/driver to have
   an email address, adds a second identity system to maintain, and does not verify
   the phone number at all. Keep as an optional later addition, not Phase 1.
3. **Email-link / email-OTP.** Quota-limited on Spark (email-link sign-in ~5/day in
   published limits) and needs an email address — not viable as the main login.
4. **Owner-verified phone binding (operational, not technical).** For launch, the
   owner confirms each driver's phone in person/WhatsApp before approving documents.
   This is a process control, not a login method — use it alongside option 1.

**Phase 1 adopts option 1.** It is the only method that is free, works for
phone-only users, and needs no new account, card, or service.

## 6. Phase 1 plan — upgrade the live app (architecture, database, auth)

**Goal:** make the live app safe to launch with real users and real money, without
changing what already works. Phase 1 touches the backend, the database, and the login
flow only. No UI redesign, no new vehicle categories, no promo codes — those come later.

### 6.1 Deliverables
1. **Turso persistence (G3).** Live data survives redeploys.
2. **Real authentication (G1).** Phone + password, bcrypt, sessions, per-user
   authorisation on every endpoint.
3. **Top-up approval flow (G2).** Top-ups stay `pending` until the owner approves;
   only then is the wallet credited.
4. **Admin hardening (G9a).** Owner account with a password (replaces the shared
   PIN for all admin actions); PIN kept only as a one-time bootstrap.
5. **Security baseline.** Rate limiting, input validation, no wallet endpoint without
   auth, audit log for admin actions + wallet changes.
6. **Tests.** Smoke test extended to cover login, top-up approve/reject, and the
   auth guards (unauthenticated wallet/rides calls must fail).

### 6.2 Architecture (unchanged stack, hardened)
- **Keep:** Node 20 + Express 4 + `@libsql/client` + vanilla JS + Leaflet/OSM +
  Render free web service + the existing WebView APK (repointed build only if the
  URL changes — it does not).
- **Add (all free, no new service):** `bcryptjs` (password hashing),
  `express-rate-limit` (login + top-up abuse protection), `jsonwebtoken` or
  `cookie-session` (sessions — pick `jsonwebtoken` with HTTP-only cookies),
  `helmet`-lite headers (or a few manual headers; avoid new deps where a few
  lines suffice).
- **Do NOT add in Phase 1:** Firebase, React, FCM, PWA service worker, Cloudinary.
  Each is a later phase (see §7) or an optional extra.
- **Hosting note:** the service stays on Render free tier with no keep-alive
  (free-hours pool decision is still the user's — see §8).

### 6.3 Database design (migrations on the existing SQLite/Turso schema)
All migrations are additive (`ALTER TABLE` / `CREATE TABLE IF NOT EXISTS`) so the
live database (including demo data) survives the upgrade. New/changed tables:

```sql
-- Auth: password hash on users; role stays rider/driver; admin is a user row.
ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'phone'; -- 'phone'
ALTER TABLE users ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0;   -- 1 after owner confirms
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';       -- active | suspended
ALTER TABLE users ADD COLUMN updated_at INTEGER;

-- Sessions (server-side, revocable) — or JWT without a table; sessions table is
-- simpler to revoke and audit. One row per login; expiry 30 days.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  last_seen_at INTEGER, user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Top-up requests: pending until owner approves. Wallet is credited ONLY here.
CREATE TABLE IF NOT EXISTS topup_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL, method TEXT NOT NULL DEFAULT 'JazzCash',
  tid TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',            -- pending | approved | rejected
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topup_driver ON topup_requests(driver_id);
CREATE INDEX IF NOT EXISTS idx_topup_status ON topup_requests(status);

-- Ride status history (audit trail for every ride).
CREATE TABLE IF NOT EXISTS ride_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id INTEGER NOT NULL REFERENCES rides(id),
  from_status TEXT, to_status TEXT NOT NULL,
  actor_id INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ride_history ON ride_status_history(ride_id);

-- Audit log: admin actions + all wallet balance changes.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER, action TEXT NOT NULL, target_type TEXT, target_id INTEGER,
  detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
```

**Also in Phase 1 (small, same migration run):**
- `drivers`: add `documents_status TEXT DEFAULT 'pending'` (per-driver doc review
  state; photo upload itself is Phase 4 — text fields stay for now).
- `settings`: add `support_phone` (configurable support contact, separate from the
  JazzCash number) and `support_whatsapp` (optional).
- **Seed/admin bootstrap:** create the owner admin user on first boot from env
  (`OWNER_PHONE`, `OWNER_PASSWORD_HASH` set in Render, never committed); the old
  shared PIN is accepted only until the first owner login, then disabled.
  Owner must choose a new password — the current temporary shared PIN must not
  survive Phase 1.

### 6.4 Auth foundation (how it works)
- **Signup:** `POST /api/signup` now requires `{name, phone, password, role}`.
  Phone is normalised (strip spaces/dashes, keep as typed). Password ≥ 6 chars,
  bcrypt-hashed (`bcryptjs`, cost 10). Duplicate phone → 409 (no silent
  "existing user" login — the old behaviour that let anyone claim a phone is removed).
- **Login:** `POST /api/login` `{phone, password}` → verifies hash → creates a
  `sessions` row → sets an HTTP-only, SameSite cookie (30-day expiry, sliding).
  Wrong password → 401, rate-limited (5 attempts / 15 min / IP+phone).
- **Authorisation middleware** on every endpoint: rider endpoints require a session
  whose `user_id` matches the `rider_id`/`driver_id` in the request (no more
  "anyone can pass any ID"); driver endpoints require the driver's own session +
  approved status; admin endpoints require the owner role. `GET /api/rides/:id`
  and chat endpoints check the caller is the ride's rider, driver, or owner.
- **Owner:** a `users` row with `role='owner'`; admin endpoints check the session
  role, not a header PIN. The old `X-Admin-Pin` header is removed in Phase 1
  (after the owner account is created).
- **Logout:** `POST /api/logout` deletes the session row + clears the cookie.
- **Frontend:** `public/app.js` stores only the session cookie (no user object in
  localStorage any more); login screens gain a password field; the welcome screen
  offers "Login" vs "Signup". No other UI changes in Phase 1.
- **Migration for existing accounts:** demo users + any real users created before
  Phase 1 have no password — on first login they are asked to set one (one-time
  "set password" flow gated by phone + owner confirmation for drivers; riders set
  it themselves). Demo accounts are clearly labelled and excluded from production
  reports.

### 6.5 Top-up approval flow (G2 fix — exact behaviour)
1. Driver submits top-up: `POST /api/drivers/:id/topup` `{amount, method, tid}` →
   creates a `topup_requests` row with `status='pending'`. **Wallet balance does
   NOT change.** Response: "Request sent — owner will verify the TID."
2. Owner reviews in Admin → Wallet: list of pending requests (driver, amount,
   method, TID, time). Owner checks the JazzCash payment against the TID (in his
   own JazzCash app), then Approve or Reject.
3. Approve (`POST /api/admin/topups/:id/approve`, owner session only): in ONE
   database transaction — set request `approved`, insert `wallet_tx` (+amount),
   increment `drivers.wallet_balance`. Reject: set `rejected` with a reason; no
   balance change. Both actions write an `audit_log` row.
4. Driver sees the request status in the wallet screen (pending / approved /
   rejected + reason).
5. **No screenshot in Phase 1** (no free storage on the stack) — TID + amount +
   owner checking his own JazzCash app is the verification. Screenshot upload is a
   Phase 4 option via Cloudinary free tier.

### 6.6 Turso persistence fix (G3 — exact steps)
The code already supports Turso (same `@libsql/client`, `TURSO_DATABASE_URL` +
`TURSO_AUTH_TOKEN` env vars). Only the database does not exist yet because Turso
CLI login needs an interactive browser OAuth flow the agent cannot do.
1. **User step (phone/browser, ~5 min):** install Turso CLI, run `turso auth login`
   (browser OAuth), then `turso db create chunian-ride` and
   `turso db tokens create chunian-ride`.
2. **Agent step:** set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` in the Render
   dashboard (service `srv-dbn2nljl550s73fa64ig`), redeploy, verify `/api/health`
   reports `db: "turso"`.
3. **Data migration:** export the current local SQLite rows (users/drivers/rides/
   wallet_tx) and import into Turso before switching, or accept a fresh start and
   re-seed demo data (owner decides — demo data only so far, so a fresh start is
   acceptable; real users must be migrated if any exist by then).
4. **Fallback:** if Turso is not created, the app keeps working on local SQLite —
   but every redeploy still wipes data. Phase 1 is not "done" until health shows
   `turso`.

### 6.7 Files to create / change in Phase 1
| File | Change |
|---|---|
| `server/index.mjs` | Auth middleware + `/api/login`, `/api/logout`, `/api/set-password`; password on `/api/signup`; authorisation checks on all ride/driver/wallet/chat endpoints; top-up rewrite (pending → approve/reject); owner-only admin endpoints (drop `X-Admin-Pin`); rate limiting on login/top-up; ride-status history writes; audit-log writes. |
| `server/db.mjs` | New tables + indexes (§6.3); `password_hash` handling; owner bootstrap seed. |
| `server/auth.mjs` **(new)** | Password hashing/verify, session create/validate/revoke, role checks. Keeps auth logic out of the route file. |
| `public/app.js` | Login screens gain password fields; session-cookie auth (drop localStorage user objects); top-up form shows request status; admin wallet screen shows pending top-ups with Approve/Reject. |
| `public/index.html` | Password inputs on rider/driver login; admin top-up review card; owner login (replaces PIN input). |
| `scripts/smoke-test.mjs` | Extend: signup→login→auth-guard failures (no session = 401), top-up pending → approve → balance changes only on approve, reject → no change, wrong-password lockout, owner bootstrap. |
| `render.yaml` | Add `OWNER_PHONE`, `OWNER_PASSWORD_HASH` (sync: false, secrets). Remove reliance on `ADMIN_PIN` after bootstrap. |
| `README.md` | Document the new auth + top-up flow, Turso steps, and that the old PIN login is gone. |

### 6.8 Phase 1 acceptance checklist (all must pass before calling it done)
- [ ] `/api/health` reports `db: "turso"` on the live site.
- [ ] Signup without password fails; login with wrong password fails; logged-out
      calls to `/api/rides`, `/api/drivers/:id/wallet`, `/api/drivers/:id/topup`
      return 401.
- [ ] A rider cannot read or act on another rider's ride (403).
- [ ] Top-up creates a `pending` request and changes **no** balance; owner approve
      credits exactly once; owner reject credits nothing; approving twice is impossible.
- [ ] Owner login works with the new password; the old shared PIN no longer works.
- [ ] Smoke test passes end-to-end on a scratch DB (extended suite).
- [ ] Live verified: one real top-up request → approve → balance correct, then the
      test data is removed.

## 7. Phased upgrade order after Phase 1

Phase 1 is the trust layer. The gaps below are ordered so each phase is shippable on
its own and builds on the previous one. (The spec's phases 1–9 are adapted to the
live stack — the spec's Firebase phases are not followed literally.)

| Phase | What ships | Gaps closed | Notes |
|---|---|---|---|
| **1 — Trust** | Turso persistence; phone+password auth; top-up approval; owner account; audit log; rate limiting. | G1, G2, G3, G9a | §6 above. Do this first — nothing else is safe to launch without it. |
| **2 — Money** | Rider wallet (balance + top-up + ledger); withdrawal requests (driver requests → owner approves → owner pays manually outside app, like Zoomly's existing pattern); refunds (owner-initiated, wallet credit); fare math with promo-code support. | G4 (wallet/withdraw/refund) | Withdrawal stays manual-payout (no payment gateway at PKR 0). |
| **3 — Promo + vehicles** | Promo-code table + admin CRUD (code, % or flat discount, expiry, max uses, per-user limit); AC Car category (fare Rs 100/km suggested, min Rs 250 — owner confirms); vehicle categories moved from hardcoded constants to an admin-manageable table; per-vehicle fare editing in admin. | G4 (promo), G5 | AC Car fare is the owner's call — set it in admin before enabling the category. |
| **4 — Notifications + documents** | FCM push (free): Web Push via service worker for rider + driver (offer received, accepted, driver arrived, ride completed, top-up approved/rejected); scheduled-ride reminders. Driver document photo upload via Cloudinary free tier (25 GB) + per-document verification status in admin (CNIC front/back, licence, vehicle reg — approve/reject each). | G6, G10 | FCM needs a service worker — pair it with the PWA manifest (G8) in this phase. |
| **5 — Rider experience** | Rider GPS pickup ("use my location"); free-text destination with Nominatim geocoding (cached, 1 req/sec limit respected); driver call button (tel: link — no paid calling API); monthly earnings view; rider rating choice (1–5, not fixed 5★). | G7 | Geocoding cache is mandatory — uncached Nominatim calls will get the app blocked. |
| **6 — Admin website** | Separate admin app (second Render static/web service on the same repo, same database): dashboard charts, live-rides monitor, rider management + suspension, per-driver document review, cities/service-areas management, transaction reports, support-contact config. | G9b, G13 | Keep the existing admin tab as a fallback until the admin site is verified. Same owner auth. |
| **7 — Multi-city + polish** | Cities table (name, centre, service radius, per-city rates); service-area polygons (simple centre+radius first); theme decision (stay green vs spec's blue/navy — user's call); custom icon set; loading spinners replacing `alert()` errors; ride-status history visible in the UI. | G13, G12, G11 | Only after the Chunian launch is proven — do not expand cities before the home market works. |
| **8 — Realtime + scale** | Replace polling with a lightweight realtime channel (Server-Sent Events on the existing Express server — free, no new service); secondary indexes; request-size limits; offline queue for driver GPS posts. | G11 | SSE is the zero-budget realtime answer; WebSockets would need a different hosting story. |
| **9 — Play Store** | Release keystore (create once, back up forever), signed AAB, store listing assets, real-device screenshots. | G14 | Blocked on the user's $25 Play Console fee (not zero-budget) + his phone steps. Until then: sideload the debug APK. |

**Deliberately NOT in any phase:** paid SMS OTP (impossible at PKR 0); Google Maps
paid APIs (OSM is the rule); paid moderation AI; any paid service activation.

## 8. What is still needed from the user

| # | Needed | Why / how |
|---|---|---|
| 1 | **Turso account + database** (phone/browser, ~5 min): `turso auth login` → `turso db create chunian-ride` → token. | Persistence fix (§6.6). Agent cannot do the interactive OAuth login. |
| 2 | **New owner password** (he names it; agent sets it in Render env). | Replaces the temporary shared PIN. He has not picked one yet. |
| 3 | **Sadapay number** (still never given). | Admin setting is empty; never invent one. Needed before top-up shows Sadapay as an option. |
| 4 | **AC Car fare decision** (Rs/km + minimum) before Phase 3 enables the category. | Owner's pricing call. |
| 5 | **Theme decision** — stay green (current brand) or switch to the spec's blue/white/dark navy. | Cosmetic; do not rebuild the CSS until he picks. |
| 6 | **Render free-hours decision** (monitor only / paid Zoomly Starter ~$7/mo / stop a keep-alive). | Three services now share the 750 h/month pool; Chunian Ride has no keep-alive and sleeps when idle. Undecided since 2026-11-02. |
| 7 | **Kasur RTA written guidance** on TNC licence / route permits (Punjab Motor Vehicles (Amendment) Act 2025, s.44B). | Needed before any real (paid) launch — unverified as of 2026-11-06. |
| 8 | **Play Console account + $25 fee** (his phone step, Phase 9 only). | Blocks Play Store; sideload works meanwhile. |
| 9 | **His phone test of v2.2** (eyeball test + a real test ride + live GPS field test with real movement). | Still outstanding; no phase should start until the live v2.2 is confirmed working on his phone. |

## 9. Risks and honest limits

- **Live data is currently ephemeral.** Until Turso is configured, any redeploy
  wipes users/drivers/rides/wallets. Do not onboard real drivers before §6.6 is done.
- **The top-up hole is live right now.** Anyone who knows a driver ID can credit
  that wallet today. Do not announce the top-up feature publicly until Phase 1
  lands.
- **No real-device test of GPS.** Live location tracking is code-complete and
  smoke-tested, but never field-tested with real movement. A real test ride is
  required before launch claims.
- **Polling cost.** Driver GPS posts every ≥10 s and clients poll every 5–8 s.
  At 100 concurrent users this is ~1,000 requests/min — fine for the free tier,
  but Turso's free read/write quotas must be watched; Phase 8 (SSE) reduces it.
- **Firebase facts may change.** The Spark limits in §5 were verified on
  2026-11-08 (phone auth needs Blaze since Sept 2024; Cloud Functions not on
  Spark; Cloud Storage requires Blaze since 3 Feb 2026). Re-check Firebase's
  pricing page before any future Firebase decision.
- **Play Store is not free.** The $25 fee and the release keystore are the only
  hard costs in the whole plan; everything else is PKR 0.
- **Legal.** The Punjab TNC/route-permit position is unverified — get the Kasur
  RTA answer in writing before charging real fares.

## 10. Sources and verification notes

- **Code read (read-only, 2026-11-08):** `~/workspace/chunian-ride/server/index.mjs`
  (601 lines), `server/db.mjs` (258 lines), `public/app.js` (563 lines),
  `public/index.html` (329 lines), `public/style.css` (553 lines),
  `package.json`, `render.yaml`, `README.md`, `scripts/smoke-test.mjs`,
  `scripts/make-logo.py`. No file in `~/workspace/chunian-ride/` was modified
  except the creation of this document.
- **Live check 2026-11-08:** `GET /api/health` → `ok:true`, `db: local-sqlite`;
  homepage HTTP 200.
- **Firebase facts (web search, 2026-11-08):** Firebase Pricing page — phone
  auth requires Blaze ("Phone Authentication requires the Blaze plan"); Firebase
  Auth limits — email verification ~1,000/day, password reset ~150/day, free tier
  50,000 MAU; Firestore Spark quotas — 1 GiB stored, 50k reads/day, 20k writes/
  deletes per day, 10 GiB egress/month; Firebase Hosting Spark — 10 GB stored,
  360 MB/day transfer; Cloud Functions — 2M free invocations/month is a Blaze
  benefit, not available on Spark; Cloud Storage for Firebase — requires Blaze
  since 3 Feb 2026.
- **Decision record:** user chose the upgrade path on 2026-11-08 (recorded in
  `~/MEMORY.md`). The earlier draft direction (fresh Firebase rebuild) is
  superseded; this file is the upgrade-path version.

## 11. Addendum — Phase 1 implementation ordered (2026-11-08 ~23:08 PKT)

The user has ordered Phase 1 implementation on the live app. The ordered scope
matches this plan exactly: Turso persistence fix, full schema (passengers / drivers /
vehicles / rides / offers / wallets / transactions / cities / promo codes / admins),
free auth without paid SMS OTP, passenger/driver roles, secure admin auth + RBAC,
admin dashboard foundation, migrations + backup instructions, and a persistence test
(create records → redeploy → verify). The live app must keep working throughout the
work; a coordinator subagent is running the implementation.

### 11.1 Backup instructions (part of Phase 1)
- **Before any migration:** copy `data/chunian-ride.db` (local) or export the Turso
  database (`turso db shell chunian-ride .dump > backup-YYYYMMDD.sql`) and keep the
  file in `~/workspace/chunian-ride-v2/backups/`. Never migrate without a backup.
- **After Turso is live:** take a Turso export before every schema migration, and
  keep a weekly export while the service is on the free tier (no automated backups
  exist on Render free + local SQLite).
- **Rollback:** if a migration fails, restore the backup file and redeploy the
  previous commit — do not hand-edit the live database.

### 11.2 Persistence test (explicit acceptance step)
1. Create one test rider, one test driver, one completed ride and one approved
   top-up on the live site.
2. Trigger a Render redeploy.
3. Verify all four records still exist with identical values, and `/api/health`
   still reports `db: "turso"`.
4. Delete the test records afterwards. Phase 1 is not "done" until this passes.

### 11.3 What follows Phase 1
Per the user's order, **Phase 2 is the Passenger App** — the rider-side build
(rider wallet, GPS pickup, call-driver, history/receipts polish, PWA installability),
i.e. the rider-facing items of §7's Phases 2 + 5 + the PWA part of Phase 4, in that
order. It starts only after Phase 1 is genuinely implemented and tested (checklist
§6.8 + persistence test §11.2 all green). The remaining §7 phases (promo + AC Car,
notifications + documents, admin website, multi-city, realtime, Play Store) follow
after Phase 2.

## 12. Phase 1 implementation status

**Phase 1 IMPLEMENTED + TESTED LOCALLY — 2026-11-08** (coordinator run).
Deployed to the live site in the same commit; see the repo commit message for
the version. What landed:

- **Auth (G1 fixed):** phone + password login (bcrypt), server-side sessions
  (HTTP-only cookie, 30 days), per-user authorisation on every endpoint,
  login rate limiting (5 failed attempts / 15 min → 429). No SMS OTP — none
  exists for free (all providers charge per SMS; Firebase phone auth needs the
  paid Blaze plan). Demo accounts are claimed by setting a password on first
  login; real accounts can never be claimed.
- **Top-up approval (G2 fixed):** top-ups create a `pending` request and
  change NO balance. The owner verifies the TID in his own JazzCash app and
  approves (credits exactly once, inside one transaction) or rejects (credits
  nothing). Double-approve is impossible. Minimum top-up Rs 500.
- **Admin hardening (G9a fixed):** password-protected admin accounts
  (`admins` table). The old shared PIN works ONLY as a one-time bootstrap key
  to create the first owner account (`POST /api/admin/setup`); after that the
  PIN is dead and only phone + password logins work. In-app admin password
  change included. Admin foundation: users list + suspend/reactivate, top-up
  review, promo-code create/list, audit log.
- **Database (schema):** new tables `sessions`, `admins`, `topup_requests`,
  `ride_status_history`, `audit_log`, `vehicles`, `cities`, `wallets`,
  `transactions` (unified ledger), `promo_codes`, `passengers`; auth columns
  on `users`; `documents_status` on `drivers`; `support_phone` /
  `support_whatsapp` settings. All migrations additive and idempotent
  (`initDb()` re-runs safely). `wallets` is the single source of truth for
  balances; `drivers.wallet_balance` is a mirror. Backup instructions:
  `docs/backup.md`.
- **Tests:** `npm run smoke` — 94 checks, ALL PASSED (auth guards, RBAC 403s,
  top-up approve/reject/double-approve, no double ride completion, restart
  persistence on the local file DB, session survival across restart).
  `node scripts/remote-db-test.mjs` — 12 checks against a local `sqld`
  (remote libSQL, same protocol as Turso), ALL PASSED, including restart
  persistence on the remote DB.

**Still open (G3 — Turso cloud database):** the app is fully Turso-ready
(same `@libsql/client`, `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` env vars)
and the remote-libSQL code path is verified, but **no Turso database exists
yet** — the Turso CLI on this machine is not logged in and login needs an
interactive browser OAuth flow. Until the user creates it, the live site runs
on local SQLite and **data still resets on every Render redeploy**.
Exact user step (phone/browser, ~5 min): install the Turso CLI, run
`turso auth login`, then `turso db create chunian-ride` and
`turso db tokens create chunian-ride`, then set `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN` in the Render dashboard for service `chunian-ride` and
redeploy. After that, verify `/api/health` reports `db: "turso"` and run the
persistence test (§11.2) — create records, redeploy, verify they survive.
Phase 1 is not fully "done" until that test passes on Turso.

Do not onboard real drivers or announce the top-up feature publicly until the
Turso step is done and the §11.2 persistence test passes.

Note: the live admin PIN is temporary and must be replaced by the owner password
in Phase 1. Its value is deliberately not recorded in this document or in any
user-facing text.
