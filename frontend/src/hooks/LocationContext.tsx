'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_COORDS, LocationService } from '@/services/LocationService';
import type { Coordinates, LocationState, PlaceBounds } from '@/types';

interface LocationCtx {
  location: LocationState;
  coords: Coordinates | null; // reference point for distance sorting
  /**
   * True until we know whether a real origin is available. Consumers must not
   * issue distance-ranked queries while this holds, or they will rank against
   * the default city and then immediately re-rank.
   */
  resolving: boolean;
  requestLocation: () => Promise<void>;
  setManual: (label: string, coords?: Coordinates, bounds?: PlaceBounds | null) => void;
}

const Ctx = createContext<LocationCtx | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<LocationState>({ status: 'unknown' });
  // Starts true so the very first render already suppresses default-origin
  // queries; the mount effect below clears it once the origin is settled.
  const [resolving, setResolving] = useState(true);

  /**
   * Resolves a readable place name in the background.
   *
   * Coordinates are already in state by the time this runs, so station queries
   * never wait on geocoding; only the header text upgrades from the generic
   * "Current location" once a name is known.
   */
  const nameLocation = useCallback(async (target: Coordinates) => {
    const label = await LocationService.describeCoords(target);
    setLocation((prev) =>
      prev.status === 'granted' &&
      prev.coords.lat === target.lat &&
      prev.coords.lng === target.lng
        ? { ...prev, label }
        : prev,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    const manual = LocationService.getManualLocation();
    if (manual) {
      setLocation({
        status: 'manual',
        // A manual entry saved without coords would otherwise leave the app with
        // no reference point at all and no way to sort by distance.
        coords: manual.coords ?? DEFAULT_COORDS,
        label: manual.label,
        bounds: manual.bounds ?? null,
      });
      setResolving(false);
      return;
    }

    // If the user already granted geolocation, acquire the real fix now. Without
    // this the app sat at status 'unknown' with coords null, and every station
    // query fell back to the default city until the user pressed the button
    // again — the reason nearby results were computed from the wrong origin.
    void (async () => {
      const permission = await LocationService.getPermissionState();
      if (cancelled) return;

      // Not already granted: never prompt on load. Release the gate so guests
      // still get results from the default origin.
      if (permission !== 'granted') {
        setResolving(false);
        return;
      }

      setLocation((prev) => (prev.status === 'unknown' ? { status: 'loading' } : prev));
      const result = await LocationService.getCurrentLocation();
      if (cancelled) return;

      if (result.status === 'granted') {
        setLocation({ status: 'granted', coords: result.coords, label: result.label });
        void nameLocation(result.coords);
      } else {
        // A silent background attempt should not push the user into an error
        // screen they never asked for; leave the prompt in place instead.
        setLocation((prev) => (prev.status === 'loading' ? { status: 'unknown' } : prev));
      }
      setResolving(false);
    })();

    return () => {
      cancelled = true;
    };
    // Mount-only: this is the initial acquisition. `nameLocation` is a stable
    // useCallback, and re-running would re-prompt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestLocation = useCallback(async () => {
    setLocation((prev) => (prev.status === 'loading' ? prev : { status: 'loading' }));
    const result = await LocationService.getCurrentLocation();
    if (result.status === 'granted') {
      setLocation({ status: 'granted', coords: result.coords, label: result.label });
      void nameLocation(result.coords);
    } else if (result.status === 'denied') {
      setLocation({ status: 'denied' });
    } else {
      setLocation({
        status: 'error',
        reason: result.reason,
        message: result.message,
      });
    }
  }, [nameLocation]);

  const setManual = useCallback(
    (label: string, coords: Coordinates = DEFAULT_COORDS, bounds: PlaceBounds | null = null) => {
      LocationService.setManualLocation(label, coords, bounds);
      setLocation({ status: 'manual', coords, label, bounds });
    },
    [],
  );

  const coords = useMemo<Coordinates | null>(() => {
    if (location.status === 'granted') return location.coords;
    if (location.status === 'manual') return location.coords;
    return null;
  }, [location]);

  return (
    <Ctx.Provider value={{ location, coords, resolving, requestLocation, setManual }}>
      {children}
    </Ctx.Provider>
  );
}

export function useLocation(): LocationCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLocation must be used within LocationProvider');
  return ctx;
}
