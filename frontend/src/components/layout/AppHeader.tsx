'use client';

import { useState } from 'react';
import { ChevronDown, Loader2, MapPin, Moon, Sun } from 'lucide-react';
import { useLocation } from '@/hooks/LocationContext';
import { useTheme } from '@/hooks/ThemeContext';
import { Logo } from '@/components/ui/Logo';
import { LocationPickerSheet } from '@/features/location/LocationPickerSheet';

export function AppHeader() {
  const { location } = useLocation();
  const { theme, toggle } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);

  const loading = location.status === 'loading';
  const label =
    location.status === 'granted' || location.status === 'manual'
      ? location.label
      : loading
        ? 'Locating…'
        : 'Set your location';

  // Opening the picker must NOT trigger a GPS request: doing so overwrote a
  // manually chosen city with the device's own position the moment the user
  // tapped the header. Choosing "Use my current location" inside the sheet is
  // now the only path back to GPS.
  const openPicker = () => setPickerOpen(true);

  return (
    <>
      <header className="app-header" data-testid="app-header">
        <div className="app-header__brand">
          <Logo size={34} />
        </div>

        <button
          className="app-header__loc"
          onClick={openPicker}
          data-testid="header-location"
          aria-label={`Change location. Current: ${label}`}
        >
          <span className="app-header__loc-icon">
            {loading ? (
              <Loader2 size={15} className="app-header__spin" />
            ) : (
              <MapPin size={15} />
            )}
          </span>
          <span className="app-header__loc-text">
            <span className="overline">Your location</span>
            <strong>{label}</strong>
          </span>
          <ChevronDown size={15} className="app-header__loc-caret" />
        </button>

        <button
          className="icon-btn app-header__theme"
          onClick={toggle}
          aria-label="Toggle theme"
          data-testid="theme-toggle"
        >
          {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
        </button>
      </header>

      <LocationPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}
