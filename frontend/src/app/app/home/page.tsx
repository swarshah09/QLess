'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { List, Map as MapIcon, SearchX, SlidersHorizontal, MapPin } from 'lucide-react';
import type { SortKey, Station, StationFilters } from '@/types';
import { StationService } from '@/services/StationService';
import { getRecommendedStationId } from '@/lib/status';
import { AppHeader } from '@/components/layout/AppHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { StationCard } from '@/features/stations/StationCard';
import { SortFilterSheet } from '@/features/stations/SortFilterSheet';
import { StationCardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LocationBanner } from '@/features/location/LocationBanner';
import { useSheets } from '@/hooks/SheetsContext';
import { useAuth } from '@/hooks/AuthContext';
import { useLocation } from '@/hooks/LocationContext';

const SORT_LABEL: Record<SortKey, string> = {
  nearest: 'Nearest',
  wait: 'Shortest wait',
  queue: 'Shortest queue',
  updated: 'Recently updated',
};

export default function HomePage() {
  const router = useRouter();
  const { openNotify, openNavigate } = useSheets();
  const { user } = useAuth();
  const { coords, location, requestLocation } = useLocation();

  const [stations, setStations] = useState<Station[] | null>(null);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState<SortKey>('nearest');
  const [filters, setFilters] = useState<StationFilters>({});
  const [sfOpen, setSfOpen] = useState(false);

  const originKey = coords ? `${coords.lat},${coords.lng}` : 'default';

  const load = useCallback(async () => {
    setError(false);
    setStations(null);
    try {
      const data = await StationService.getNearbyStations({
        origin: coords ?? undefined,
        filters,
        sort,
      });
      setStations(data);
    } catch {
      setError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, sort, JSON.stringify(filters)]);

  useEffect(() => {
    load();
  }, [load]);

  const firstName = user?.name?.split(' ')[0];
  const recommendedId = stations ? getRecommendedStationId(stations) : null;
  const locLabel =
    location.status === 'granted'
      ? location.label
      : location.status === 'manual'
        ? location.label
        : 'Current location';

  return (
    <div data-testid="home-page">
      <AppHeader
        onLocationClick={() => location.status !== 'granted' && requestLocation()}
      />

      <div style={{ padding: '18px 16px 0' }}>
        {firstName && (
          <p className="muted" style={{ fontSize: 14 }}>
            Hi {firstName} 👋
          </p>
        )}
        <h1 className="page-title">CNG stations near you</h1>

        <div className="home-controls">
          <span className="home-loc" data-testid="home-location">
            <MapPin size={14} /> {locLabel}
          </span>
          <button
            className="sortbtn"
            onClick={() => setSfOpen(true)}
            data-testid="open-sortfilter"
          >
            <SlidersHorizontal size={15} />
            Sort: {SORT_LABEL[sort]}
          </button>
        </div>

        <div style={{ margin: '14px 0 18px' }}>
          <SegmentedControl
            block
            testId="list-map-toggle"
            value="list"
            onChange={(v) => v === 'map' && router.push('/app/map')}
            options={[
              { value: 'list', label: 'List', icon: <List size={16} /> },
              { value: 'map', label: 'Map', icon: <MapIcon size={16} /> },
            ]}
          />
        </div>

        <LocationBanner />
      </div>

      <div style={{ padding: '0 16px 8px' }}>
        {error ? (
          <ErrorState onRetry={load} />
        ) : stations === null ? (
          <div className="list">
            <StationCardSkeleton />
            <StationCardSkeleton />
            <StationCardSkeleton />
          </div>
        ) : stations.length === 0 ? (
          <EmptyState
            icon={<SearchX size={26} />}
            title="No stations match"
            text="Try widening your filters or distance to see more CNG stations."
            actionLabel="Reset filters"
            onAction={() => {
              setFilters({});
              setSort('nearest');
            }}
          />
        ) : (
          <div className="list">
            {stations.map((s) => (
              <StationCard
                key={s.id}
                station={s}
                onNotify={openNotify}
                onNavigate={openNavigate}
                recommended={s.id === recommendedId}
              />
            ))}
          </div>
        )}
      </div>

      <SortFilterSheet
        open={sfOpen}
        sort={sort}
        filters={filters}
        onApply={(nextSort, nextFilters) => {
          setSort(nextSort);
          setFilters(nextFilters);
          setSfOpen(false);
        }}
        onClose={() => setSfOpen(false)}
      />
    </div>
  );
}
