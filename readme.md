# QLess

**Fuel up. Wait less.**

QLess helps CNG drivers answer one question fast: *where should I fill up right now?*
It shows real, nearby CNG stations ranked nearest → farthest, with live queue length,
availability, gas pressure, and estimated wait — reported by drivers and operators, not
guessed.

Live demo: see [Deployment](#deployment) below for the current backend/frontend URLs
once deployed.

---

## Why QLess exists

Google Maps can tell you a CNG station exists. It can't tell you the queue is 20 cars
deep right now, or that the pump ran dry an hour ago. That gap — station *location* vs.
station *condition* — is what QLess fills.

- **Station identity** (name, coordinates, address) comes from Google Places, so the
  list is never limited to a hand-seeded set of stations.
- **Station condition** (queue, availability, pressure, wait, freshness, confidence)
  comes only from real reports — drivers and station operators. Nothing is fabricated.
  A station Google just discovered with zero reports shows *"Live information
  unavailable"*, never a fake number.

## How it works

```
                 ┌─────────────────────┐
                 │   Google Places API  │   identity & location only:
                 │  (discovery, cached) │   name · lat/lng · address · placeId
                 └──────────┬───────────┘
                            │ cached on first lookup per area
                            ▼
   ┌────────────────────────────────────────────────┐
   │                    MongoDB                       │
   │   Station (identity + cached place data)         │
   │   Report  (append-only: queue/availability/       │
   │             pressure, submitted by users/ops)    │
   │   → status is COMPUTED from recent reports,       │
   │     never stored as a single "current" value      │
   └──────────────────────┬───────────────────────────┘
                           │ REST + Socket.IO (realtime status pushes)
                           ▼
                  ┌──────────────────┐
                  │  Next.js frontend │  nearest → farthest list, map view,
                  │  (PWA, mobile-    │  report sheet, notify-me alerts
                  │   first)          │
                  └──────────────────┘
```

1. A user opens the app; the browser gives their coordinates.
2. The backend checks MongoDB for known stations nearby. If coverage is thin, it
   queries Google Places once for that area and **caches** the results (name,
   coordinates, address, Place ID) — so the same area is never re-queried needlessly.
3. Every station is returned **nearest → farthest**, always. Stations with no reports
   yet are clearly marked unknown rather than guessed.
4. Any user or station operator can submit a report (queue length, availability,
   pressure). The backend combines recent reports into a weighted, time-decayed status
   — a single stale report doesn't get treated as gospel, and a lone dissenting report
   isn't thrown away either.
5. Notification rules watch for a station crossing a threshold (e.g. "queue under 5
   cars") and alert the user via Web Push in real time.

This is deliberately a **manual-reporting-first** system. The data model already
distinguishes report source, freshness, and reliability — the groundwork for a future
automated/ML queue-estimation layer — but no such automation exists yet. See
[Roadmap](#roadmap).

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 14 (App Router) · TypeScript · SCSS · PWA |
| Backend | Node.js · Express · MongoDB · Mongoose · Socket.IO |
| Auth | JWT access tokens + rotating opaque refresh tokens |
| Realtime | Socket.IO (station status pushes), Web Push (notifications) |
| External data | Google Places API (station discovery, cached in MongoDB) |
| Validation | Zod |

## Project structure

```
QLess/
├── backend/    Node/Express API — see backend/README.md and
│               backend/BACKEND_INTEGRATION.md for the full API contract
├── frontend/   Next.js PWA — customer-facing app
└── memory/     Historical product notes (early-phase PRD; not authoritative)
```

Each half has its own README with far more detail than belongs here:

- **[backend/README.md](backend/README.md)** — architecture, domain rules that are
  easy to break (report weighting, staleness, security), indexes, setup.
- **[backend/BACKEND_INTEGRATION.md](backend/BACKEND_INTEGRATION.md)** — the full
  client-facing API contract (every endpoint, request/response shape, auth flow).

---

## Getting started

You need both services running locally: MongoDB + the backend API, then the frontend.

### 1. Backend

```bash
cd backend
cp .env.example .env      # fill in MONGODB_URI and the two JWT secrets
npm install
npm run seed               # 10 stations, 1 admin, 3 operators, 9 users
npm run dev                 # http://localhost:4000
```

Confirm it's up:

```bash
curl http://localhost:4000/api/v1/health
# {"success":true,"data":{"status":"ok"}}
```

Seeded accounts share the password `QLessDev#2026` — e.g. `admin@qless.test`,
`operator.navrangpura@qless.test`, `user1@qless.test`.

**Optional — real station discovery:** set `GOOGLE_PLACES_API_KEY` in `backend/.env`
to have nearby CNG stations discovered from Google Places (with **Places API (New)**
enabled) and cached into MongoDB. Without a key, the app runs on seeded/manually
added stations only — nothing breaks, discovery is simply skipped.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:3000
```

Copy `.env.example` to `.env.local` and point `NEXT_PUBLIC_API_BASE_URL` at your
backend. A `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` enables the real interactive map; without
one, a lightweight built-in map view is used instead.

---

## Key product decisions

- **Nearest → farthest is the permanent default order.** Sort/filter options exist,
  but distance ordering is never silently overridden.
- **Reports are append-only.** Nothing is edited or deleted — corrections are new
  reports, and the historical record is preserved (also the foundation for any future
  ML training data).
- **An unknown queue is `null`, never `0`.** "Nobody has reported" and "no queue" are
  opposite facts, and the system never confuses them.
- **Stale data is never served as live.** Freshness and confidence are recomputed on
  every read, not on a background timer.
- **Discovered ≠ verified.** A station found via Google Places with no community
  reports yet is shown honestly as having no live data.

## Roadmap

Explicitly **not** implemented yet, by design:

- Automated / computer-vision-based queue estimation
- ML models trained on historical report data (the report schema is structured with
  this in mind, but no training or inference pipeline exists)
- Any form of traffic/imagery scraping for vehicle-density estimation

The near-term priority is making manual reporting rock-solid — accurate distances,
reliable community/operator reports, clear freshness and confidence — before any
automation is layered on top.

## Deployment

- **Backend:** [`backend/render.yaml`](backend/render.yaml) — Render web service,
  Node 20, health check at `/api/v1/health`.
- **Frontend:** [`frontend/vercel.json`](frontend/vercel.json) — Vercel, Next.js.

Both are free-tier configs; expect a cold-start delay on the first request after
idling.
