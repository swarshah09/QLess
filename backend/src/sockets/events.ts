import type { StationStatus } from '@prisma/client';

/**
 * Realtime event contract.
 *
 * These names and payload shapes are consumed by the web PWA and, later, the
 * native clients — treat them as a public API surface, not internal detail.
 */

export const SOCKET_EVENTS = {
  /** Client → server: start receiving updates for a station. */
  SUBSCRIBE_STATION: 'station:subscribe',
  /** Client → server: stop receiving updates for a station. */
  UNSUBSCRIBE_STATION: 'station:unsubscribe',
  /** Server → client: a station's computed status changed. */
  STATION_UPDATED: 'station:updated',
  /** Server → client: acknowledgement of a subscribe/unsubscribe. */
  SUBSCRIPTION_ACK: 'station:subscription',
  ERROR: 'error',
} as const;

/**
 * Payload for `station:updated`.
 *
 * Mirrors the REST status shape so a client can apply a socket update to state
 * it fetched over HTTP without a second mapping layer.
 */
export interface StationUpdatedPayload {
  stationId: string;
  availability: string;
  queueMin: number | null;
  queueMax: number | null;
  waitMin: number | null;
  waitMax: number | null;
  pressureValue: number | null;
  pressureUnit: string;
  pressureStatus: string;
  activeDispensers: number | null;
  confidence: number;
  freshness: string;
  computedAt: string;
}

/** One room per station, so a client only receives what it asked for. */
export function stationRoom(stationId: string): string {
  return `station:${stationId}`;
}

export function toStationUpdatedPayload(status: StationStatus): StationUpdatedPayload {
  return {
    stationId: status.stationId,
    availability: status.availability,
    // Null stays null: an unknown queue is never emitted as zero.
    queueMin: status.queueMin,
    queueMax: status.queueMax,
    waitMin: status.waitMin,
    waitMax: status.waitMax,
    pressureValue: status.pressureValue,
    pressureUnit: status.pressureUnit,
    pressureStatus: status.pressureStatus,
    activeDispensers: status.activeDispensers,
    confidence: status.confidence,
    freshness: status.freshness,
    computedAt: status.computedAt.toISOString(),
  };
}
