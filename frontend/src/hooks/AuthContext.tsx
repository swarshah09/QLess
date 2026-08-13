'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AuthService } from '@/services/AuthService';
import { SavedStationService } from '@/services/SavedStationService';
import { RealtimeService } from '@/services/RealtimeService';
import { onAuthFailure } from '@/lib/api/client';
import type { User } from '@/types';

interface AuthCtx {
  user: User | null;
  isGuest: boolean;
  ready: boolean;
  role: 'USER' | 'STATION_OPERATOR' | 'ADMIN' | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<'USER' | 'STATION_OPERATOR' | 'ADMIN' | null>(null);

  useEffect(() => {
    // Show the cached user immediately, then confirm against the backend so a
    // revoked or expired session does not linger in the UI.
    setUser(AuthService.getCurrentUser());
    setIsGuest(AuthService.isGuest());
    setRole(AuthService.getRole());
    setReady(true);

    void AuthService.refreshProfile().then((fresh) => {
      if (fresh) {
        setUser(fresh);
        setRole(AuthService.getRole());
      } else if (AuthService.getCurrentUser() === null) {
        setUser(null);
        setRole(null);
      }
    });
  }, []);

  // The API client signals here when a refresh fails irrecoverably.
  useEffect(
    () =>
      onAuthFailure(() => {
        setUser(null);
        setRole(null);
        SavedStationService.clearMirror();
        RealtimeService.reconnect();
      }),
    [],
  );

  const login = useCallback(async (email: string, password: string) => {
    const u = await AuthService.login(email, password);
    setUser(u);
    setRole(AuthService.getRole());
    setIsGuest(false);
    // Reconnect so the socket carries the new identity.
    RealtimeService.reconnect();
    void SavedStationService.list();
  }, []);

  const register = useCallback(
    async (input: { name: string; email: string; password: string; phone?: string }) => {
      const u = await AuthService.register(input);
      setUser(u);
      setRole(AuthService.getRole());
      setIsGuest(false);
      RealtimeService.reconnect();
    },
    [],
  );

  const logout = useCallback(async () => {
    await AuthService.logout();
    SavedStationService.clearMirror();
    setUser(null);
    setRole(null);
    setIsGuest(false);
    RealtimeService.reconnect();
  }, []);

  const continueAsGuest = useCallback(() => {
    AuthService.continueAsGuest();
    setIsGuest(true);
  }, []);

  return (
    <Ctx.Provider
      value={{ user, isGuest, ready, role, login, register, logout, continueAsGuest }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
