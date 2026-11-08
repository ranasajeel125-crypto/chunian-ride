# Chunian Ride — Complete Professional Redesign Plan (v3, 2026-11-08)

## 0. Basis (verified by reading the code, 2026-11-08)

- Stack: Node/Express + `@libsql/client`, no build step, single `public/index.html` +
  `public/app.js` + `public/style.css`, Leaflet/OpenStreetMap (free), bcrypt
  phone+password auth, server sessions, RBAC, top-up approval flow.
- Phase 1 (commit `904f23c`) is live: auth, RBAC, admin accounts, 11 new tables,
  audit log, transactional completion, 94 smoke checks passing.
- **Honest state: live still runs on LOCAL SQLite** (`/api/health` → `db:
  "local-sqlite"`, `setup_needed: true`). No Turso cloud DB exists yet — the
  user has not finished his Turso dashboard steps. This redesign keeps the
  Turso-ready code path intact and must NEVER claim Turso is connected.
- The APK is a WebView wrapper loading the live URL — server-driven UI changes
  need NO APK rebuild.
- Current UI problems (user-confirmed): long crowded single page, all three
  roles stacked on one page, green theme, demo driver phones printed on the
  login card, no AC Car, no Urdu/English toggle, admin is a stack of cards
  with no dashboard structure.

## 1. Goals & hard constraints

1. Upgrade the EXISTING app in place — same repo, same backend, same database,
   same auth. No separate project, no rebuild.
2. Every control wired to a REAL API endpoint. No fake/demo buttons, no static
   mock screens, no invented data in production paths.
3. Keep everything free: Render free tier, OpenStreetMap, no paid maps, no SMS.
4. Preserve Phase 1 security: auth, RBAC, top-up approval (pending until the
   owner verifies the TID), audit log, transactional money movement.
5. Preserve all working features: fare negotiation + counter-offer quick
   buttons, scheduled rides, tips (100% driver), in-ride chat, live GPS
   tracking, SOS, ratings from real rides only, driver wallet, earnings.
6. Migrations stay additive; never delete production data.
7. Remove ALL publicly visible demo credentials (demo driver names/phones on
   the login card). Owner setup stays backend-protected (PIN is a one-time
   bootstrap key; setup form shows only while `setup_needed` is true).

## 2. Architecture (unchanged, plus small additive backend work)

- `server/index.mjs` — routes. `server/db.mjs` — schema + settings.
  `server/auth.mjs` — sessions/RBAC (untouched unless a bug is found).
- New additive backend endpoints (contracts — frontend/admin agents build
  against these exact shapes):
  - `GET /api/wallet/me` (requireAuth, user only) →
    `{ balance, transactions: [...] }` (last 50, newest first).
  - `GET /api/admin/overview` (requireAdmin) → `{ totals: { users, riders,
    drivers, drivers_online, rides_today, rides_total, completed_today },
    pending_topups, open_complaints, pending_drivers, platform_revenue_7d,
    platform_revenue_today }`.
  - `GET /api/admin/cities` (requireAdmin) → `{ cities: [...] }`.
  - `POST /api/admin/cities` (requireAdmin) `{ name, lat, lng,
    km_from_chunian, note }` → `{ city }` (409 on duplicate name).
  - `POST /api/admin/cities/:id/deactivate` and `.../activate`
    (requireAdmin) → `{ active: 0|1 }`.
  - `GET /admin` → serves `public/admin.html` (separate admin website).
- AC Car: `"ac_car"` added to the `VEHICLES` list; settings
  `rate_ac_car_per_km = 85`, `min_ac_car = 200` (INSERT OR IGNORE seeds them
  on existing DBs too); admin settings allowlist gains both keys; one AC Car
  demo driver seeded on FRESH databases only (existing data untouched).

## 3. Navigation (replaces the crowded single page)

- **Welcome screen (unchanged concept, new theme):** big Rider Login and
  Driver Login options; Owner/Admin is a small link → `/admin`.
- **Rider bottom tab bar (mobile) / top pills (desktop):** Home · Rides ·
  Wallet · Profile.
- **Driver bottom tab bar:** Home · Requests · Wallet · Profile.
- **Admin:** separate page `/admin`, left sidebar on desktop, top bar +
  section picker on mobile. Sections: Overview · Rides · Drivers · Users ·
  Top-ups · Wallets · Promo Codes · Complaints · Cities · Settings ·
  Audit Log · Security.
- One screen visible at a time; tab switches re-render only that screen's
  data. No more 3000px scroll of stacked cards.

## 4. Passenger home (screen-by-screen)

- **Home:** large interactive map (55vh mobile, 420px desktop) with place
  pins; "Use my location" GPS button (haversine distance to destination,
  passed as `distance_km`); "Where to go?" card with Pickup + Destination
  selects (from `/api/places`) and map-tap to set; vehicle cards Bike /
  Rickshaw / Car / AC Car with live per-km rates from settings; fare
  estimate box; "Offer your fare" input; scheduled ride date+time (≤7 days);
  "Find a driver" → creates the ride, shows driver offers; recent
  destinations chips (deduped from the rider's own ride history).
- **Active trip (same screen, replaces booking card):** status badge, driver
  name/vehicle/plate/rating/ETA, live driver marker + distance/ETA with the
  honest "location nahi mil rahi" state, chat, Share trip, SOS, Cancel,
  rate + tip after completion.
- **Rides:** ride history + receipts (fare, tip, status, scheduled time).
- **Wallet:** balance + transaction list from `GET /api/wallet/me`.
  (Rider top-up is NOT in this redesign — riders pay cash; driver top-up
  stays in the driver app.)
- **Profile:** name/phone/ID, rating, language toggle, change password,
  logout, support numbers (Police 15, Rescue 1122, owner support number
  from settings when set).

## 5. Driver app (screen-by-screen)

- **Home (dashboard):** status card — documents status
  (`drivers.documents_status`: pending/approved), vehicle, rating, wallet
  balance; big Online/Offline switch (GPS sharing starts only while online);
  today + 7-day earnings summary; active ride card (Start trip, End trip
  with cash-confirm checkbox, rider chat).
- **Requests:** open requests for the driver's vehicle type with rider
  offer, suggested fare, rider rating, scheduled badge; Accept (rider's
  offer) / counter-offer input + quick buttons +10%/+15%/+20% / Decline
  (no penalty); Google Maps + OSM navigation links.
- **Wallet:** balance, transactions, top-up request form (JazzCash
  03266040350 + TID; pending until owner approves — text says so), top-up
  request history with statuses.
- **Profile:** driver + vehicle details, document verification status,
  registration form for new drivers (CNIC/licence/vehicle reg — owner
  approves), change password, logout.

## 6. Admin dashboard (`/admin`, separate page)

- **Overview:** stat cards (users, riders, drivers, online now, rides
  today/total, completed today, pending top-ups, open complaints, pending
  driver approvals, platform revenue today + 7 days) + 7-day report +
  profit calculator (labelled ESTIMATES ONLY).
- **Rides:** all rides table (rider, driver, route, vehicle, fare, fee,
  status, scheduled time). **Drivers:** approve/block, CNIC/licence/reg
  shown, documents_status, online + wallet. **Users:** suspend/reactivate.
- **Top-ups:** pending list with TID + driver, Approve (after TID check in
  JazzCash app) / Reject with reason. **Wallets:** per-driver ledger lookup.
- **Promo codes:** create/list/deactivate. **Complaints:** SOS + complaints,
  resolve. **Cities:** list, add, activate/deactivate (writes the `cities`
  table; the rider app reads it via `/api/places`).
- **Settings:** fare rates incl. AC Car, minimums, commission % + booking
  fee (defaults stay 12% + Rs 20), JazzCash/Sadapay/support numbers,
  min top-up. **Audit log:** admin actions + wallet changes.
  **Security:** admin password change, demo-account disable, logout.
- Setup form visible ONLY while `setup_needed` is true; afterwards login
  only. Any 401 returns to the login screen. No admin function reachable
  without an admin session.

## 7. Visual design — blue / white / navy

Theme tokens (exact — every file uses these):
`--blue: #0b5ed7` · `--blue-dark: #0a4cb0` · `--blue-mid: #2f7fe0` ·
`--navy: #0a2540` · `--navy-2: #10365c` · `--sky-050: #eef5ff` ·
`--sky-100: #dbeafe` · `--sky-200: #bfdbfe` · `--ink: #0f1f33` ·
`--muted: #5b6b80` · `--line: #dbe4ef` · `--bg: #f2f6fb` · `--card: #ffffff` ·
`--green: #15803d` (success only) · `--red: #c1121f` · `--amber-bg: #fff8e1`.
Typography: Inter (existing) + Noto Naskh Arabic for Urdu strings.
Logo: white car on blue rounded square (regenerate via
`scripts/make-logo.py`); favicon + `theme-color` `#0a2540`.
Cards: white, 1px `--line` border, 16–18px radius, soft shadow. Primary
buttons navy/blue, 48px touch targets, press feedback, focus-visible rings.
Loading: buttons disable + spinner text while a request runs. Errors: inline
error text under the form (no `alert()` anywhere — a small toast system
replaces alerts). Empty states: dashed panels. Status badges keep the
existing colour semantics.

## 8. Map treatment

Leaflet + OpenStreetMap tiles (free, unchanged). Place pins with popups;
tap-to-set pickup then destination (keep the existing lock behaviour);
rider GPS marker (blue dot) + driver live marker during a trip; auto-fit
bounds on trip start. No Google Maps JS API (paid) — navigation links to
Google Maps/OSM directions stay as plain links.

## 9. i18n — Urdu + English

- One `STRINGS` dictionary per app (`app.js`, `admin.js`) with `en`/`ur`
  keys; static text via `data-i18n` attributes, dynamic text via `t(key)`.
- Toggle in the header + Profile screen; persisted in
  `localStorage["cr_lang"]`; default English.
- Urdu uses proper Urdu script (e.g. سواری بک کریں); layout stays LTR
  (standard for Pakistani ride apps); Urdu strings render in Noto Naskh
  Arabic. All main-screen strings, nav labels, buttons, and toast/error
  messages go through the dictionary — no hardcoded user-facing Roman Urdu
  left on main screens.

## 10. AC Car rate

**Rs 85/km, minimum Rs 200** — starting rate, admin-configurable in
Settings. The owner must confirm it (flag in the final report). Intercity
example: Chunian → Lahore 89 km ≈ Rs 7,565 by this rate (admin can change
it any time; existing Car rate Rs 70/km is untouched).

## 11. What stays vs what changes

- STAYS: all API routes and their contracts (except the additive endpoints
  in §2), auth/session/RBAC, top-up approval, wallet ledger, commission
  maths, ride/offer/chat/tip/schedule logic, seed demo data (phones hidden
  from UI, data untouched), `docs/backup.md`, smoke suite (extended, not
  replaced), Turso-ready DB path.
- CHANGES: `public/index.html` (new nav + screens, admin tab removed),
  `public/app.js` (rewrite: tab router, i18n, toast, GPS pickup, recent
  destinations, wallet/profile screens; admin functions move out),
  `public/style.css` (blue/navy theme), `public/admin.html` +
  `public/admin.js` + `public/admin.css` (new, separate admin website),
  `server/index.mjs` + `server/db.mjs` (AC Car + §2 endpoints only),
  logo/favicon (blue), `scripts/smoke-test.mjs` (new endpoint coverage),
  README (new structure + AC Car rate).

## 12. Testing & deploy

- `npm run smoke` must pass fully (old 94 checks + new endpoint coverage).
- Local boot + curl: `/` 200, `/admin` 200, `/api/health` ok,
  `/api/admin/setup-needed` shape unchanged.
- End-to-end local flows: rider signup → fare (incl. AC Car) → book → offer
  → accept → start → complete (commission maths) → tip → history; driver
  register → approve → online → request → counter → chat; admin setup →
  login → top-up approve → suspend/reactivate → settings save.
- Mobile (390px) + desktop (1280px) layout check; every button has a
  handler (no dead buttons); no demo credentials visible in served HTML.
- Restart persistence test on local file DB (records survive); Turso cloud
  test stays BLOCKED on the user's dashboard steps — record it, do not claim it.
- Deploy: commit + push to main (Render auto-deploys), verify live, roll
  back on any failure.
