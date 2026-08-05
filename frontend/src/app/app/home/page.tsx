'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { List, Map as MapIcon, SearchX } from 'lucide-react';
import type { Station } from '@/types';
import { StationService } from '@/services/StationService';
import { AppHeader } from '@/components/layout/AppHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { StationCard } from '@/features/stations/StationCard';
import { StationCardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LocationBanner } from '@/features/location/LocationBanner';
import { useSheets } from '@/hooks/SheetsContext';
import { useAuth } from '@/hooks/AuthContext';
import { useLocation } from '@/hooks/LocationContext';

export default function HomePage() {
  const router = useRouter();
  const { openNotify, openNavigate } = useSheets();
  const { user } = useAuth();
  const { requestLocation, location } = useLocation();
  const [stations, setStations] = useState<Station[] | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    setError(false);
    setStations(null);
    try {
      const data = await StationService.getNearbyStations();
      setStations(data);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const firstName = user?.name?.split(' ')[0];

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
        <h1 className="page-title">Best CNG options near you</h1>

        <div style={{ margin: '4px 0 18px' }}>
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
            title="No stations nearby"
            text="We couldn't find CNG stations around here. Try a different location."
          />
        ) : (
          <div className="list">
            {stations.map((s) => (
              <StationCard
                key={s.id}
                station={s}
                onNotify={openNotify}
                onNavigate={openNavigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
