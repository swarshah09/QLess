# QLess Backend — Frontend Integration Guide

Everything a client (web PWA, Android, iOS) needs to talk to this API.

- **Base URL:** `http://localhost:4000/api/v1` (dev) — all endpoints are versioned under `/api/v1`
- **Stack:** Node.js · Express · MongoDB · Mongoose · JWT · Socket.IO
- **Health:** `GET /api/v1/health` · `GET /api/v1/health/detailed`

> **Ids are MongoDB ObjectIds** (24-char hex, e.g. `6a7d6cd76e6a1beb2c19219f`),
> not UUIDs. Treat them as opaque strings — the API shape is otherwise
> unchanged.

## Response envelope

Every response is one of two shapes.

```jsonc
{ "success": true,  "data": { /* ... */ }, "meta": { /* optional */ } }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "...", "details": [] } }
```

Paginated endpoints return `data.items` plus `data.pagination`
(`page`, `limit`, `total`, `totalPages`, `hasNextPage`, `hasPreviousPage`).

Every response carries an `x-request-id` header — include it in bug reports.

## Auth flow

Access token = 15-minute JWT. Refresh token = opaque, revocable.

```
POST /auth/register  { name, email, password }        → 201 { user, tokens }
POST /auth/login     { email, password }              → 200 { user, tokens }
GET  /auth/me                                          → 200 { user }
POST /auth/refresh   { refreshToken? }                 → 200 { user, tokens }
POST /auth/logout    { refreshToken? }                 → 200 { loggedOut: true }
POST /auth/logout-all                                  → 200 (all devices)
```

1. Send `Authorization: Bearer <accessToken>` on authenticated requests.
2. On `401`, call `POST /auth/refresh`, then retry once.
3. **Refresh tokens rotate.** Store the new one each time and discard the old.
   Replaying a consumed refresh token is treated as a leak and revokes every
   session for that user — never retry a refresh with an old token.

**Web:** the refresh token is also set as an httpOnly cookie scoped to
`/api/v1/auth`; send `credentials: 'include'` and you may omit `refreshToken`
from the body. **Native:** read it from the response body and store it in the
platform keychain.

`register` always creates a `USER`. A `role` in the body is ignored.

## Station discovery

Guest-accessible — no token required.

```
GET /stations/nearby?latitude=23.0225&longitude=72.5714&radius=5000
```

| Param | Notes |
| --- | --- |
| `latitude`, `longitude` | **required** |
| `radius` | metres, default 5000, max 50000 |
| `sort` | `distance` (default) · `wait` · `queue` · `recent` |
| `limit` | default 20, max 100 |
| `availability` | comma-separated, e.g. `AVAILABLE,LOW_SUPPLY` |
| `maxQueue`, `maxWait`, `minPressure` | numeric filters |

**The default order is NEAREST FIRST and never changes.** `limit` is applied
after sorting. Stations with no data sort last.

Other reads: `GET /stations/:stationId` (add `latitude`/`longitude` for
distance), `GET /stations/:stationId/reports` (raw history),
`GET /stations/:stationId/supply-events`.

### Station shape

```jsonc
{
  "id": "uuid", "name": "...", "latitude": 23.03, "longitude": 72.57,
  "distanceKm": 1.9, "distanceM": 1880, "saved": false, "active": true,
  "status": {
    "availability": "AVAILABLE",
    "queue":    { "min": 4, "max": 7, "bucket": "RANGE_4_7", "label": "4-7" },
    "wait":     { "min": 5, "max": 15 },
    "pressure": { "value": 205, "unit": "BAR", "status": "NORMAL",
                  "thresholds": { "low": 160, "normal": 200 } },
    "activeDispensers": 4,
    "confidence": 92,
    "freshness": "LIVE",
    "computedAt": "2026-08-07T10:00:00.000Z"
  }
}
```

**Rendering rules — these matter:**

- `queue.min`/`queue.max` **null** means *unknown*, **not zero**. Render
  "Unknown", never "No queue". Same for `wait`.
- `freshness`: `LIVE` (<5 min) · `RECENT` (<15) · `AGING` (<30) · `STALE` ·
  `EXPIRED` · `UNKNOWN`. Show an age indicator for anything past `RECENT`.
- `confidence` is 0–100. Treat below ~40 as low.
- `pressure.status` is relative to **that station's** thresholds, which are
  echoed so you can explain a `LOW` reading.

### Recommendation

```
GET /stations/recommendations?latitude=..&longitude=..&radius=..
```

Returns `{ stations, recommendation, travelAssumptions }`. **`stations` is the
same nearest-first list** — the recommendation is separate metadata, not a
reordering.

```jsonc
"recommendation": {
  "recommendedStationId": "uuid|null",
  "nearestStationId": "uuid|null",
  "differsFromNearest": true,
  "savingMinutes": 14,
  "reason": "SG Highway is further but should save roughly 14 min overall",
  "alternatives": [{ "stationId": "...", "name": "...", "savingMinutes": 6 }]
}
```

`recommendedStationId` is `null` when nothing is trustworthy enough. Unavailable,
stale and low-confidence stations are never recommended. Travel time is
approximate (straight-line at an assumed city speed) — label it as such.

## Report submission

Any authenticated `USER`. **No operator assignment needed.**

```
POST /stations/:stationId/reports
{
  "queueRange": "4-7",        // "0-3"|"4-7"|"8-15"|"16-25"|"25+"|"UNKNOWN"
  "availability": "AVAILABLE", // optional
  "pressureValue": 205,        // optional
  "pressureUnit": "BAR",       // optional
  "latitude": 23.0365,         // optional, but see below
  "longitude": 72.5611
}
```

All fields optional; send at least one. Response includes `locationVerified`,
`source` and `distanceToStationM`, plus the recomputed `status`.

- **Send coordinates when you have them.** Within 200 m the report is stored as
  `VERIFIED_NEARBY_USER` and weighted higher; outside, `NORMAL_USER`.
- **Never send `locationVerified`** — the schema is strict and will reject the
  whole request with `422`. Verification is computed server-side.
- `"UNKNOWN"` is a valid, encouraged answer. Offer it in the UI.

**Throttling:** 10 s between any two reports, 60 s per station, 6/hour per
station, 30/hour overall. Handle `429 REPORT_COOLDOWN` (has
`details[].retryAfterSeconds`) and `409 DUPLICATE_REPORT`.

## "I'm Here" visits

```
POST  /stations/:stationId/visits                      { latitude, longitude }
PATCH /stations/:stationId/visits/:visitId/join-queue
PATCH /stations/:stationId/visits/:visitId/complete    { outcome? }
GET   /stations/visits                                 (history, paginated)
```

Coordinates are **required** and verified — a check-in beyond 200 m returns
`422`. `outcome` is `UNKNOWN` | `REFUELLED` | `ABANDONED_QUEUE` |
`STATION_UNAVAILABLE`; it defaults to `UNKNOWN`, because **ending a visit is not
evidence of a successful refuel**. Prompt the user for the real outcome.

## Saved stations

```
GET    /stations/saved?latitude=..&longitude=..   (nearest-first when given)
POST   /stations/:stationId/save                  { label? }
DELETE /stations/:stationId/save
```

## Notification flow

```
GET    /notifications/rules
POST   /notifications/rules    { stationId, requiredAvailability?, maxQueue?,
                                 maxWaitMinutes?, minPressure?, enabled?,
                                 cooldownMinutes? }
PATCH  /notifications/rules/:id
DELETE /notifications/rules/:id
GET    /notifications/events                      (delivery history)
```

At least one condition is required. Conditions combine with **AND**.

**Conservative thresholds — explain this in your UI.** `maxQueue: 5` does *not*
match a station reading `4–7`, because the range does not guarantee it. Unknown
values never satisfy a threshold.

A rule fires only on the transition **false → true**, then enters cooldown
(default 30 min). Editing conditions resets the state.

### Push subscription

```
GET    /notifications/vapid-public-key      (public — no auth)
GET    /notifications/subscriptions
POST   /notifications/subscriptions   { endpoint, keys: { p256dh, auth } }
DELETE /notifications/subscriptions   { endpoint }
```

Flow: fetch the VAPID key → `registration.pushManager.subscribe()` → POST
`subscription.toJSON()` verbatim. Multiple devices per user are supported;
re-posting an existing endpoint is idempotent. Expired subscriptions are
deactivated server-side automatically.

Push payload:

```jsonc
{
  "title": "Good time to refuel ⛽",
  "body": "Shree CNG now has a short queue, ~8 min wait and CNG is available.",
  "data": { "url": "/stations/<stationId>", "tag": "station-<stationId>", "...": "..." }
}
```

Open `data.url` on notification click.

## Socket.IO realtime

Same origin and port as the REST API, path `/socket.io`.

```js
const socket = io('http://localhost:4000', {
  auth: { token: accessToken },   // optional — guests may connect
});

socket.emit('station:subscribe', stationId);      // one room per station
socket.on('station:subscription', ({ stationId, subscribed }) => {});

socket.on('station:updated', (s) => {
  // { stationId, availability, queueMin, queueMax, waitMin, waitMax,
  //   pressureValue, pressureUnit, pressureStatus, activeDispensers,
  //   confidence, freshness, computedAt }
});

socket.emit('station:unsubscribe', stationId);
socket.on('error', ({ message }) => {});
```

Subscribe only to the stations currently on screen. `station:updated` fires
after every status recomputation. The payload mirrors the REST `status` object
(flattened), so you can apply it directly to fetched state — including the
`null`-means-unknown rule.

## Operator APIs

Require role `STATION_OPERATOR` (or `ADMIN`) **and** an active assignment to
that station. Anything else returns `403`.

```
GET   /stations/mine                                   (assigned stations)
POST  /stations/:stationId/operator-update  { queueRange?, availability?,
                                              pressureValue?, activeDispensers?, note? }
PATCH /stations/:stationId                  { active?, numberOfDispensers?,
                                              operatingHours?, pressureThreshold* }
POST  /stations/:stationId/supply-events    { type, note?, availability? }
PATCH /stations/:stationId/supply-events/:eventId/close
```

`type`: `SUPPLY_ARRIVED` · `LOW_SUPPLY` · `CNG_FINISHED` ·
`TEMPORARY_INTERRUPTION` · `SUPPLY_RESTORED` · `MAINTENANCE_START` /
`_END` · `STATION_CLOSED` / `_REOPENED`.

Operators cannot change a station's name, address or coordinates.

## Admin APIs

All require role `ADMIN`. Unauthenticated → `401`; wrong role → `403`.

```
GET    /admin/users                             ?page&limit&role
PATCH  /admin/users/:userId/role                { role }
PATCH  /admin/users/:userId/active              { active }

GET    /admin/stations                          ?page&limit&includeInactive&search
POST   /admin/stations                          { name, address, latitude, longitude, ... }
PATCH  /admin/stations/:stationId
PATCH  /admin/stations/:stationId/active        { active, reason }      ← reason required
POST   /admin/stations/:stationId/override      { availability?, queueMin?,
                                                  pressureValue?, reason }  ← reason required

GET    /admin/stations/:stationId/operators
POST   /admin/stations/:stationId/operators     { userId, role }
DELETE /admin/stations/:stationId/operators/:userId

GET    /admin/reports/suspicious                ?page&limit&sinceHours
GET    /admin/stats/reports                     ?sinceHours
GET    /admin/stats/notifications               ?sinceHours
GET    /admin/settings                          (effective platform config)
GET    /admin/audit-logs                        ?page&limit&action&entityType
```

Stations are **enabled/disabled, never deleted** — deleting would orphan
historical reports. Manual overrides record admin identity, reason and timestamp,
and are written as `ADMIN`-sourced reports rather than rewriting history.
A user must hold `STATION_OPERATOR` before being assigned to a station.

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | Zod validation failed; see `details[]` |
| `BAD_REQUEST` | 400 | Semantically invalid request |
| `UNAUTHORIZED` | 401 | Missing/invalid/expired token → refresh and retry once |
| `FORBIDDEN` | 403 | Wrong role, or operator not assigned to this station |
| `NOT_FOUND` | 404 | Missing, or not visible to you |
| `CONFLICT` | 409 | Already exists (duplicate email, saved station) |
| `DUPLICATE_REPORT` | 409 | Identical report already submitted recently |
| `RATE_LIMITED` | 429 | IP rate limit |
| `REPORT_COOLDOWN` | 429 | Per-user report cooldown; see `details[].retryAfterSeconds` |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 100 kb |
| `INTERNAL_ERROR` | 500 | Unexpected; quote the `x-request-id` |
| `SERVICE_UNAVAILABLE` | 503 | Database unreachable |

Stack traces appear only outside production.

## Environment variables

```bash
PORT=4000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/qless

# Comma-separated allowed browser origins. Originless (native) requests pass.
FRONTEND_URL=http://localhost:5173

# Must differ from each other; startup refuses placeholders in production.
JWT_SECRET=<48+ random bytes>
JWT_REFRESH_SECRET=<different 48+ random bytes>
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=30
BCRYPT_ROUNDS=12

# Web Push. Generate: npx web-push generate-vapid-keys
# Without these, rules still evaluate; events are marked SUPPRESSED.
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=support@qless.example

# Geofence for report/visit verification, in metres.
LOCATION_VERIFICATION_RADIUS_M=200

LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
JSON_BODY_LIMIT=100kb
```

Required: `DATABASE_URL`, `FRONTEND_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`.
All are validated at startup; the process exits with a readable message if any
is missing or malformed.

## Local setup

```bash
cp .env.example .env
npm install
# MongoDB must be running (mongod --dbpath <path>)
npm run seed          # 10 stations, 1 admin, 3 operators, 9 users
npm run dev
```

Indexes (including the 2dsphere used for nearest-first discovery) are declared
on the Mongoose schemas and created automatically on connect.

Seeded accounts share the password **`QLessDev#2026`**:
`admin@qless.test`, `operator.navrangpura@qless.test`, `user1@qless.test` …
