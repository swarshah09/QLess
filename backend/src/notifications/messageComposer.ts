import { Availability, type StationStatus } from '@prisma/client';
import { NOTIFICATIONS } from '../config/constants';

/**
 * Builds the user-facing notification text.
 *
 * Phrasing follows the same honesty rules as the rest of the platform: ranges
 * are described as approximations, and anything unknown is simply left out
 * rather than filled with a guess.
 */

export interface ComposedMessage {
  title: string;
  body: string;
  payload: {
    url: string;
    stationId: string;
    tag: string;
    availability: Availability;
    queue: { min: number | null; max: number | null };
    wait: { min: number | null; max: number | null };
    confidence: number;
  };
}

export function deepLinkFor(stationId: string): string {
  return NOTIFICATIONS.deepLinkPattern.replace('{stationId}', stationId);
}

/** Plain-language description of a queue range. */
function describeQueue(status: StationStatus): string | null {
  if (status.queueMin === null && status.queueMax === null) return null;

  const max = status.queueMax ?? status.queueMin!;
  if (max <= 3) return 'a short queue';
  if (max <= 7) return 'a moderate queue';
  if (max <= 15) return 'a busy queue';
  return 'a long queue';
}

/**
 * Wait phrasing. Uses the range midpoint with a "~" so the number reads as the
 * estimate it is, rather than implying the precision of a countdown.
 */
function describeWait(status: StationStatus): string | null {
  if (status.waitMin === null && status.waitMax === null) return null;

  const min = status.waitMin ?? status.waitMax!;
  const max = status.waitMax ?? status.waitMin!;
  const midpoint = Math.round((min + max) / 2);

  return `~${midpoint} min wait`;
}

function describeAvailability(availability: Availability): string | null {
  switch (availability) {
    case Availability.AVAILABLE:
      return 'CNG is available';
    case Availability.LOW_SUPPLY:
      return 'CNG is running low';
    case Availability.TEMPORARILY_INTERRUPTED:
      return 'supply is temporarily interrupted';
    case Availability.UNAVAILABLE:
      return 'CNG is unavailable';
    default:
      return null;
  }
}

export function composeMessage(
  station: { id: string; name: string },
  status: StationStatus,
): ComposedMessage {
  // Only the parts we actually know are mentioned.
  const fragments = [
    describeQueue(status),
    describeWait(status),
    describeAvailability(status.availability),
  ].filter((fragment): fragment is string => fragment !== null);

  const body =
    fragments.length > 0
      ? `${station.name} now has ${joinNaturally(fragments)}.`
      : `${station.name} now matches your alert.`;

  return {
    title: 'Good time to refuel ⛽',
    body: body.slice(0, 500),
    payload: {
      url: deepLinkFor(station.id),
      stationId: station.id,
      // Collapses older notifications for the same station on the device, so a
      // user returning to their phone sees one current alert, not a pile.
      tag: `station-${station.id}`,
      availability: status.availability,
      queue: { min: status.queueMin, max: status.queueMax },
      wait: { min: status.waitMin, max: status.waitMax },
      confidence: status.confidence,
    },
  };
}

/** "a, b and c" */
function joinNaturally(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
