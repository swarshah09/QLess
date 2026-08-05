'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { Station } from '@/types';
import { StationService } from '@/services/StationService';
import { AppHeader } from '@/components/layout/AppHeader';
import { Spinner } from '@/components/ui/Spinner';
import { useSheets } from '@/hooks/SheetsContext';

// Lazy-load the map so its code isn't in the initial bundle.
const MockMap = dynamic(
  () => import('@/features/maps/MockMap').then((m) => m.MockMap),
  {
    ssr: false,
    loading: () => (
      <div className="center-loader">
        <Spinner />
      </div>
    ),
  },
);

export default function MapPage() {
  const { openNotify, openNavigate } = useSheets();
  const [stations, setStations] = useState<Station[] | null>(null);

  useEffect(() => {
    StationService.getNearbyStations().then(setStations);
  }, []);

  return (
    <div className="map-screen" data-testid="map-page">
      <AppHeader />
      {stations === null ? (
        <div className="center-loader">
          <Spinner />
        </div>
      ) : (
        <MockMap
          stations={stations}
          onNotify={openNotify}
          onNavigate={openNavigate}
        />
      )}
    </div>
  );
}
