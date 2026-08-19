'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPinned, Navigation, Radio } from 'lucide-react';
import type { Coordinates, Station } from '@/types';
import { StationService } from '@/services/StationService';
import { AppHeader } from '@/components/layout/AppHeader';
import { Spinner } from '@/components/ui/Spinner';
import { useSheets } from '@/hooks/SheetsContext';
import { useLocation } from '@/hooks/LocationContext';
import { useLiveLocation } from '@/hooks/useLiveLocation';
import { isGoogleMapsConfigured } from '@/lib/googleMaps';

// Lazy-loaded so map code stays out of the initial bundle.
const mapLoading = () => (
  <div className="center-loader">
    <Spinner />
  </div>
);

const MockMap = dynamic(() => import('@/features/maps/MockMap').then((m) => m.MockMap), {
  ssr: false,
  loading: mapLoading,
});

const GoogleMap = dynamic(() => import('@/features/maps/GoogleMap').then((m) => m.GoogleMap), {
  ssr: false,
  loading: mapLoading,
});

export default function MapPage() {
  const { openNotify, openNavigate } = useSheets();
  const { coords: savedCoords, resolving, location } = useLocation();
  const [stations, setStations] = useState<Station[] | null>(null);

  /**
   * Guards against a slow response for an old position overwriting a newer
   * one — while driving, requests can easily resolve out of order.
   */
  const requestSeq = useRef(0);

  const loadStations = useCallback(async (origin: Coordinates | null) => {
    const seq = ++requestSeq.current;
    const results = await StationService.getNearbyStations({
      origin: origin ?? undefined,
    });
    if (seq === requestSeq.current) setStations(results);
  }, []);

  /**
   * Live tracking, mounted only by this page, so the GPS watch stops when the
   * user navigates away. The 150 m threshold stops parked-GPS jitter from
   * refetching stations every few seconds.
   */
  // A manually chosen area must not be overridden by the device's position:
  // the user is deliberately looking somewhere they are not.
  const manual = location.status === 'manual';

  const { coords: liveCoords, accuracyM, tracking, error } = useLiveLocation({
    minMoveMeters: 150,
    onMove: (next) => {
      if (manual) return;
      void loadStations(next);
    },
  });

  // The live fix wins only while we are actually following the user.
  const activeCoords = manual ? savedCoords : (liveCoords ?? savedCoords);

  useEffect(() => {
    // Hold until the origin is settled, otherwise the first fetch ranks from the
    // default city and is immediately superseded by the real fix.
    if (resolving && !activeCoords) return;
    void loadStations(activeCoords ?? null);
    // Only re-run for the saved coords; live movement is handled by `onMove`,
    // which already applies the distance threshold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCoords?.lat, savedCoords?.lng, resolving, loadStations]);

  const fallback = stations ? (
    <MockMap stations={stations} onNotify={openNotify} onNavigate={openNavigate} />
  ) : (
    mapLoading()
  );

  return (
    <div className="map-screen" data-testid="map-page">
      <AppHeader />

      {/* Tracking state is worth surfacing: it explains why the list reorders
          as the user drives, and why it does not when permission is denied. */}
      {/* While a manual area is active the map is deliberately NOT following the
          device, so a "Live location" badge would be untrue. */}
      {manual ? (
        <div className="map-status map-status--area" data-testid="map-area">
          <MapPinned size={14} />
          Showing {location.status === 'manual' ? location.label : 'selected area'}
        </div>
      ) : (
        tracking &&
        liveCoords && (
          <div className="map-status" data-testid="map-live">
            <Radio size={14} className="map-status__pulse" />
            Live location
            {accuracyM !== null && accuracyM > 100 && (
              <span className="muted"> · ±{Math.round(accuracyM)} m</span>
            )}
          </div>
        )
      )}

      {error === 'denied' && (
        <div className="map-status map-status--warn" data-testid="map-denied">
          <Navigation size={14} />
          Location blocked — showing the default area
        </div>
      )}

      {stations === null ? (
        mapLoading()
      ) : isGoogleMapsConfigured ? (
        <GoogleMap
          stations={stations}
          userCoords={activeCoords ?? null}
          onNotify={openNotify}
          onNavigate={openNavigate}
          fallback={fallback}
          area={location.status === 'manual' ? (location.bounds ?? null) : null}
        />
      ) : (
        fallback
      )}
    </div>
  );
}
