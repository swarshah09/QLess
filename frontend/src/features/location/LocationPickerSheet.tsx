'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, Loader2, MapPin, Search, SearchX } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { useLocation } from '@/hooks/LocationContext';
import { LocationService, type PlaceResult } from '@/services/LocationService';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Long enough to stop firing a lookup on every keystroke, short enough to feel live. */
const DEBOUNCE_MS = 350;

export function LocationPickerSheet({ open, onClose }: Props) {
  const { setManual, requestLocation } = useLocation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  /** Guards against a slow early response overwriting a newer one. */
  const seqRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      const found = await LocationService.searchPlaces(trimmed);
      if (seq !== seqRef.current) return;
      setResults(found);
      setSearching(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // Clear state on close so reopening never shows a previous search.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults(null);
      setSearching(false);
      seqRef.current += 1;
    }
  }, [open]);

  const choose = useCallback(
    (place: PlaceResult) => {
      // Coordinates come from the picked result, so the nearby query uses the
      // place the user actually chose rather than a default centre.
      setManual(place.label, place.coords, place.bounds);
      onClose();
    },
    [setManual, onClose],
  );

  const useGps = useCallback(() => {
    void requestLocation();
    onClose();
  }, [requestLocation, onClose]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Set your location"
      description="Search a city, area or PIN code."
      testId="location-picker"
    >
      <div className="locpick">
        <div className="locpick__field">
          <Search size={17} />
          <input
            className="locpick__input"
            placeholder="Try “Baner”, “Pune” or “411045”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            data-testid="location-search-input"
          />
          {searching && <Loader2 size={16} className="locpick__spin" />}
        </div>

        <button className="locpick__gps" onClick={useGps} data-testid="use-current-location">
          <Crosshair size={17} />
          <span>Use my current location</span>
        </button>

        {results !== null && results.length === 0 && !searching && (
          <div className="locpick__empty" data-testid="location-no-results">
            <SearchX size={22} />
            <span>No places match “{query.trim()}”.</span>
            <small>Check the spelling, or try a nearby city or PIN code.</small>
          </div>
        )}

        {results !== null && results.length > 0 && (
          <ul className="locpick__list" data-testid="location-results">
            {results.map((place, i) => (
              <li key={`${place.description}-${i}`}>
                <button
                  className="locpick__item"
                  onClick={() => choose(place)}
                  data-testid={`location-result-${i}`}
                >
                  <MapPin size={16} />
                  <span className="locpick__item-text">
                    <strong>{place.label}</strong>
                    <small>{place.description}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {results === null && !searching && (
          <p className="locpick__hint">
            Setting a location manually is useful when you are planning ahead for a
            different area.
          </p>
        )}
      </div>

      <Button variant="secondary" onClick={onClose} data-testid="location-picker-cancel">
        Cancel
      </Button>
    </BottomSheet>
  );
}
