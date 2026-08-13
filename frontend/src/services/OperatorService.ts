import { apiRequest } from '@/lib/api/client';
import { toQueueRangeLabel } from '@/lib/api/mappers';
import type { Availability, QueueRange } from '@/types';

// OperatorService — station updates for operators.
//
// The backend enforces that an operator may only act on stations assigned to
// them; anything else is a 403. Nothing is gated client-side.

export type SupplyEventType =
  | 'SUPPLY_ARRIVED'
  | 'LOW_SUPPLY'
  | 'CNG_FINISHED'
  | 'TEMPORARY_INTERRUPTION'
  | 'SUPPLY_RESTORED'
  | 'MAINTENANCE_START'
  | 'MAINTENANCE_END'
  | 'STATION_CLOSED'
  | 'STATION_REOPENED';

export interface OperatorAssignment {
  id: string;
  role: string;
  station: { id: string; name: string; address: string; active: boolean };
}

export const OperatorService = {
  /** Stations the signed-in operator may update. */
  async listAssignedStations(): Promise<OperatorAssignment[]> {
    const result = await apiRequest<{ assignments: OperatorAssignment[] }>(
      '/stations/mine',
    );
    return result.assignments;
  },

  /**
   * Reports current state as an operator. This creates history and triggers a
   * status recomputation — it is not a direct write to the station's status.
   */
  async updateStatus(
    stationId: string,
    input: {
      queueRange?: QueueRange;
      availability?: Availability;
      pressureValue?: number;
      activeDispensers?: number;
      note?: string;
    },
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (input.queueRange) body.queueRange = toQueueRangeLabel(input.queueRange);
    if (input.availability && input.availability !== 'UNKNOWN') {
      body.availability = input.availability;
    }
    if (input.pressureValue != null) body.pressureValue = input.pressureValue;
    if (input.activeDispensers != null) body.activeDispensers = input.activeDispensers;
    if (input.note) body.note = input.note;

    await apiRequest<unknown>(`/stations/${stationId}/operator-update`, {
      method: 'POST',
      body,
    });
  },

  async recordSupplyEvent(
    stationId: string,
    type: SupplyEventType,
    note?: string,
  ): Promise<void> {
    await apiRequest<unknown>(`/stations/${stationId}/supply-events`, {
      method: 'POST',
      body: { type, ...(note ? { note } : {}) },
    });
  },

  async listSupplyEvents(stationId: string): Promise<
    Array<{ id: string; type: string; note: string | null; startedAt: string; endedAt: string | null }>
  > {
    const result = await apiRequest<{
      items: Array<{
        id: string;
        type: string;
        note: string | null;
        startedAt: string;
        endedAt: string | null;
      }>;
    }>(`/stations/${stationId}/supply-events`, { auth: false, query: { limit: 20 } });
    return result.items;
  },

  async closeSupplyEvent(stationId: string, eventId: string): Promise<void> {
    await apiRequest<unknown>(
      `/stations/${stationId}/supply-events/${eventId}/close`,
      { method: 'PATCH' },
    );
  },

  /** Operational configuration an operator may change on an assigned station. */
  async updateStationConfig(
    stationId: string,
    input: {
      active?: boolean;
      numberOfDispensers?: number;
      pressureThresholdLow?: number | null;
      pressureThresholdNormal?: number | null;
    },
  ): Promise<void> {
    await apiRequest<unknown>(`/stations/${stationId}`, {
      method: 'PATCH',
      body: input,
    });
  },
};
