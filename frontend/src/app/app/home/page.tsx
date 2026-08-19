'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { List, Loader2, Map as MapIcon, SearchX, SlidersHorizontal, MapPin } from 'lucide-react';
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
import { NEARBY_RADIUS_M } from '@/lib/api/config';

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
  const { coords, location, resolving } = useLocation();

  const [stations, setStations] = useState<Station[] | null>(null);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState<SortKey>('nearest');
  const [filters, setFilters] = useState<StationFilters>({});
  const [sfOpen, setSfOpen] = useState(false);
  // Free-tier hosting can spin the backend down after idle and take upwards of
  // a minute to wake on the next request. Left unexplained, that reads as the
  // app being broken; naming it after a few seconds turns a silent hang into
  // an understood wait.
  const [slowWake, setSlowWake] = useState(false);

  const originKey = coords ? `${coords.lat},${coords.lng}` : 'default';

  // While location is still resolving we have no real origin. Querying now would
  // return results ranked from the default city and then immediately re-rank,
  // so hold the request until the origin is settled one way or the other.
  const originPending = coords === null && resolving;

  const hasActiveFilters = Object.values(filters).some(
    (v) => v !== undefined && v !== false && v !== null,
  );

  const load = useCallback(async () => {
    if (originPending) return;
    setError(false);
    setStations(null);
    setSlowWake(false);

    // Only names the wait if the request is actually still in flight past a
    // normal-latency window — a fast response never shows this message.
    const slowTimer = setTimeout(() => setSlowWake(true), 4000);
    try {
      const data = await StationService.getNearbyStations({
        origin: coords ?? undefined,
        filters,
        sort,
      });
      setStations(data);
    } catch {
      setError(true);
    } finally {
      clearTimeout(slowTimer);
      setSlowWake(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, originPending, sort, JSON.stringify(filters)]);

  useEffect(() => {
    load();
  }, [load]);

  const firstName = user?.name?.split(' ')[0];
  const recommendedId = stations ? getRecommendedStationId(stations) : null;
  const locLabel =
    location.status === 'granted' || location.status === 'manual'
      ? location.label
      : location.status === 'loading'
        ? 'Locating…'
        : // Claiming "Current location" when we never got one is a lie the user
          // can act on; say the location is unset instead.
          'Set location';

  return (
    <div data-testid="home-page">
      <AppHeader />

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
            {slowWake && (
              <div className="hint" data-testid="slow-wake-hint">
                <Loader2 size={16} className="spin" />
                <div>
                  Waking up the server — this can take up to a minute on first
                  load after a period of inactivity.
                </div>
              </div>
            )}
            <StationCardSkeleton />
            <StationCardSkeleton />
            <StationCardSkeleton />
          </div>
        ) : stations.length === 0 ? (
          // With no filters applied there is nothing to "widen" — the area
          // genuinely has no stations in range, and saying so avoids sending the
          // user to a filter sheet that cannot help.
          hasActiveFilters ? (
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
            <EmptyState
              icon={<SearchX size={26} />}
              title="No CNG stations nearby"
              text={`We couldn't find any stations within ${Math.round(
                NEARBY_RADIUS_M / 1000,
              )} km of ${locLabel}. Try a different area.`}
            />
          )
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
