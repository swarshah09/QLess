import type {
  Availability,
  Confidence,
  NotificationConditions,
  NotificationRule,
  QueueRange,
  Station,
} from '@/types';

// Translation between backend DTOs and the frontend's domain types.
// Isolated here so the UI keeps its existing shapes unchanged.

export interface ApiStationStatus {
  availability: Availability;
  queue: { min: number | null; max: number | null; bucket: string; label: string };
  wait: { min: number | null; max: number | null };
  pressure: {
    value: number | null;
    unit: string;
    status: string;
    thresholds: { low: number | null; normal: number | null };
  };
  activeDispensers: number | null;
  confidence: number;
  freshness: string;
  computedAt: string | null;
  lastOperatorUpdateAt?: string | null;
  lastUserUpdateAt?: string | null;
}

export interface ApiStation {
  id: string;
  name: string;
  address: string;
  city?: string | null;
  latitude: number;
  longitude: number;
  active: boolean;
  numberOfDispensers: number;
  distanceKm: number | null;
  distanceM: number | null;
  saved: boolean;
  status: ApiStationStatus;
}

/**
 * Backend queue bounds → the frontend's bucket label.
 *
 * Null bounds mean UNKNOWN and must never become "0-3" — the whole point of
 * the backend's null contract is that no data is not an empty forecourt.
 */
export function toQueueRange(min: number | null, max: number | null): QueueRange {
  if (min === null && max === null) return 'UNKNOWN';

  const upper = max ?? min!;
  if (upper <= 3) return '0-3';
  if (upper <= 7) return '4-7';
  if (upper <= 15) return '8-15';
  if (upper <= 25) return '16-25';
  return '25+';
}

/** Frontend bucket → the label string the report endpoint expects. */
export function toQueueRangeLabel(q: QueueRange): string {
  return q; // The backend accepts exactly these labels, including "UNKNOWN".
}

/**
 * Backend confidence (0-100) + freshness band → the frontend's four-level
 * Confidence enum. Freshness dominates: stale data is never "high confidence"
 * however good its sources were.
 */
export function toConfidence(score: number, freshness: string): Confidence {
  if (freshness === 'STALE' || freshness === 'EXPIRED' || freshness === 'UNKNOWN') {
    return 'STALE';
  }
  if (score >= 75) return 'HIGH';
  if (score >= 45) return 'MEDIUM';
  return 'LOW';
}

/**
 * The UI derives freshness from `lastUpdated`, so the timestamp handed to it
 * must be the age of the underlying reports — not when the projection was
 * recomputed, which would make everything look permanently live.
 */
function lastUpdatedFrom(status: ApiStationStatus): string {
  const candidates = [status.lastOperatorUpdateAt, status.lastUserUpdateAt]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => new Date(value).getTime());

  if (candidates.length > 0) {
    return new Date(Math.max(...candidates)).toISOString();
  }

  // No inputs at all. Anchor far in the past so the UI shows "Stale" rather
  // than implying freshness the data does not have.
  if (!status.computedAt) return new Date(0).toISOString();
  return status.computedAt;
}

export function mapStation(api: ApiStation): Station {
  const { status } = api;

  return {
    id: api.id,
    name: api.name,
    address: api.address,
    lat: api.latitude,
    lng: api.longitude,
    distanceKm: api.distanceKm,
    availability: status.availability,
    queue: toQueueRange(status.queue.min, status.queue.max),
    // Null bounds mean unknown; the UI renders `null` as "—", never as 0.
    wait:
      status.wait.min === null && status.wait.max === null
        ? null
        : {
            minMinutes: status.wait.min ?? status.wait.max ?? 0,
            maxMinutes: status.wait.max ?? status.wait.min ?? 0,
          },
    pressure: {
      value: status.pressure.value,
      unit: status.pressure.unit === 'BAR' ? 'bar' : status.pressure.unit.toLowerCase(),
      status: status.pressure.status,
    },
    lastUpdated: lastUpdatedFrom(status),
    confidence: toConfidence(status.confidence, status.freshness),
    activeDispensers: status.activeDispensers,
    totalDispensers: api.numberOfDispensers,
  };
}

// ---- Notification rules ----------------------------------------------------

export interface ApiNotificationRule {
  id: string;
  stationId: string;
  requiredAvailability: Availability[];
  maxQueue: number | null;
  maxWaitMinutes: number | null;
  minPressure: number | null;
  enabled: boolean;
  currentConditionState: string;
  lastTriggeredAt: string | null;
  cooldownMinutes: number;
  createdAt: string;
  station?: { id: string; name: string } | null;
}

export function mapRule(api: ApiNotificationRule, fallbackName = 'Station'): NotificationRule {
  return {
    id: api.id,
    stationId: api.stationId,
    stationName: api.station?.name ?? fallbackName,
    conditions: {
      onlyWhenAvailable: api.requiredAvailability.includes('AVAILABLE'),
      maxQueue: api.maxQueue ?? undefined,
      maxWaitMinutes: api.maxWaitMinutes ?? undefined,
      minPressure: api.minPressure ?? undefined,
    },
    // A disabled rule is PAUSED; an enabled one that has fired shows TRIGGERED
    // so the alerts list can distinguish "watching" from "already told you".
    status: !api.enabled
      ? 'PAUSED'
      : api.lastTriggeredAt
        ? 'TRIGGERED'
        : 'ACTIVE',
    createdAt: api.createdAt,
    triggeredAt: api.lastTriggeredAt,
  };
}

/** Frontend conditions → the backend rule payload. */
export function toRulePayload(conditions: NotificationConditions) {
  return {
    requiredAvailability: conditions.onlyWhenAvailable
      ? (['AVAILABLE'] as Availability[])
      : ([] as Availability[]),
    maxQueue: conditions.maxQueue ?? null,
    maxWaitMinutes: conditions.maxWaitMinutes ?? null,
    minPressure: conditions.minPressure ?? null,
  };
}
