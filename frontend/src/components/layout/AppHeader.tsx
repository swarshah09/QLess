'use client';

import { ChevronDown, Moon, Sun } from 'lucide-react';
import { useLocation } from '@/hooks/LocationContext';
import { useTheme } from '@/hooks/ThemeContext';

export function AppHeader({ onLocationClick }: { onLocationClick?: () => void }) {
  const { location } = useLocation();
  const { theme, toggle } = useTheme();

  const label =
    location.status === 'granted'
      ? location.label
      : location.status === 'manual'
        ? location.label
        : location.status === 'loading'
          ? 'Locating…'
          : 'Set your location';

  return (
    <header className="app-header" data-testid="app-header">
      <button
        className="app-header__loc"
        onClick={onLocationClick}
        data-testid="header-location"
      >
        <div className="app-header__loc-text">
          <span className="overline">Your location</span>
          <strong>
            {label} <ChevronDown size={14} style={{ verticalAlign: '-2px' }} />
          </strong>
        </div>
      </button>
      <button
        className="icon-btn"
        onClick={toggle}
        aria-label="Toggle theme"
        data-testid="theme-toggle"
      >
        {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
      </button>
    </header>
  );
}
