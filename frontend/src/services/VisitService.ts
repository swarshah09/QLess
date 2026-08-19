import { apiRequest, ApiError } from '@/lib/api/client';
import { hasTokens } from '@/lib/api/tokens';
import type { Coordinates } from '@/types';

// VisitService — the "I'm Here" lifecycle.
//
// Proximity is verified by the backend from the coordinates we send; there is
// no client-side "am I close enough?" decision to be made or faked.

export type VisitOutcome =
  | 'UNKNOWN'
  | 'REFUELLED'
  | 'ABANDONED_QUEUE'
  | 'STATION_UNAVAILABLE';

export interface Visit {
  id: string;
  stationId: string;
  arrivedAt: string | null;
  joinedQueueAt: string | null;
  completedAt: string | null;
  outcome: VisitOutcome;
}

export type CheckInResult =
  | { status: 'checked-in'; visit: Visit; distanceM: number }
  | { status: 'too-far'; message: string }
  | { status: 'no-location' }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string };

export const VisitService = {
  /** Records arrival. The backend rejects a check-in outside the geofence. */
  async checkIn(stationId: string, coords: Coordinates | null): Promise<CheckInResult> {
    if (!hasTokens()) return { status: 'unauthenticated' };
    if (!coords) return { status: 'no-location' };

    try {
      const result = await apiRequest<{
        visit: Visit;
        locationVerified: boolean;
        distanceToStationM: number;
      }>(`/stations/${stationId}/visits`, {
        method: 'POST',
        body: { latitude: coords.lat, longitude: coords.lng },
      });

      return {
        status: 'checked-in',
        visit: result.visit,
        distanceM: result.distanceToStationM,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.isAuthError) return { status: 'unauthenticated' };
        // 422 from this endpoint means "not actually at the station".
        if (error.status === 422) {
          return { status: 'too-far', message: error.details[0]?.message ?? error.message };
        }
        return { status: 'error', message: error.message };
      }
      return { status: 'error', message: 'Could not check in' };
    }
  },

  async joinQueue(stationId: string, visitId: string): Promise<Visit | null> {
    try {
      const result = await apiRequest<{ visit: Visit }>(
        `/stations/${stationId}/visits/${visitId}/join-queue`,
        { method: 'PATCH' },
      );
      return result.visit;
    } catch {
      return null;
    }
  },

  /**
   * Ends a visit.
   *
   * The outcome must be stated: leaving the station is NOT evidence of a
   * successful refuel, and the backend keeps it UNKNOWN unless told otherwise.
   */
  async complete(
    stationId: string,
    visitId: string,
    outcome: VisitOutcome,
  ): Promise<Visit | null> {
    try {
      const result = await apiRequest<{ visit: Visit }>(
        `/stations/${stationId}/visits/${visitId}/complete`,
        { method: 'PATCH', body: { outcome } },
      );
      return result.visit;
    } catch {
      return null;
    }
  },

  async history(): Promise<Visit[]> {
    if (!hasTokens()) return [];
    try {
      const result = await apiRequest<{ items: Visit[] }>('/stations/visits', {
        query: { limit: 20 },
      });
      return result.items;
    } catch {
      return [];
    }
  },
};
