'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  CURRENT_LOCATION_LABEL,
  DEFAULT_COORDS,
  LocationService,
} from '@/services/LocationService';
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

  // The name appears only inside the app (header, home), and resolving one can
  // mean downloading the whole Maps SDK, so it is not looked up while the
  // landing or login screen is showing — it resolves on entering the app.
  const pathname = usePathname();
  const showsPlaceName = pathname?.startsWith('/app') ?? false;

  useEffect(() => {
    if (!showsPlaceName || location.status !== 'granted') return;
    if (location.label !== CURRENT_LOCATION_LABEL) return;
    void nameLocation(location.coords);
  }, [showsPlaceName, location, nameLocation]);

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

    // Current location is the default experience, not an opt-in: acquire it on
    // load whenever the browser will allow it. If permission was already
    // granted this resolves silently; if it has never been asked ('prompt'),
    // this is what triggers the native browser prompt on first visit — we used
    // to wait for the user to notice and tap "Enable", which meant every fresh
    // session (and every browser that had never been asked) silently ranked
    // stations from the default city instead of the user's real position. Only
    // a firm 'denied' skips this, since re-asking then is not possible and
    // would just stall the loading state for no reason.
    void (async () => {
      const permission = await LocationService.getPermissionState();
      if (cancelled) return;

      if (permission === 'denied') {
        setLocation({ status: 'denied' });
        setResolving(false);
        return;
      }

      setLocation((prev) => (prev.status === 'unknown' ? { status: 'loading' } : prev));
      const result = await LocationService.getCurrentLocation();
      if (cancelled) return;

      if (result.status === 'granted') {
        // The place name is filled in by the naming effect above.
        setLocation({ status: 'granted', coords: result.coords, label: result.label });
      } else if (result.status === 'denied') {
        setLocation({ status: 'denied' });
      } else {
        // Not a permission problem (timeout, unavailable, insecure context) —
        // leave the manual "Enable"/"Choose location" prompt in place rather
        // than a dead-end error screen for a background attempt the user
        // never directly triggered.
        setLocation({ status: 'unknown' });
      }
      setResolving(false);
    })();

    return () => {
      cancelled = true;
    };
    // Mount-only: this is the initial acquisition, and re-running would
    // re-prompt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestLocation = useCallback(async () => {
    setLocation((prev) => (prev.status === 'loading' ? prev : { status: 'loading' }));
    const result = await LocationService.getCurrentLocation();
    if (result.status === 'granted') {
      setLocation({ status: 'granted', coords: result.coords, label: result.label });
    } else if (result.status === 'denied') {
      setLocation({ status: 'denied' });
    } else {
      setLocation({
        status: 'error',
        reason: result.reason,
        message: result.message,
      });
    }
  }, []);

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

  // Stable identity, so consumers re-render only when a value they read changes.
  const value = useMemo(
    () => ({ location, coords, resolving, requestLocation, setManual }),
    [location, coords, resolving, requestLocation, setManual],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocation(): LocationCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLocation must be used within LocationProvider');
  return ctx;
}
