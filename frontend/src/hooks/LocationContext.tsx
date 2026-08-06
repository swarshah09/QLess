'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_COORDS, LocationService } from '@/services/LocationService';
import type { Coordinates, LocationState } from '@/types';

interface LocationCtx {
  location: LocationState;
  coords: Coordinates | null; // reference point for distance sorting
  requestLocation: () => Promise<void>;
  setManual: (label: string, coords?: Coordinates) => void;
}

const Ctx = createContext<LocationCtx | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<LocationState>({ status: 'unknown' });

  useEffect(() => {
    const manual = LocationService.getManualLocation();
    if (manual) {
      setLocation({ status: 'manual', coords: manual.coords, label: manual.label });
    }
  }, []);

  const requestLocation = useCallback(async () => {
    setLocation({ status: 'loading' });
    const result = await LocationService.getCurrentLocation();
    if (result.status === 'granted') {
      setLocation({ status: 'granted', coords: result.coords, label: result.label });
    } else {
      setLocation({ status: 'denied' });
    }
  }, []);

  const setManual = useCallback((label: string, coords: Coordinates = DEFAULT_COORDS) => {
    LocationService.setManualLocation(label, coords);
    setLocation({ status: 'manual', coords, label });
  }, []);

  const coords = useMemo<Coordinates | null>(() => {
    if (location.status === 'granted') return location.coords;
    if (location.status === 'manual') return location.coords;
    return null;
  }, [location]);

  return (
    <Ctx.Provider value={{ location, coords, requestLocation, setManual }}>
      {children}
    </Ctx.Provider>
  );
}

export function useLocation(): LocationCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLocation must be used within LocationProvider');
  return ctx;
}
