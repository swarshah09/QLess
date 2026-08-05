'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookmarkX } from 'lucide-react';
import type { SavedStation, Station } from '@/types';
import { SavedStationService } from '@/services/SavedStationService';
import { StationService } from '@/services/StationService';
import { StationCard } from '@/features/stations/StationCard';
import { StationCardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSheets } from '@/hooks/SheetsContext';

const LABELS: Record<string, string> = {
  HOME: 'Home',
  OFFICE: 'Office',
  FAVORITE: 'Favorite',
  NONE: '',
};

export default function SavedPage() {
  const { openNotify, openNavigate } = useSheets();
  const [items, setItems] = useState<
    { saved: SavedStation; station: Station }[] | null
  >(null);

  const load = useCallback(async () => {
    const saved = await SavedStationService.list();
    const stations = await StationService.getStationsByIds(
      saved.map((s) => s.stationId),
    );
    const merged = saved
      .map((s) => {
        const station = stations.find((st) => st.id === s.stationId);
        return station ? { saved: s, station } : null;
      })
      .filter(Boolean) as { saved: SavedStation; station: Station }[];
    setItems(merged);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div data-testid="saved-page" style={{ paddingTop: 8 }}>
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
