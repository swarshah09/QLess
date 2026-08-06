'use client';

import { useState } from 'react';
import { MapPin, Navigation, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useLocation } from '@/hooks/LocationContext';

// Compact location control used in the Home header area.
export function LocationBanner() {
  const { location, requestLocation, setManual } = useLocation();
  const [manualOpen, setManualOpen] = useState(false);
  const [value, setValue] = useState('');

  if (location.status === 'denied') {
    return (
      <div className="card" data-testid="location-denied" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
          Turn on location to see the nearest CNG stations.
        </div>
        <p className="muted" style={{ fontSize: 14, margin: '4px 0 12px' }}>
          We&apos;re showing an approximate order for now.
        </p>
        {manualOpen ? (
          <div className="stack" style={{ gap: 10 }}>
            <input
              className="input"
              placeholder="Enter area or city"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              data-testid="manual-location-input"
            />
            <div className="btn-row">
              <Button variant="outline" size="sm" onClick={() => requestLocation()}>
                Use GPS
              </Button>
              <Button
                size="sm"
                onClick={() => value && setManual(value)}
                data-testid="manual-location-save"
              >
                <Search size={16} /> Set
              </Button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            <Button
              size="sm"
              onClick={() => requestLocation()}
              data-testid="enable-location"
            >
              <Navigation size={16} /> Enable Location
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManualOpen(true)}
              data-testid="choose-location"
            >
              <MapPin size={16} /> Choose Location
            </Button>
          </div>
        )}
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
