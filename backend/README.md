# QLess Backend

Backend API for the QLess CNG queue platform. Independent of any single client —
it serves the existing web/PWA frontend today and is designed to serve native
Android and iOS clients without change.

**Status: Parts 1–3 complete.** Part 1 delivered the database architecture,
configuration, validation, error handling, security middleware and seed data.
Part 2 added authentication, sessions, RBAC and operator-station assignments.
Part 3 added station discovery with nearest-first sorting, crowd reporting by
normal users, operator updates, supply events, location verification and saved
stations. Notifications and realtime are not built yet.

## Stack

Node.js · Express · TypeScript · PostgreSQL · Prisma · Zod · JWT · bcrypt ·
Helmet · CORS · Pino · Vitest

## Getting started

```bash
cp .env.example .env      # then fill in DATABASE_URL and the JWT secrets
npm install
createdb qless
npm run prisma:migrate
npm run seed
npm run dev
```

The server listens on `PORT` (default 4000).

```bash
curl http://localhost:4000/api/v1/health
# {"success":true,"data":{"status":"ok"}}
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Watch-mode dev server |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over `src/`, `prisma/` and `tests/` |
| `npm test` | Vitest suite against the `qless_test` database |
| `npm run prisma:format` / `prisma:validate` | Schema formatting and validation |
| `npm run prisma:migrate` | Create and apply a migration |
| `npm run seed` | Reset and reseed development data |

### Running the tests

Tests use a **separate** database and truncate it between cases, so they can
never touch development data — `tests/globalSetup.ts` refuses to run unless
`DATABASE_URL` names a database containing `qless_test`.

```bash
createdb qless_test
npm test          # migrations are applied automatically
```

## Architecture

```
src/
  config/          env validation, logger, Prisma client, domain constants
  controllers/     thin — parse request, delegate, shape response
  services/        business logic
    auth/          credential strategies + token/session issuance
  repositories/    all database access
  routes/          versioned routing under /api/v1
  middleware/      auth, RBAC, validation, errors, rate limiting, logging
  validators/      reusable Zod schemas
  errors/          AppError and the stable client-facing error codes
  utils/           tokens, password hashing, response envelope, geo, queue,
                   pressure, freshness helpers
  types/           shared API and auth types
  notifications/   reserved — Web Push delivery (later phase)
  sockets/         reserved — Socket.IO realtime (later phase)
  jobs/            reserved — status recomputation, aggregation (later phase)
```

Rules: no business logic in routes or controllers; no Prisma calls outside
repositories; no inline validation outside `validators/`.

## API conventions

All endpoints are versioned under `/api/v1` and return one of two envelopes.

```jsonc
// success
{ "success": true, "data": { } }

// failure
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

`error.code` values are stable and part of the public contract (see
`src/errors/errorCodes.ts`) — clients branch on them. Stack traces are included
only outside production. Every response carries an `x-request-id` header that
correlates to the structured logs.

### Endpoints

Access column: **guest** = no token needed, **auth** = any signed-in user,
**operator** = `STATION_OPERATOR` (or admin), **admin** = `ADMIN` only.

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | guest | Liveness — always `{ status: "ok" }` |
| GET | `/api/v1/health/detailed` | guest | Readiness, including database reachability |
| POST | `/api/v1/auth/register` | guest | Create an account (always a `USER`) |
| POST | `/api/v1/auth/login` | guest | Email + password → token pair |
| POST | `/api/v1/auth/refresh` | guest | Rotate a refresh token |
| POST | `/api/v1/auth/logout` | guest | Revoke the current session |
| GET | `/api/v1/auth/me` | auth | Current profile |
| POST | `/api/v1/auth/logout-all` | auth | Revoke every session for the user |
| GET | `/api/v1/stations/nearby` | guest | **Nearest-first** discovery with filters |
| GET | `/api/v1/stations` | guest | List active stations |
| GET | `/api/v1/stations/:stationId` | guest | Station detail (+ distance) |
| GET | `/api/v1/stations/:stationId/reports` | guest | Raw report history |
| GET | `/api/v1/stations/:stationId/supply-events` | guest | Supply event history |
| POST | `/api/v1/stations/:stationId/reports` | auth | **Submit a crowd report** |
| GET | `/api/v1/stations/saved` | auth | The caller's saved stations |
| POST | `/api/v1/stations/:stationId/save` | auth | Save a station |
| DELETE | `/api/v1/stations/:stationId/save` | auth | Unsave a station |
| GET | `/api/v1/stations/mine` | operator | Stations the caller is assigned to |
| PATCH | `/api/v1/stations/:stationId` | operator | Update an **assigned** station's config |
| POST | `/api/v1/stations/:stationId/operator-update` | operator | Report status as operator |
| POST | `/api/v1/stations/:stationId/supply-events` | operator | Record a supply event |
| PATCH | `/api/v1/stations/:stationId/supply-events/:eventId/close` | operator | Close an event |
| GET | `/api/v1/admin/users` | admin | List users |
| PATCH | `/api/v1/admin/users/:userId/role` | admin | Change a user's role |
| PATCH | `/api/v1/admin/users/:userId/active` | admin | Activate / deactivate |
| GET | `/api/v1/admin/stations/:stationId/operators` | admin | List assignments |
| POST | `/api/v1/admin/stations/:stationId/operators` | admin | Assign an operator |
| DELETE | `/api/v1/admin/stations/:stationId/operators/:userId` | admin | Revoke |
| GET | `/api/v1/admin/audit-logs` | admin | Audit trail |

`/auth/refresh` and `/auth/logout` are intentionally unauthenticated: both must
work once the access token has already expired. The refresh token is itself the
credential.

## Authentication

Email + password for the MVP, with **stateless access tokens and stateful
refresh sessions**.

**Access token** — a 15-minute JWT carrying `sub`, `role` and `sid` (session id),
sent as `Authorization: Bearer <token>`.

**Refresh token** — an opaque 48-byte random string, *not* a JWT. It carries no
claims and is meaningless without its database row, which stores only a SHA-256
hash. A database leak therefore yields no usable tokens, and any session can be
killed instantly.

Web clients also receive the refresh token as an httpOnly, SameSite=Lax cookie
scoped to `/api/v1/auth`, so XSS cannot read it. Native clients read it from the
response body and store it in the platform keychain. Both transports are
accepted; the body wins when both are present.

### Rotation and reuse detection

Every refresh issues a new token and revokes the old one, keeping a shared
`familyId`. Presenting an **already-revoked** token means it leaked, so the whole
family is revoked at once — the attacker and the victim are both logged out, and
the victim's forced re-login is the signal that something went wrong. Rotation
runs inside a transaction, so two concurrent refreshes cannot both succeed.

### Revocation is real

`authenticate` checks the session row on every request, so logout, an admin
deactivation, or a role change takes effect immediately rather than whenever the
access token happens to expire. This is the reason access tokens are validated
against the database at all rather than trusted purely on their signature.

### Adding OTP or magic links later

Credential verification sits behind `CredentialStrategy` in
`src/services/auth/strategy.ts`. Token issuance, session rotation and RBAC
consume only the `VerifiedIdentity` it returns and know nothing about how
identity was proven. Adding a new method means writing one strategy — the
session model already records `AuthMethod`, and `User.passwordHash` is nullable
precisely so a passwordless account is representable.

## Authorization

Three roles: `USER`, `STATION_OPERATOR`, `ADMIN`.

**Roles are never taken from the client.** `authenticate` reads the role from the
database on every request, so a role in a request body, a header, or even a
stale JWT claim has no effect on any decision. Self-registration always produces
a `USER`; elevation happens only through the admin surface.

| Middleware | Purpose |
| --- | --- |
| `authenticate` | Requires a valid token; 401 otherwise |
| `optionalAuthenticate` | Attaches the caller if a token is valid, else continues as guest |
| `requireRole(...roles)` | 403 unless the stored role is allowed |
| `requireStationAssignment()` | Enforces the operator-station rule |

`optionalAuthenticate` treats an *invalid* token exactly like no token, so an
expired session never breaks station browsing for someone who could have
browsed anonymously anyway.

### The operator rule

An operator may modify **only** stations they hold an active `StationOperator`
assignment for. Anything else is `403`, enforced server-side by
`requireStationAssignment` and re-checked in `stationService.updateAsOperator`
so the rule survives a future route that forgets the middleware. The frontend
hiding a station is irrelevant to this.

An unassigned station and a non-existent one return **identical** 403 responses,
so the endpoint cannot be used to enumerate station ids. Admins bypass the
assignment requirement (they manage the platform) but the station must exist.

Operators are further limited in *what* they may change: `name`, `address`,
`latitude` and `longitude` are platform data and are rejected outright by the
`.strict()` update schema. Only operational fields — dispenser count, operating
hours, active flag and pressure thresholds — are writable.

### Guest access

Station discovery is deliberately open: `GET /stations` and
`GET /stations/:stationId` work with no token, because a driver looking for gas
should not have to sign up first. Authentication is required for everything that
writes on a user's behalf — reports, alerts, saved stations, visits, operator
updates and all admin functionality.

## Security notes

- **Passwords** are bcrypt hashed at cost 12 and never returned by any endpoint.
- **Account enumeration**: login returns one generic `Invalid email or password`
  for a wrong password, an unknown address *and* a disabled account, and spends
  comparable CPU time in each case so timing does not leak either. Registration
  necessarily reveals that an address is taken, which is why it carries the
  tightest rate limit.
- **Rate limits**: login 10 per 15 min per IP (successful logins are not
  counted), registration 5/hour, refresh 60 per 15 min, plus the global API
  limit. Login is keyed by IP rather than IP+email — keying on the submitted
  address would let an attacker sidestep the limit by varying it.
- **Secret hygiene**: startup refuses to boot in production if the JWT secrets
  still hold placeholder values or if the two secrets are identical.
- Access tokens are rejected if presented where a refresh token is expected, and
  vice versa.

## Station discovery

```
GET /api/v1/stations/nearby?latitude=23.0225&longitude=72.5714&radius=5000
```

**Nearest first is the default and is always applied explicitly.** No response
ordering anywhere in this codebase relies on database insertion order. Distance
is returned as `distanceKm` (and `distanceM`) for every station.

| Parameter | Meaning |
| --- | --- |
| `latitude`, `longitude` | Required. The search origin |
| `radius` | Metres, default 5 000, capped at 50 000 |
| `sort` | `distance` (default), `wait`, `queue`, `recent` |
| `limit` | Default 20, max 100 |
| `availability` | Comma-separated, e.g. `AVAILABLE,LOW_SUPPLY` |
| `maxQueue`, `maxWait`, `minPressure` | Numeric filters |

The caller's `limit` is applied **after** the requested sort, so
`sort=queue&limit=5` returns the five shortest queues in the radius rather than
the five nearest stations reordered.

Non-distance sorts fall back to distance for ties, and stations with no data
sort **last** — an unknown wait is not a short wait. For the same reason,
`maxQueue` and `maxWait` exclude unreported stations rather than treating a
missing value as zero.

### Swapping in PostGIS

Proximity search sits behind the `StationGeoQuery` interface in
`src/repositories/geo/`. The MVP implementation prefilters with a bounding box
in SQL (served by the `[latitude, longitude]` index) and computes exact
Haversine distances in Node, trimming the box's corners back to a true circle.

Adopting PostGIS means writing a second implementation of that interface
(`ST_DWithin` over a `geography` column with a GiST index) and changing the one
line in `src/repositories/geo/index.ts` that selects it. No service, controller,
route or response-shape changes.

## Crowd reporting

**Any authenticated USER can report queue length and availability, and
optionally pressure. No operator assignment is required.** This is the
platform's primary data source; operators are a higher-trust supplement, not a
prerequisite.

```jsonc
POST /api/v1/stations/:stationId/reports
{
  "queueRange": "4-7",          // "0-3" | "4-7" | "8-15" | "16-25" | "25+" | "UNKNOWN"
  "availability": "AVAILABLE",
  "pressureValue": 205,          // optional
  "latitude": 23.0365,           // optional, but see below
  "longitude": 72.5611
}
```

Every field is optional — partial reporting is the norm, since a driver can see
the queue from the road without knowing anything about pressure. The only
requirement is that the submission carries at least one piece of information.

### "Not sure" is never turned into zero

`"queueRange": "UNKNOWN"` writes **no queue row at all**, and the computed
status keeps `queueMin`/`queueMax` as `null` with bucket `UNKNOWN`. An unknown
queue is not an empty forecourt, and the two must never be confused. The same
rule holds downstream: an unknown queue yields an unknown wait rather than a
wait of zero, and filters skip unknowns instead of treating them as small.

A report where *everything* is UNKNOWN is rejected — it carries no information.

### Location verification is done by the backend

The client sends coordinates. It does **not** get to say whether they count as
verified.

| Situation | Stored source |
| --- | --- |
| Within the geofence (default 200 m) | `VERIFIED_NEARBY_USER` |
| Outside the geofence | `NORMAL_USER` |
| No coordinates supplied | `NORMAL_USER`, still stored |
| Operator on an assigned station | `OPERATOR` |

The radius is configurable via `LOCATION_VERIFICATION_RADIUS_M`. A report
submitted with `locationVerified: true` in the body is **rejected outright** —
the schemas are `.strict()`, so a forged verification flag or `source` field is
a 422 rather than something silently ignored. Even if it were accepted, the
stored value is always the one computed from the submitted coordinates.

A client can of course send *false* coordinates; defeating that is GPS spoofing,
not an API concern. What the backend guarantees is that the claim it was given
is actually checked.

### Report throttling

Database-backed and keyed per **account** and per **station** — the limit that
matters cannot be expressed by an IP-keyed limiter, since one user on mobile
data moves between IPs and a whole office shares one. The IP limiter still runs
in front as a coarse first line of defence.

| Control | Limit |
| --- | --- |
| Global cooldown | 10 s between a user's reports anywhere |
| Per-station cooldown | 60 s between a user's reports for one station |
| Hourly cap | 30 reports overall, 6 per station |
| Duplicate window | Identical repeat within 10 min → `409 DUPLICATE_REPORT` |

Cooldown rejections return `429` with code `REPORT_COOLDOWN` and a
`retryAfterSeconds` detail. Operators are exempt: a busy forecourt changes fast
and they need to keep up.

## Operator updates

Operator status reports go through `POST /:stationId/operator-update` and are
gated by the same `requireStationAssignment` rule as everything else — an
operator acting on an unassigned station gets `403` and nothing is written.

**Operator updates do not write to `StationStatus` directly.** They create the
same append-only report rows a user report would, tagged `source: OPERATOR`,
and the status is then recomputed from that history. One code path, and every
operator action is auditable afterwards.

### Supply events

`SUPPLY_ARRIVED`, `LOW_SUPPLY`, `CNG_FINISHED`, `TEMPORARY_INTERRUPTION`, plus
`SUPPLY_RESTORED`, `MAINTENANCE_START`/`_END` and `STATION_CLOSED`/`_REOPENED`.
Each stores its type, start timestamp and the operator who reported it, and
writes a matching availability report so the status picks it up through the
normal path. Closing an event sets `endedAt` — it is never deleted.

## Status computation

`StationStatus` is derived from the raw reports in a 120-minute window. Reports
are weighted by **source** (operator 1.0, verified nearby user 0.7, remote user
0.35) and by **recency** (linear decay across the window).

Two rules are worth knowing:

**An operator's latest statement wins outright.** It is not one vote among many.
An operator who has just declared `CNG_FINISHED` is stating a fact about their
own forecourt; letting an accumulation of slightly older "available" crowd
reports out-vote them would keep sending drivers to an empty station. Crowd
reports are averaged only when no operator has spoken recently.

**Confidence is explainable, not learned.** 0–100, blended from how trustworthy
the best reporting source was (55), how much reporters agree (25), and how
recent the newest input is (20). A driver deciding whether to cross town
deserves a number they can reason about. Nothing here is AI prediction — that
remains out of scope.

Pressure is normalised to bar for comparison but stored in the unit reported.
`PressureStatus` is always relative to that **station's own** configured
thresholds; the platform defaults in `config/constants.ts` are a fallback only.
The thresholds are echoed in the API response so clients can explain a `LOW`
reading rather than guessing.

## Raw data is never rewritten

`QueueReport`, `AvailabilityReport`, `PressureReport` and `SupplyEvent` are
append-only. `report.repository.ts` deliberately exposes **no update or delete
method** — corrections are expressed as new reports. `StationStatus` is the only
mutable projection, and it is disposable precisely because everything it was
computed from still exists.

## Data model notes

Three decisions are load-bearing and easy to break by accident:

**`StationStatus` is a computed projection, not history.** It holds one row per
station and is overwritten by the status computation. The raw
`QueueReport` / `AvailabilityReport` / `PressureReport` tables are the
append-only historical source of truth and must never be mutated to reflect
current state.

**An unknown queue is `null`, never `0`.** Queue size is stored as an inclusive
`[queueMin, queueMax]` range; both bounds null means "nobody knows", which is
semantically the opposite of "no queue". `queueBucket` carries `UNKNOWN` for
these. Validation enforces that the two bounds are supplied together.

**Pressure has no universal good/bad value.** Thresholds live on the station
(`pressureThresholdLow`, `pressureThresholdNormal`), falling back to the
platform defaults in `src/config/constants.ts` only when unset. `PressureStatus`
is always a judgement relative to that station's own configuration. Readings are
stored in the unit they were reported in and normalised to bar for comparison.

Two smaller ones:

- **Reports come from users as well as operators.** `ReportSource` distinguishes
  `OPERATOR`, `VERIFIED_NEARBY_USER`, `NORMAL_USER`, `ADMIN` and
  `SYSTEM_ESTIMATE` so later confidence scoring can weight them differently.
- **Leaving a station is not the same as refuelling.** `StationVisit.completedAt`
  records only that the visit ended; `outcome` stays `UNKNOWN` until success is
  actually established.

## Seed data

`npm run seed` clears and reloads a realistic development dataset: 10 stations
across Ahmedabad and Gandhinagar (1.9 km – 22 km apart, so distance sorting is
testable), 1 admin, 3 operators covering 5 station assignments, 9 normal users,
plus varied statuses, raw reports, visits, saved stations, notification rules and
push subscriptions. Stations deliberately span every availability state,
every queue bucket including `UNKNOWN`, all pressure statuses, and the full
freshness/confidence range. IDs are deterministic, so re-running is safe and
manual API testing against fixed ids works.

Every seeded account shares the password **`QLessDev#2026`** (development only):

| Account | Role | Notes |
| --- | --- | --- |
| `admin@qless.test` | ADMIN | Full platform access |
| `operator.navrangpura@qless.test` | STATION_OPERATOR | Manages Navrangpura, staffs Vastrapur |
| `operator.bopal@qless.test` | STATION_OPERATOR | Manages Bopal Highway |
| `operator.sghighway@qless.test` | STATION_OPERATOR | Manages SG Highway, staffs Chandkheda |
| `user1@qless.test` … `user9@qless.test` | USER | Normal users |

The operator assignments are deliberately partial, so the 403 path is easy to
exercise by hand: the Navrangpura operator can update station
`57a71040-…-000000000001` but not Bopal (`…-000000000004`).

Station statuses are **recomputed from the seeded reports** at the end of the
seed, so the derived state genuinely agrees with the history behind it. The
result still spans the full range — confidence 0–100, every freshness level, and
two stations whose reports have aged out of the input window and correctly show
`UNKNOWN` with null queue bounds.

## Environment

Required variables are validated by Zod at startup and the process exits with a
readable message if any is missing or malformed — see `src/config/env.ts`.
`FRONTEND_URL` accepts a comma-separated list of allowed CORS origins; requests
with no `Origin` header are permitted so native mobile clients work.

## Not implemented yet

Notification delivery (Web Push), Socket.IO realtime broadcasting, historical
metric aggregation, and the recommendation engine. The models and directory
seams for each exist; the behaviour does not.
