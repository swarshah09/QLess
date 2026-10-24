'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Station } from '@/types';
import { NotifyMeSheet } from '@/features/notifications/NotifyMeSheet';
import { NavigationSheet } from '@/features/navigation/NavigationSheet';

interface SheetsCtx {
  openNotify: (station: Station) => void;
  openNavigate: (station: Station) => void;
}

const Ctx = createContext<SheetsCtx | null>(null);

// Hosts the two most-used bottom sheets once, so any screen can trigger them.
export function SheetsProvider({ children }: { children: React.ReactNode }) {
  const [notifyStation, setNotifyStation] = useState<Station | null>(null);
  const [navStation, setNavStation] = useState<Station | null>(null);

  const openNotify = useCallback((s: Station) => setNotifyStation(s), []);
  const openNavigate = useCallback((s: Station) => setNavStation(s), []);
  // Opening a sheet re-renders this provider; with a fresh value object it also
  // re-rendered the whole screen underneath (every station card included).
  const value = useMemo(() => ({ openNotify, openNavigate }), [openNotify, openNavigate]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <NotifyMeSheet
        open={notifyStation !== null}
        station={notifyStation}
        onClose={() => setNotifyStation(null)}
      />
      <NavigationSheet
        open={navStation !== null}
        station={navStation}
        onClose={() => setNavStation(null)}
      />
    </Ctx.Provider>
  );
}

export function useSheets(): SheetsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSheets must be used within SheetsProvider');
  return ctx;
}
