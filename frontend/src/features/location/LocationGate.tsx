'use client';

import { useState } from 'react';
import { Loader2, LocateFixed, MapPin, Navigation, Fuel } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useLocation } from '@/hooks/LocationContext';
import { LocationPickerSheet } from './LocationPickerSheet';

/**
 * Full-page location gate.
 *
 * Location is the app's default experience (see LocationContext), so the only
 * time this actually renders is when the browser has NOT granted it — denied,
 * or a background attempt failed for some other reason. Rather than fall back
 * to a hardcoded default city and show real stations ranked from the wrong
 * place (which reads as broken, not "approximate"), the whole page content is
 * replaced by one clear ask. The moment a location becomes available — GPS
 * granted, or a manual place chosen — this disappears and `children` renders
 * in its place; nothing here persists past that point.
 */
export function LocationGate({ children }: { children: React.ReactNode }) {
  const { location, resolving, requestLocation } = useLocation();
  const [pickerOpen, setPickerOpen] = useState(false);

  // A manual pick is a fully valid origin — only 'denied'/'error'/'unknown'
  // (no usable coordinates at all) should show the gate. 'loading' also
  // passes through as a quiet spinner rather than the full animated prompt,
  // since that state is normally brief and re-showing the whole hero for it
  // would flash distractingly on every cold load.
  const hasLocation = location.status === 'granted' || location.status === 'manual';

  if (hasLocation) return <>{children}</>;

  if (resolving || location.status === 'loading') {
    return (
      <div className="center-loader" data-testid="location-gate-loading">
        <Loader2 size={28} className="spin" />
      </div>
    );
  }

  const isDenied = location.status === 'denied';
  const errorMessage = location.status === 'error' ? location.message : null;

  return (
    <div className="locgate" data-testid="location-gate">
      <div className="locgate__hero">
        <div className="locgate__radar" aria-hidden>
          <span className="locgate__ring" />
          <span className="locgate__ring" />
          <span className="locgate__ring" />
        </div>
        <div className="locgate__pin locgate__pin--a" aria-hidden>
          <Fuel size={12} /> CNG
        </div>
        <div className="locgate__pin locgate__pin--b" aria-hidden>
          <Fuel size={12} /> CNG
        </div>
        <div className="locgate__badge">
          <LocateFixed size={30} />
        </div>
      </div>

      <h2 className="locgate__title">Find CNG stations near you</h2>
      <p className="locgate__text">
        {isDenied
          ? 'Location access is turned off. Enable it to see real stations and distances near you.'
          : errorMessage
            ? errorMessage
            : 'Share your location to see real CNG stations ranked nearest to farthest.'}
      </p>

      <div className="locgate__actions">
        <Button
          block
          size="lg"
          onClick={() => void requestLocation()}
          data-testid="location-gate-enable"
        >
          <Navigation size={18} /> Enable Location
        </Button>
        <button
          type="button"
          className="locgate__manual"
          onClick={() => setPickerOpen(true)}
          data-testid="location-gate-manual"
        >
          <MapPin size={15} /> Choose a location manually
        </button>
      </div>

      <LocationPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}
