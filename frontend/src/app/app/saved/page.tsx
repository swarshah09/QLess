'use client';

import { useEffect, useState } from 'react';
import { BookmarkX } from 'lucide-react';
import type { Coordinates, SavedStation, Station } from '@/types';
import { SavedStationService } from '@/services/SavedStationService';
import { StationService } from '@/services/StationService';
import { DEFAULT_COORDS } from '@/services/LocationService';
import { StationCard } from '@/features/stations/StationCard';
import { StationCardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSheets } from '@/hooks/SheetsContext';
import { useLocation } from '@/hooks/LocationContext';

type SavedItem = { saved: SavedStation; station: Station };

async function loadSaved(origin: Coordinates): Promise<SavedItem[]> {
  // An account gets everything in one request.
  const withStations = await SavedStationService.listWithStations(origin);
  if (withStations) return withStations;

  // Guests (and an unreachable API) keep the local list, resolved by id.
  const saved = SavedStationService.listSync();
  const stations = await StationService.getStationsByIds(
    saved.map((s) => s.stationId),
    origin,
  );
  return saved
    .map((s) => {
      const station = stations.find((st) => st.id === s.stationId);
      return station ? { saved: s, station } : null;
    })
    .filter(Boolean) as SavedItem[];
}

const LABELS: Record<string, string> = {
  HOME: 'Home',
  OFFICE: 'Office',
  FAVORITE: 'Favorite',
  NONE: '',
};

export default function SavedPage() {
  const { openNotify, openNavigate } = useSheets();
  const { coords } = useLocation();
  const [items, setItems] = useState<SavedItem[] | null>(null);

  // Distances are measured from the user, like every other station list; the
  // app-wide default applies only until a position is known.
  useEffect(() => {
    let cancelled = false;
    void loadSaved(coords ?? DEFAULT_COORDS).then((next) => {
      if (!cancelled) setItems(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng]);

  return (
    <div data-testid="saved-page" className="page-inset">
      <h1 className="page-title">Saved stations</h1>
      <p className="page-sub">Your go-to CNG stops with live status.</p>

      {items === null ? (
        <div className="list">
          <StationCardSkeleton />
          <StationCardSkeleton />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BookmarkX size={26} />}
          title="No saved stations"
          text="Tap the bookmark on any station to keep it handy here."
          testId="empty-saved"
        />
      ) : (
        <div className="list">
          {items.map(({ saved, station }) => (
            <div key={station.id}>
              {saved.label !== 'NONE' && (
                <div className="overline" style={{ marginBottom: 6 }}>
                  {LABELS[saved.label]}
                </div>
              )}
              <StationCard
                station={station}
                onNotify={openNotify}
                onNavigate={openNavigate}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
