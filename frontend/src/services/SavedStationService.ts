import { apiRequest } from '@/lib/api/client';
import { readJSON, writeJSON } from '@/lib/storage';
import type { SavedLabel, SavedStation } from '@/types';

// SavedStationService — backed by the API, with a local mirror.
//
// The mirror exists because the UI calls `isSaved`/`listSync` synchronously
// while rendering (e.g. to fill a bookmark icon). It is refreshed on every
// successful API call and is never treated as the source of truth.

const KEY = 'qless.saved';

function readMirror(): SavedStation[] {
  return readJSON<SavedStation[]>(KEY, []);
}

function writeMirror(items: SavedStation[]): void {
  writeJSON(KEY, items);
}

interface ApiSavedStation {
  id: string;
  label: string | null;
  createdAt: string;
  station: { id: string };
}

function mapSaved(row: ApiSavedStation): SavedStation {
  const label = (row.label ?? 'FAVORITE').toUpperCase();
  const valid: SavedLabel[] = ['HOME', 'OFFICE', 'FAVORITE', 'NONE'];

  return {
    stationId: row.station.id,
    label: (valid.includes(label as SavedLabel) ? label : 'FAVORITE') as SavedLabel,
    savedAt: row.createdAt,
  };
}

export const SavedStationService = {
  async list(): Promise<SavedStation[]> {
    try {
      const result = await apiRequest<{ stations: ApiSavedStation[] }>('/stations/saved');
      const items = result.stations.map(mapSaved);
      writeMirror(items);
      return items;
    } catch {
      // Guests and offline clients still see their local list.
      return readMirror();
    }
  },

  listSync(): SavedStation[] {
    return readMirror();
  },

  isSaved(stationId: string): boolean {
    return readMirror().some((s) => s.stationId === stationId);
  },

  async toggle(stationId: string): Promise<boolean> {
    const saved = this.isSaved(stationId);

    if (saved) {
      await apiRequest<unknown>(`/stations/${stationId}/save`, { method: 'DELETE' });
      writeMirror(readMirror().filter((s) => s.stationId !== stationId));
      return false;
    }

    await apiRequest<unknown>(`/stations/${stationId}/save`, {
      method: 'POST',
      body: {},
    });
    writeMirror([
      { stationId, label: 'FAVORITE', savedAt: new Date().toISOString() },
      ...readMirror().filter((s) => s.stationId !== stationId),
    ]);
    return true;
  },

  async setLabel(stationId: string, label: SavedLabel): Promise<void> {
    await apiRequest<unknown>(`/stations/${stationId}/save`, {
      method: 'POST',
      body: { label },
    });
    writeMirror(
      readMirror().map((s) => (s.stationId === stationId ? { ...s, label } : s)),
    );
  },

  async remove(stationId: string): Promise<void> {
    await apiRequest<unknown>(`/stations/${stationId}/save`, { method: 'DELETE' });
    writeMirror(readMirror().filter((s) => s.stationId !== stationId));
  },

  /** Clears the mirror on sign-out so the next user starts clean. */
  clearMirror(): void {
    writeMirror([]);
  },
};
