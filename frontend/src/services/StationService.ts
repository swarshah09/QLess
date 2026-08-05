import { MOCK_STATIONS } from '@/mocks';
import { delay } from '@/lib/storage';
import { queueUpperBound } from '@/lib/status';
import type { Station } from '@/types';

// StationService — UI never touches mock data directly; it always goes
// through this abstraction so a real backend can be dropped in later.
export const StationService = {
  async getNearbyStations(): Promise<Station[]> {
    const sorted = [...MOCK_STATIONS].sort(
      (a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999),
    );
    return delay(sorted, 500);
  },

  async getStation(id: string): Promise<Station | null> {
    const found = MOCK_STATIONS.find((s) => s.id === id) ?? null;
    return delay(found, 350);
  },

  async searchStations(query: string): Promise<Station[]> {
    const q = query.trim().toLowerCase();
    const results = q
      ? MOCK_STATIONS.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.address.toLowerCase().includes(q),
        )
      : MOCK_STATIONS;
    return delay(results, 300);
  },

  async getStationsByIds(ids: string[]): Promise<Station[]> {
    const results = MOCK_STATIONS.filter((s) => ids.includes(s.id));
    return delay(results, 300);
  },

  // "Better options nearby" — cheaper/shorter alternatives than the current one.
  async getBetterOptions(id: string): Promise<Station[]> {
    const base = MOCK_STATIONS.find((s) => s.id === id);
    if (!base) return delay([], 200);
    const baseQ = queueUpperBound(base.queue) ?? 99;
    const options = MOCK_STATIONS.filter((s) => {
      if (s.id === id) return false;
      if (s.availability !== 'AVAILABLE') return false;
      const q = queueUpperBound(s.queue) ?? 99;
      return q < baseQ;
    }).slice(0, 2);
    return delay(options, 300);
  },
};
