'use client';

import { createContext, useCallback, useContext, useState } from 'react';
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

  return (
    <Ctx.Provider value={{ openNotify, openNavigate }}>
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
