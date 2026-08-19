# QLess Backend

API for the QLess CNG queue platform. Independent of any single client — it
serves the web/PWA frontend today and is designed to serve native Android and
iOS clients without change.

**Stack:** Node.js · Express · MongoDB · Mongoose · Zod · JWT · bcrypt ·
Socket.IO · Helmet · CORS

See [BACKEND_INTEGRATION.md](./BACKEND_INTEGRATION.md) for the full client-facing
API contract.

## Getting started

MongoDB must be running first:

```bash
mongod --dbpath /path/to/data --logpath /path/to/mongo.log --fork
```

Then:

```bash
cp .env.example .env      # fill in MONGODB_URI and the two JWT secrets
npm install
npm run seed              # 10 stations, 1 admin, 3 operators, 9 users
npm run dev
```

```bash
curl http://localhost:4000/api/v1/health
# {"success":true,"data":{"status":"ok"}}
```

Seeded accounts share the password `QLessDev#2026`:
`admin@qless.test`, `operator.navrangpura@qless.test`, `user1@qless.test` …

| Script | Purpose |
| --- | --- |
| `npm run dev` | Watch-mode dev server (nodemon) |
| `npm start` | Production server |
| `npm run seed` | Reset and reseed development data |
| `npm run lint` | ESLint over `src/` and `scripts/` |

## Architecture

```
src/
  config/         env validation, Mongo connection, logger, domain constants
  models/         Mongoose schemas — the only place indexes are declared
  routes/         versioned routing under /api/v1
  controllers/    thin — parse request, delegate, shape response
  services/       all business logic
  middleware/     auth, RBAC, validation, rate limiting, error handling
  notifications/  rule evaluator, message composer, Web Push transport
  sockets/        Socket.IO realtime gateway
  utils/          ApiError, response envelope, domain helpers, tokens
```

Rules: no business logic in routes or controllers; no model access outside
services; no inline validation outside `validators/`.

## API conventions

Everything is versioned under `/api/v1` and returns one of two envelopes:

```jsonc
{ "success": true,  "data": { } }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

`error.code` values are stable and part of the public contract — clients branch
on them. Stack traces are included only outside production.

Ids are MongoDB ObjectIds (24-char hex). Treat them as opaque strings.

## Domain rules that are easy to break

These are load-bearing. Changing them silently changes what the product tells
drivers.

**Reports are append-only.** `Report` documents are never updated or deleted —
they are the historical record the computed status is derived from. Corrections
are expressed as new reports. `station.status` is the only mutable projection,
and it is disposable precisely because everything it was computed from still
exists.

**Never just take the latest report.** Status is a weighted consensus over a
120-minute window, where each report is scaled by its source, its age, and its
reporter's reliability. Outliers are detected by modified z-score and
*downweighted*, never dropped — a lone dissenter may be the first person to
notice a change. An operator's most recent statement wins outright, because they
are describing their own forecourt.

**An unknown queue is `null`, never `0`.** Both bounds null means "nobody
knows", which is the opposite of "no queue". This propagates: an unknown queue
yields an unknown wait, and `maxQueue` filters exclude unknowns rather than
treating them as small.

**Pressure has no universal good/bad value.** Thresholds live on the station
(`pressureThresholdLow` / `pressureThresholdNormal`), falling back to the
platform defaults in `config/constants.js` only when unset.

**Notification thresholds are conservative.** A queue range of `4–7` does *not*
satisfy "at most 5" — the range does not guarantee it. Sending someone across
town on a maybe costs more trust than staying quiet costs opportunity.

**Leaving a station is not refuelling.** `StationVisit.completedAt` records only
that a visit ended; `outcome` stays `UNKNOWN` until the user says otherwise, and
`observedWaitMinutes` is recorded only for a confirmed refuel.

**Stale is never served as live.** Read paths re-derive freshness and rescale
confidence for the current moment, so a status written `LIVE` forty minutes ago
is served as `STALE` with no background job required.

## Indexes

Declared on the schemas and created automatically on connect. The ones that
matter:

- `stations.location` — **2dsphere**, powers `$geoNear` nearest-first discovery
- `stations.{active, status.availability}` — discovery filtering
- `reports.{station, createdAt}` — status computation (the hottest read)
- `reports.{user, station, createdAt}` — per-account report throttling
- `stationoperators.{user, active}` — the authorization hot path
- `notificationrules.{station, enabled}` — station-scoped rule evaluation
- `notificationevents.dedupeKey` — unique; makes delivery idempotent
- `refreshsessions.expiresAt` — TTL; Mongo reaps expired sessions itself

## Security

- **Passwords** bcrypt-hashed (cost 12) and `select: false`, so a plain query
  cannot leak the hash into a response.
- **Access tokens** are 15-minute JWTs; **refresh tokens** are opaque random
  strings stored only as a SHA-256 hash. Rotation revokes the old token, and
  replaying a consumed one revokes the whole session family as a suspected leak.
- **Roles are read from the database on every request**, never from a token
  claim or request body — so revoking rights takes effect immediately.
- **Operators may only act on assigned stations.** An unassigned station and a
  non-existent one return identical 403s, so the endpoint cannot enumerate ids.
- **Account enumeration** is prevented: login returns one generic message for
  wrong-password, unknown-email and disabled accounts, spending comparable CPU
  time in each path.
- Rate limiting is layered — IP-level in middleware, per-account and per-station
  in `services/report.service`.
- Admin overrides require a reason and are audited with identity and timestamp.

## Not implemented

Redis, Kafka, background job queues, microservices, and AI prediction — all
deliberately out of scope at this stage. Web Push delivery is inline; the
`notifications/webPush` transport is isolated so a queue worker can be added
later without touching rule evaluation.
