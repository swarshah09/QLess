'use client';

import { useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useLocation } from '@/hooks/LocationContext';
import { LocationPickerSheet } from './LocationPickerSheet';

// Compact location control used in the Home header area.
export function LocationBanner() {
  const { location, requestLocation } = useLocation();
  // Opens the real search picker. The previous free-text field saved only a
  // label and fell back to the default city's coordinates, so a user who typed
  // "Mumbai" silently got results for somewhere else entirely.
  const [pickerOpen, setPickerOpen] = useState(false);

  if (location.status === 'loading') {
    return (
      <div
        className="card"
        data-testid="location-loading"
        style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}
      >
        <Navigation size={20} style={{ color: 'var(--primary)' }} />
        <div className="muted" style={{ fontSize: 14 }}>
          Getting your location…
        </div>
      </div>
    );
  }

  if (location.status === 'denied') {
    return (
      <div className="card" data-testid="location-denied" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
          Turn on location to see the nearest CNG stations.
        </div>
        <p className="muted" style={{ fontSize: 14, margin: '4px 0 12px' }}>
          We&apos;re showing an approximate order for now.
        </p>
        <div className="btn-row">
          <Button size="sm" onClick={() => requestLocation()} data-testid="enable-location">
            <Navigation size={16} /> Enable Location
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
            data-testid="choose-location"
          >
            <MapPin size={16} /> Choose Location
          </Button>
        </div>
        <LocationPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} />
      </div>
    );
  }

  if (location.status === 'error') {
    return (
      <div className="card" data-testid="location-error" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
          Couldn&apos;t get your location
        </div>
        <p className="muted" style={{ fontSize: 14, margin: '4px 0 12px' }}>
          {location.message}
        </p>
        <div className="btn-row">
          {/* An insecure origin cannot be retried into working — only the manual
              path is useful there. */}
          {location.reason !== 'insecure-context' &&
            location.reason !== 'unsupported' && (
              <Button size="sm" onClick={() => requestLocation()} data-testid="retry-location">
                <Navigation size={16} /> Try again
              </Button>
            )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
            data-testid="choose-location"
          >
            <MapPin size={16} /> Choose Location
          </Button>
        </div>
        <LocationPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} />
      </div>
    );
  }

  if (location.status === 'unknown') {
    return (
      <div
        className="card"
        data-testid="location-prompt"
        style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}
      >
        <MapPin size={20} style={{ color: 'var(--primary)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Find CNG near you</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Share location for accurate distances.
          </div>
        </div>
        <Button size="sm" onClick={() => requestLocation()} data-testid="enable-location">
          Enable
        </Button>
      </div>
    );
  }

  return null;
}
