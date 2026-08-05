import { SEED_SAVED } from '@/mocks';
import { delay, readJSON, writeJSON } from '@/lib/storage';
import type { SavedLabel, SavedStation } from '@/types';

const KEY = 'qless.saved';

function load(): SavedStation[] {
  return readJSON<SavedStation[]>(KEY, SEED_SAVED);
}
function save(items: SavedStation[]): void {
  writeJSON(KEY, items);
}

export const SavedStationService = {
  async list(): Promise<SavedStation[]> {
    return delay(load(), 300);
  },

  listSync(): SavedStation[] {
    return load();
  },

  isSaved(stationId: string): boolean {
    return load().some((s) => s.stationId === stationId);
  },

  async toggle(stationId: string): Promise<boolean> {
    const items = load();
    const exists = items.some((s) => s.stationId === stationId);
    if (exists) {
      save(items.filter((s) => s.stationId !== stationId));
      return delay(false, 150);
    }
    save([
      { stationId, label: 'FAVORITE', savedAt: new Date().toISOString() },
      ...items,
    ]);
    return delay(true, 150);
  },

  async setLabel(stationId: string, label: SavedLabel): Promise<void> {
    save(load().map((s) => (s.stationId === stationId ? { ...s, label } : s)));
    return delay(undefined, 150);
  },

  async remove(stationId: string): Promise<void> {
    save(load().filter((s) => s.stationId !== stationId));
    return delay(undefined, 150);
  },
};
