'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AuthService } from '@/services/AuthService';
import type { User } from '@/types';

interface AuthCtx {
  user: User | null;
  isGuest: boolean;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(AuthService.getCurrentUser());
    setIsGuest(AuthService.isGuest());
    setReady(true);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await AuthService.login(email, password);
    setUser(u);
    setIsGuest(false);
  }, []);

  const logout = useCallback(async () => {
    await AuthService.logout();
    setUser(null);
    setIsGuest(false);
  }, []);

  const continueAsGuest = useCallback(() => {
    AuthService.continueAsGuest();
    setIsGuest(true);
  }, []);

  return (
    <Ctx.Provider
      value={{ user, isGuest, ready, login, logout, continueAsGuest }}
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
