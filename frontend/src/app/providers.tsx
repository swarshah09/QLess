'use client';

import { ThemeProvider } from '@/hooks/ThemeContext';
import { ToastProvider } from '@/hooks/ToastContext';
import { AuthProvider } from '@/hooks/AuthContext';
import { LocationProvider } from '@/hooks/LocationContext';
import { SheetsProvider } from '@/hooks/SheetsContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <LocationProvider>
          <ToastProvider>
            <SheetsProvider>{children}</SheetsProvider>
          </ToastProvider>
        </LocationProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
