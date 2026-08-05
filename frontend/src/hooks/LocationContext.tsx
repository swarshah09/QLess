'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { LocationService } from '@/services/LocationService';
import type { LocationState } from '@/types';

interface LocationCtx {
  location: LocationState;
  requestLocation: () => Promise<void>;
  setManual: (label: string) => void;
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
    const result = await LocationService.getCurrentPosition();
    if (result.status === 'granted') {
      setLocation({ status: 'granted', coords: result.coords, label: result.label });
    } else {
      setLocation({ status: 'denied' });
    }
  }, []);

  const setManual = useCallback((label: string) => {
    LocationService.setManualLocation(label, null);
    setLocation({ status: 'manual', coords: null, label });
  }, []);

  return (
    <Ctx.Provider value={{ location, requestLocation, setManual }}>
      {children}
    </Ctx.Provider>
  );
}

export function useLocation(): LocationCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLocation must be used within LocationProvider');
  return ctx;
}
