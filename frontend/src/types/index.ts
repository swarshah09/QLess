// ============================================================
// QLess — Core domain types (shared across UI + services)
// ============================================================

export type Availability =
  | 'AVAILABLE'
  | 'LOW_SUPPLY'
  | 'TEMPORARILY_INTERRUPTED'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export type QueueRange = '0-3' | '4-7' | '8-15' | '16-25' | '25+' | 'UNKNOWN';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'STALE';

// Data freshness is derived from the age of the last update.
export type Freshness = 'LIVE' | 'RECENT' | 'AGING' | 'STALE';

// Pressure status is provided by the backend based on configured
// thresholds. The frontend never assumes safety/quality — it only
// renders whatever status string it receives.
export interface PressureStatus {
  value: number | null;
  unit: string; // e.g. "bar"
  status: string; // backend-provided, e.g. "NORMAL" | "LOW" | "HIGH" | "UNKNOWN"
}

export interface WaitEstimate {
  minMinutes: number;
  maxMinutes: number;
}

export interface Station {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm: number | null;
  availability: Availability;
  queue: QueueRange;
  wait: WaitEstimate | null;
  pressure: PressureStatus;
  lastUpdated: string; // ISO timestamp
  confidence: Confidence;
  activeDispensers: number | null;
  totalDispensers: number | null;
  // Optional historical hint used only when live data is stale.
  historicalHint?: string | null;

  /**
   * False when no QLess report has ever backed this station — typically one
   * just discovered from the map provider. The UI must show "Live information
   * unavailable" rather than rendering zeros for queue/wait/pressure.
   */
  hasLiveData: boolean;
  /** Where the record came from; PLACES means provider-discovered. */
  source: 'SEED' | 'MANUAL' | 'PLACES';
  /** Provider deep link for navigation, when known. */
  googleMapsUri: string | null;
}

// Lightweight derived status snapshot used by cards/badges.
export interface StationStatus {
  availability: Availability;
  queue: QueueRange;
  freshness: Freshness;
  confidence: Confidence;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

export type AlertStatus = 'ACTIVE' | 'PAUSED' | 'TRIGGERED';

export interface NotificationConditions {
  onlyWhenAvailable: boolean;
  maxQueue?: number; // e.g. 3, 5, 10
  maxWaitMinutes?: number; // e.g. 5, 10, 15
  minPressure?: number; // bar
}

export interface NotificationRule {
  id: string;
  stationId: string;
  stationName: string;
  conditions: NotificationConditions;
  status: AlertStatus;
  createdAt: string;
  triggeredAt?: string | null;
}

export type ReportAvailability = 'YES' | 'NO' | 'NOT_SURE';

export interface Report {
  id: string;
  stationId: string;
  available: ReportAvailability;
  queue: QueueRange;
  pressure?: number | null;
  verifiedNearby: boolean;
  createdAt: string;
}

export type SavedLabel = 'HOME' | 'OFFICE' | 'FAVORITE' | 'NONE';

export interface SavedStation {
  stationId: string;
  label: SavedLabel;
  savedAt: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export type LocationState =
  | { status: 'unknown' }
  | { status: 'granted'; coords: Coordinates; label: string }
  | {
      status: 'manual';
      coords: Coordinates | null;
      label: string;
      /** Extent of the chosen area, outlined on the map. */
      bounds?: PlaceBounds | null;
    }
  | { status: 'denied' }
  // Geolocation was attempted but failed for a reason other than a permission
  // refusal (insecure origin, timeout, no fix). Kept distinct from 'denied' so
  // the UI can tell the user what to actually do about it.
  | { status: 'error'; reason: LocationErrorReason; message: string }
  | { status: 'loading' };

/** Bounding box of a chosen place, in plain degrees. */
export interface PlaceBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type LocationErrorReason =
  | 'insecure-context'
  | 'unsupported'
  | 'timeout'
  | 'unavailable';

export type NavProvider = 'google' | 'apple' | 'waze' | 'default';

// ---- Discovery: sorting & filtering ----------------------------------------
export type SortKey = 'nearest' | 'wait' | 'queue' | 'updated';

export interface StationFilters {
  availableOnly?: boolean;
  maxQueue?: number; // upper bound of cars in queue
  maxWaitMinutes?: number;
  normalPressureOnly?: boolean;
  maxDistanceKm?: number;
}

export interface NearbyQuery {
  origin?: Coordinates;
  filters?: StationFilters;
  sort?: SortKey;
}

// ---- Community reports (kept generic for a future backend) -----------------
// The backend will later add: user identity, GPS verification, reporter
// reputation, confidence weighting and spam prevention.
export interface StationReport {
  id: string;
  stationId: string;
  queueRange: QueueRange;
  availability: Availability;
  pressureValue?: number | null;
  verifiedNearby: boolean;
  reportedAt: string;
  source: 'community';
}
