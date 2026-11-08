# Chunian Ride — Version 1 (Testing)

inDrive-style ride-hailing website for **Chunian, Tehsil Chunian, District Kasur, Punjab, Pakistan** (~70 km south of Lahore, Pattoki–Kasur road). Bike, rickshaw and car. Cash-first, negotiated fares, prepaid driver wallet.

**Uber does NOT operate in Pakistan** (app ceased 30 Apr 2024) and **Careem ride-hailing ended 18 Jul 2025** — this is a local service modelled on inDrive, not Uber.

## What it does

- **Rider:** phone + password login (bcrypt-hashed, server sessions — no SMS OTP: no free SMS OTP exists), OpenStreetMap/Leaflet map (no paid Google Maps key), saved places with correct road distances (Chunian city, Pattoki 14 km, Lahore ~89 km by road, Kasur ~48 km, Changa Manga ~13 km, Theeng Mor ~12 km, Kot Radha Kishan ~30 km, Allahabad — distance unverified, estimated from map), vehicle choice (Bike / Rickshaw / Car), suggested fare per km shown before booking, rider proposes a fare, sees driver offers (fare, name, vehicle, plate, rating, ETA) and picks one, **scheduled rides** (book up to 7 days ahead — date + time, shown to drivers), live trip card, share-trip link, SOS (Police 15 / Rescue 1122), rate driver, **tip after a completed ride** (Rs 20 / 50 / 100 or custom — 100% driver, no commission), ride history + receipts (with scheduled time and tip shown).
- **Driver:** phone + password login, online/offline toggle, sees requests with pickup, destination, distance, rider-proposed fare and rider rating BEFORE accepting (scheduled time shown for scheduled rides); can accept, counter-offer, or decline with **no penalty** — counter-offer has **quick buttons +10% / +15% / +20%** of the rider's offer plus free-text input; navigation links (Google Maps / OSM); trip can only be completed after confirming cash received; prepaid wallet with JazzCash top-up (owner JazzCash **03266040350**) — **top-up requests stay pending until the owner verifies the TID and approves; a fake TID buys nothing** (minimum top-up Rs 500); Sadapay number is an admin setting left **empty** — the owner fills it in, it was never invented; commission per ride shown; daily/weekly earnings (tips shown separately, 100% driver); rate rider; registration with CNIC / licence / vehicle registration (owner approves).
- **Owner/Admin (password-protected owner account — the shared PIN is only a one-time setup key):** live driver map, all rides, approve/block drivers, top-up requests (verify TID, approve/reject), users list (suspend/reactivate), promo codes (foundation), audit log, fare + commission settings that change suggested fares immediately, wallet ledger per driver, complaints/SOS list, 7-day reports, profit calculator using the research report's break-even maths (lean ~Rs 60,000/month costs, 30–50 rides/day needed) labelled clearly as **ESTIMATES, never guarantees**.

## Rates (starting defaults, admin-changeable)

Bike Rs 15/km (min Rs 50) • Rickshaw Rs 25/km (min Rs 100) • Car Rs 70/km (min Rs 150).
Commission **12% + Rs 20 booking fee** per ride, deducted from the driver's prepaid wallet on trip completion.

## Seed data (demo, clearly marked in the app)

4 demo drivers — Ahmed Raza (Bike, Honda CD 70), Bilal Hussain (Rickshaw), Usman Ghani (Car, Toyota Corolla), Hassan Ali (Car, Suzuki Alto) — phones 0301-0000001…4, each with Rs 2,000 demo wallet. 2 demo completed rides (Chunian→Pattoki car Rs 980, fee Rs 138; within-Chunian bike Rs 50, fee Rs 26).

## Run locally

```bash
npm install
npm start          # http://localhost:3000
npm run smoke      # boots the server and runs a full end-to-end API pass
```

## Database — IMPORTANT CAVEAT

Default is a **local SQLite file** (`data/chunian-ride.db`, via `@libsql/client` `file:` URL). The app is fully Turso-ready and the remote-libSQL code path is verified (see `scripts/remote-db-test.mjs`, tested against a local `sqld`), but **no Turso database exists yet**: the Turso CLI is not logged in on this machine and login needs an interactive browser OAuth flow. **Render free disks are ephemeral, so with the local file all data resets on redeploy/restart.**

For persistent data, create a Turso database (`turso auth login`, then `turso db create chunian-ride`), then set in Render:
- `TURSO_DATABASE_URL` = `libsql://...`
- `TURSO_AUTH_TOKEN` = token from `turso db tokens create chunian-ride`

Then redeploy and verify `/api/health` reports `db: "turso"`, and run the persistence test (create records → redeploy → verify they survive). Backup/restore instructions: `docs/backup.md`.

The Zoomly production Turso database is **not** reused for this app.

## Phase 1 (2026-11-08) — trust layer

- **Auth:** phone + password (bcrypt), server-side sessions, role-based access on every endpoint, login rate limiting. No SMS OTP (none exists for free).
- **Top-up approval (G2 fix):** requests stay pending until the owner verifies the TID and approves; credit happens exactly once, inside one transaction.
- **Admin accounts:** password-protected owner/admin accounts; the shared PIN is only a one-time bootstrap key for the first owner account, then dead.
- **Schema:** new tables `sessions`, `admins`, `topup_requests`, `ride_status_history`, `audit_log`, `vehicles`, `cities`, `wallets`, `transactions`, `promo_codes`, `passengers`; all migrations additive and idempotent. `wallets` is the single source of truth for balances.
- **Tests:** `npm run smoke` (94 checks, all pass) + `node scripts/remote-db-test.mjs` (12 checks against a local `sqld` remote-libSQL server, all pass, including restart persistence). Full gap analysis: `docs/phase1-gap-analysis.md`.
- **Still open:** Turso cloud database creation (owner's browser step, see above). Until then the live site runs on local SQLite and data resets on redeploy.

## Deploy on Render (dashboard step — no API key was available)

1. Render dashboard → **New → Blueprint** → connect repo **`ranasajeel125-crypto/chunian-ride`**.
2. Set env vars (names only): `TURSO_DATABASE_URL` (optional), `TURSO_AUTH_TOKEN` (optional), `ADMIN_PIN` — **change from the default `1234`**.
3. **Deploy.** Health check: `/api/health`.

## Free-hours warning

The user's Render free pool is already tight (Zoomly keep-alive ~720h/month of a 750h pool; SMM panel shares it). Adding this service will push the pool over unless the user picks a paid plan or stops a keep-alive. **No keep-alive cron was added for this service.**

## Admin setup

The admin area uses a password-protected **owner account**, not a PIN.

1. Open the site → **Owner / Admin** tab. If no admin account exists yet, the
   **setup form** shows: enter the current `ADMIN_PIN` (one-time bootstrap
   key), the owner phone, and a new admin password (min 6 characters).
2. After setup, the PIN stops working entirely — login is phone + password.
3. The admin password can be changed in-app (Admin tab → Security card).
   Changing it logs out all other admin sessions.

Default `ADMIN_PIN` is `1234` (env `ADMIN_PIN`) — it is only the one-time
setup key. Change it in Render after the owner account is created.
