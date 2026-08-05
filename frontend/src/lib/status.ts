import type {
  Availability,
  Confidence,
  Freshness,
  QueueRange,
  Station,
  WaitEstimate,
} from '@/types';

// ---- Time helpers ----------------------------------------------------------

export function minutesSince(iso: string): number {
  const then = new Date(iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.round((now - then) / 60000));
}

export function relativeTime(iso: string): string {
  const mins = minutesSince(iso);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs === 1) return '1 hr ago';
  if (hrs < 24) return `${hrs} hrs ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// ---- Freshness (derived, never assumed) ------------------------------------

export function getFreshness(iso: string): Freshness {
  const mins = minutesSince(iso);
  if (mins <= 5) return 'LIVE';
  if (mins <= 15) return 'RECENT';
  if (mins <= 30) return 'AGING';
  return 'STALE';
}

export function isStale(iso: string): boolean {
  return getFreshness(iso) === 'STALE';
}

// ---- Availability labels ---------------------------------------------------

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  AVAILABLE: 'CNG Available',
  LOW_SUPPLY: 'Low Supply',
  TEMPORARILY_INTERRUPTED: 'Interrupted',
  UNAVAILABLE: 'Unavailable',
  UNKNOWN: 'Unknown',
};

export const AVAILABILITY_TONE: Record<Availability, string> = {
  AVAILABLE: 'available',
  LOW_SUPPLY: 'low_supply',
  TEMPORARILY_INTERRUPTED: 'interrupted',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
};

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  LIVE: 'Live',
  RECENT: 'Recent',
  AGING: 'Aging',
  STALE: 'Stale',
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  HIGH: 'High confidence',
  MEDIUM: 'Medium confidence',
  LOW: 'Low confidence',
  STALE: 'Stale data',
};

// ---- Queue helpers ---------------------------------------------------------

export function queueLabel(q: QueueRange): string {
  if (q === 'UNKNOWN') return 'Queue unknown';
  if (q === '25+') return '25+ vehicles';
  return `${q} vehicles`;
}

// Approximate upper bound of a queue range — used to evaluate alert rules.
export function queueUpperBound(q: QueueRange): number | null {
  switch (q) {
    case '0-3':
      return 3;
    case '4-7':
      return 7;
    case '8-15':
      return 15;
    case '16-25':
      return 25;
    case '25+':
      return 40;
    default:
      return null;
  }
}

export function queueLowerBound(q: QueueRange): number | null {
  switch (q) {
    case '0-3':
      return 0;
    case '4-7':
      return 4;
    case '8-15':
      return 8;
    case '16-25':
      return 16;
    case '25+':
      return 25;
    default:
      return null;
  }
}

export function formatWait(wait: WaitEstimate | null): string {
  if (!wait) return '—';
  if (wait.minMinutes === wait.maxMinutes) return `~${wait.minMinutes} min`;
  return `~${wait.minMinutes}–${wait.maxMinutes} min`;
}

export function formatDistance(km: number | null): string {
  if (km === null) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export function formatPressure(value: number | null, unit: string): string {
  if (value === null) return `— ${unit}`;
  return `${value} ${unit}`;
}

// ---- Recommendation (derived from live signals) ----------------------------

export type Recommendation = {
  tone: 'good' | 'busy' | 'avoid' | 'unknown';
  title: string;
  detail: string;
};

export function getRecommendation(station: Station): Recommendation {
  const stale = isStale(station.lastUpdated);
  if (stale || station.availability === 'UNKNOWN' || station.queue === 'UNKNOWN') {
    return {
      tone: 'unknown',
      title: 'Not enough live info',
      detail: 'Live status is unavailable right now. Set an alert to get notified.',
    };
  }
  if (
    station.availability === 'UNAVAILABLE' ||
    station.availability === 'TEMPORARILY_INTERRUPTED'
  ) {
    return {
      tone: 'avoid',
      title: 'Not available right now',
      detail: 'CNG is not being dispensed here at the moment.',
    };
  }
  const upper = queueUpperBound(station.queue) ?? 99;
  if (station.availability === 'AVAILABLE' && upper <= 7) {
    return {
      tone: 'good',
      title: 'Good time to visit',
      detail: 'CNG is available and the queue is short.',
    };
  }
  return {
    tone: 'busy',
    title: 'Busy right now',
    detail: 'CNG is available but expect a longer wait.',
  };
}

// ---- Map marker tone (never color-only in UI) ------------------------------

export type MarkerTone = 'good' | 'moderate' | 'busy' | 'unavailable' | 'unknown';

export function getMarkerTone(station: Station): MarkerTone {
  if (isStale(station.lastUpdated) || station.availability === 'UNKNOWN') return 'unknown';
  if (
    station.availability === 'UNAVAILABLE' ||
    station.availability === 'TEMPORARILY_INTERRUPTED'
  )
    return 'unavailable';
  const upper = queueUpperBound(station.queue) ?? 99;
  if (station.availability === 'AVAILABLE' && upper <= 7) return 'good';
  if (upper <= 15) return 'moderate';
  return 'busy';
}
