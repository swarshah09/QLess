import { apiRequest } from '@/lib/api/client';
import { mapStation, type ApiStation } from '@/lib/api/mappers';
import { hasTokens } from '@/lib/api/tokens';
import { readJSON, writeJSON } from '@/lib/storage';
import type { Coordinates, SavedLabel, SavedStation, Station } from '@/types';

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
  sortOrder: number;
  createdAt: string;
  station: ApiStation;
}

/** The list's own order (sortOrder, then newest first), as the backend stores it. */
function bySavedOrder(a: ApiSavedStation, b: ApiSavedStation): number {
  return a.sortOrder - b.sortOrder || Date.parse(b.createdAt) - Date.parse(a.createdAt);
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
    // Saved stations are per-account; a guest keeps a purely local list.
    if (!hasTokens()) return readMirror();

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

  /**
   * An account's saved stations together with their current station data.
   *
   * The endpoint already embeds each station with its live status, so this is
   * the whole screen in one request. Resolves null for a guest, or when the
   * API is unreachable, so the caller can fall back to the local list.
   */
  async listWithStations(
    origin: Coordinates,
  ): Promise<{ saved: SavedStation; station: Station }[] | null> {
    if (!hasTokens()) return null;

    try {
      const result = await apiRequest<{ stations: ApiSavedStation[] }>('/stations/saved', {
        query: { latitude: origin.lat, longitude: origin.lng },
      });
      // Given an origin the endpoint orders nearest-first; the saved list keeps
      // its own order on screen.
      const rows = [...result.stations].sort(bySavedOrder);
      const items = rows.map(mapSaved);
      writeMirror(items);
      return rows.map((row, i) => ({ saved: items[i], station: mapStation(row.station) }));
    } catch {
      return null;
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

    // Guests toggle locally only — the UI stays responsive and the list is
    // adopted once they sign in.
    if (!hasTokens()) {
      if (saved) {
        writeMirror(readMirror().filter((s) => s.stationId !== stationId));
        return false;
      }
      writeMirror([
        { stationId, label: 'FAVORITE', savedAt: new Date().toISOString() },
        ...readMirror(),
      ]);
      return true;
    }

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
