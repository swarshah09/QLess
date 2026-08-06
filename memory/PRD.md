# QLess — CNG Queue, Availability, Pressure & Notification Platform (Frontend)

**Tagline:** Fuel Up. Wait Less.
**Stack:** Next.js 14 (App Router) · TypeScript · SCSS (no Tailwind) · mobile-first · PWA-ready
**Phase:** Frontend ONLY. All data is mocked behind a service abstraction (no backend).

## Problem
Help CNG drivers answer "Where should I fill CNG right now?" — availability, queue,
wait, pressure, freshness, confidence, distance, and "notify me when it improves".
Priorities: Notifications > Speed > Simplicity > Trust > Mobile UX.

## Architecture
- `src/app` — routes: `/` (animated landing), `/login`, `/app/{home,map,alerts,saved,profile}`, `/app/station/[id]`
- `src/components/ui` — Button, Card, Chip, StatusBadge, ConfidenceBadge, FreshnessIndicator, SegmentedControl, Toggle, Stepper, Slider(CSS), BottomSheet, Modal, Skeleton, EmptyState, ErrorState, Spinner, Logo
- `src/components/layout` — DeviceFrame (centers app in ~440px mobile frame on desktop), AppHeader, BottomNav, ServiceWorker
- `src/features` — stations, notifications (NotifyMeSheet = key feature, AlertCard), navigation, reports (ReportSheet, ImHereSheet), maps (MockMap, StationPreview), location (LocationBanner)
- `src/services` — Auth, Station, Notification, Location, Report, Navigation, SavedStation (mock + localStorage). **UI never touches mocks directly.**
- `src/hooks` — Theme, Toast, Auth, Location, Sheets (global Notify + Navigation sheets) contexts
- `src/lib` — status.ts (freshness/recommendation/marker derivations), storage.ts
- `src/mocks` — 7 stations covering every state; seed saved + alerts
- `src/types` — User, Station, StationStatus, QueueRange, PressureStatus, NotificationRule, Report, SavedStation, etc.
- PWA: `public/manifest.webmanifest`, `public/sw.js` (offline shell + push abstraction, **prod-only registration**), icons, `offline.html`

## Design system
Emerald `#059669` primary, light/dark themes via `[data-theme]`. Manrope (headings) + Inter (body).
Minimal shadows, 1px borders, rounded 12–16px. Freshness LIVE/RECENT/AGING/STALE, confidence HIGH/MEDIUM/LOW/STALE. Status never color-only (label + dot/icon). Tokens in `src/styles/globals.scss`.

## Implemented (2026-06)
- Phases 1–15, 18–20 (customer app + data-freshness + empty/error states + PWA)
- Animated premium landing (radar/live-ticking hero)
- **User-reported live status** ("Update Status" 2-step sheet on Station Details: queue one-tap → availability → optional pressure; mock location-verified/unverified badge; `ReportService.submitStationReport()`). Reports never shown as authoritative — a "Community update • Just now" chip appears without changing HIGH/MED confidence.
- **Nearest-first discovery**: `lib/geo.calculateDistance` (Haversine, single source), `StationService.getNearbyStations({origin,filters,sort})` sorts nearest→farthest by default and computes live distances from the user's coords. "Recommended" badge flags a substantially-better station while keeping nearest-first order.
- **Sort & Filter** bottom sheet (Nearest/Wait/Queue/Updated; available-only, queue, wait, pressure, distance filters).
- Location-denied resilience ("Turn on location…" → Enable / Choose Location; manual origin re-sorts).
- Map + previews use the same StationService data/order; preview adds "View station".
- Notify-Me alert builder, station recommendation, stale handling, navigation/report/I'm-here sheets, Alerts CRUD, Saved, Profile, Mock Map
- ESC-to-close + backdrop-close on all sheets/modals

## Service contract (mock now, backend-swappable)
- `StationService.getNearbyStations({origin,filters,sort})`, `getStation(id,origin?)`, `getBetterOptions`
- `ReportService.submitStationReport(report)`, `getLatestReport(id)`
- `LocationService.getCurrentLocation()`, `calculateDistance()` (delegates to `lib/geo`)
- Backend can later add identity, GPS verification, reputation, confidence weighting, spam prevention without UI rewrites.

## Verified
- typecheck ✓, lint ✓, production build ✓
- Rendered end-to-end in headless Chromium (7 station cards, all flows) at 320/390/1440px, no horizontal overflow, no console errors
- NOTE: the shared screenshot tool's browser had a stale service worker cached from an earlier build; real/clean browsers render correctly. SW now registers in production only.

## Backlog / Next
- P1: Operator dashboard (Phase 16), Admin UI (Phase 17) — responsive, not yet built
- P1: Alerts "Edit" reuse verification; historical-estimate for more stale stations
- P2: Real map provider adapter, real backend wiring (swap mock services), push subscription
- P2: Saved-station labels editor (Home/Office/Favorite)
