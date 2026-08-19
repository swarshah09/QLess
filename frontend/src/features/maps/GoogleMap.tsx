'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Loader2 } from 'lucide-react';
import type { Coordinates, PlaceBounds, Station } from '@/types';
import { getMarkerTone, type MarkerTone } from '@/lib/status';
import { loadGoogleMaps } from '@/lib/googleMaps';
import { DEFAULT_MAP_CENTER } from '@/lib/api/config';
import { StationPreview } from './StationPreview';

interface Props {
  stations: Station[];
  /** Live user position; drives the "you are here" dot and recentre button. */
  userCoords: Coordinates | null;
  onNotify: (s: Station) => void;
  onNavigate: (s: Station) => void;
  /** Rendered when the SDK cannot load, so the screen is never blank. */
  fallback: React.ReactNode;
  /**
   * Extent of a manually chosen area. When set, it is outlined on the map and
   * the viewport is fitted to it, so the user can see exactly which region the
   * listed stations belong to.
   */
  area?: PlaceBounds | null;
}

/** Marker colours mirror the status tones used across the app. */
const TONE_COLOR: Record<MarkerTone, string> = {
  good: '#059669',
  moderate: '#d97706',
  busy: '#dc2626',
  unavailable: '#6b7280',
  unknown: '#94a3b8',
};

/** Users who ask for less motion get the end state immediately, never the drop. */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A teardrop station pin.
 *
 * Two nested elements on purpose: the OUTER node hosts the one-time entrance
 * animation (translate/opacity) and the INNER node hosts the selection scale.
 * Sharing one element would make the two transforms overwrite each other, so a
 * pin would snap back to its pre-drop offset the moment it was selected.
 */
function buildPin(tone: MarkerTone, selected: boolean): HTMLElement {
  const outer = document.createElement('div');
  outer.style.cssText = 'cursor:pointer;will-change:transform,opacity';

  const inner = document.createElement('div');
  inner.style.cssText = [
    'transform-origin:50% 100%',
    // Eased both ways so selecting and deselecting feel equally deliberate.
    'transition:transform .18s cubic-bezier(.34,1.56,.64,1)',
    'filter:drop-shadow(0 3px 5px rgba(0,0,0,.32))',
  ].join(';');
  inner.innerHTML = pinSvg(tone);

  outer.appendChild(inner);
  applyPinState(outer, tone, selected);
  return outer;
}

/**
 * The pin artwork: colour-filled teardrop, white ring, fuel-pump mark.
 *
 * The pump glyph identifies the category at a glance and reads better than a
 * bare character; STATUS is carried by the fill colour, and the exact figures
 * live in the preview card that opens on tap. A station with no reports is grey
 * — the same "we don't know" the list conveys, without inventing a reading.
 */
function pinSvg(tone: MarkerTone): string {
  const color = TONE_COLOR[tone];
  return `
    <svg width="32" height="42" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 0.9C5.9 0.9 1 5.8 1 11.9c0 8.2 11 19.2 11 19.2s11-11 11-19.2C23 5.8 18.1 0.9 12 0.9z"
        fill="${color}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" />
      <circle cx="12" cy="11.9" r="6.6" fill="#fff" />
      <g transform="translate(12 11.9) scale(0.44) translate(-12 -12)"
         fill="none" stroke="${color}" stroke-width="2.6"
         stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
        <path d="M3 21h12" />
        <path d="M5 10h8" />
        <path d="M14 12h2.5a1.5 1.5 0 0 1 1.5 1.5V16a1.8 1.8 0 0 0 3.6 0V9.6L18.6 6.6" />
      </g>
    </svg>`;
}

/**
 * Applies tone and selection to an EXISTING pin.
 *
 * Mutating beats rebuilding here: replacing the node on every status change or
 * selection would restart the entrance animation and make the whole map flicker
 * each time the station list refreshes.
 */
function applyPinState(pin: HTMLElement, tone: MarkerTone, selected: boolean): void {
  const inner = pin.firstElementChild as HTMLElement | null;
  if (!inner) return;

  if (inner.dataset.tone !== tone) {
    inner.innerHTML = pinSvg(tone);
    inner.dataset.tone = tone;
  }
  inner.style.transform = selected ? 'scale(1.28)' : 'scale(1)';
  // Lift the active pin above its neighbours so the selected one is never
  // half-hidden behind a closer marker.
  pin.style.zIndex = selected ? '10' : '1';
}

/**
 * One-time drop-in, played only when a pin is first added to the map.
 *
 * Uses the Web Animations API rather than CSS keyframes: it needs no injected
 * stylesheet, and `fill: 'none'` leaves the element on its own styles once the
 * animation ends, so the selection transform stays authoritative afterwards.
 */
function playDropIn(pin: HTMLElement, order: number): void {
  if (prefersReducedMotion() || typeof pin.animate !== 'function') return;

  // Cascade the pins, but cap the total so a dense map still settles quickly.
  const delay = Math.min(order * 45, 500);

  pin.animate(
    [
      { opacity: 0, transform: 'translateY(-16px) scale(.6)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ],
    { duration: 420, delay, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'none' },
  );
}

function buildUserDot(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'width:18px;height:18px;border-radius:50%;background:#2563eb;' +
    'border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)';
  return wrap;
}

export function GoogleMap({ stations, userCoords, onNotify, onNavigate, fallback, area }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const userMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  /** True once the user has been centred, so we do not fight their panning. */
  const centredRef = useRef(false);
  const areaRef = useRef<google.maps.Rectangle | null>(null);
  /** Identifies the area we last fitted, so fitBounds runs once per selection. */
  const areaFittedRef = useRef<string | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [selected, setSelected] = useState<Station | null>(null);

  // --- Load the SDK and create the map once -------------------------------
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current || mapRef.current) return;

        // The marker library is required for every pin drawn below. If it is
        // somehow absent, fail over to the fallback map rather than letting an
        // AdvancedMarkerElement constructor throw and take down the page.
        if (!google.maps.marker?.AdvancedMarkerElement) {
          throw new Error('Google Maps "marker" library is unavailable');
        }

        mapRef.current = new google.maps.Map(containerRef.current, {
          center: userCoords
            ? { lat: userCoords.lat, lng: userCoords.lng }
            : DEFAULT_MAP_CENTER,
          zoom: 13,
          // A Map ID is required for AdvancedMarkerElement; DEMO_MAP_ID works
          // without cloud styling and avoids an extra setup step.
          mapId: 'DEMO_MAP_ID',
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
        });

        // Tapping empty map dismisses the station preview.
        mapRef.current.addListener('click', () => setSelected(null));

        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });

    return () => {
      cancelled = true;
    };
    // Deliberately runs once: re-creating the map on every coord change would
    // reset the user's pan and zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Sync station markers ------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;

    const seen = new Set<string>();
    // Counts only pins created in THIS pass, so the cascade starts at zero for a
    // batch of new stations instead of inheriting the full list's index.
    let entering = 0;

    for (const station of stations) {
      seen.add(station.id);
      const tone = getMarkerTone(station);
      const isSelected = selected?.id === station.id;

      let marker = markersRef.current.get(station.id);

      if (!marker) {
        const pin = buildPin(tone, isSelected);
        marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: station.lat, lng: station.lng },
          title: station.name,
          content: pin,
        });
        marker.addListener('click', () => setSelected(station));
        markersRef.current.set(station.id, marker);
        // Entrance plays once, here at creation only.
        playDropIn(pin, entering);
        entering += 1;
      } else {
        // Reuse the marker AND its DOM node: assigning a fresh `content` would
        // replay the drop-in every time the list refreshes or a pin is tapped.
        marker.position = { lat: station.lat, lng: station.lng };
        const pin = marker.content as HTMLElement | null;
        if (pin) applyPinState(pin, tone, isSelected);
      }
    }

    // Remove markers for stations no longer in range.
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.map = null;
        markersRef.current.delete(id);
      }
    }
  }, [stations, selected, status]);

  // --- Outline the manually selected area ---------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;

    // No manual area (or back on GPS): remove any outline still on the map.
    if (!area) {
      areaRef.current?.setMap(null);
      areaRef.current = null;
      areaFittedRef.current = null;
      return;
    }

    const bounds = {
      north: area.north,
      south: area.south,
      east: area.east,
      west: area.west,
    };

    if (!areaRef.current) {
      areaRef.current = new google.maps.Rectangle({
        map,
        bounds,
        strokeColor: '#dc2626',
        strokeOpacity: 0.95,
        strokeWeight: 2,
        // A faint wash reads as "this region" without hiding the streets or
        // muting the station pins inside it.
        fillColor: '#dc2626',
        fillOpacity: 0.06,
        clickable: false,
      });
    } else {
      areaRef.current.setBounds(bounds);
    }

    // Fit once per distinct area, so the user stays in control of the viewport
    // afterwards and panning is not undone on every re-render.
    const key = `${area.north},${area.south},${area.east},${area.west}`;
    if (areaFittedRef.current !== key) {
      map.fitBounds(bounds, 32);
      areaFittedRef.current = key;
      // The area is now the subject; do not yank the camera back to the user.
      centredRef.current = true;
    }
  }, [area, status]);

  // --- Sync the live user dot ---------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || !userCoords) return;

    const position = { lat: userCoords.lat, lng: userCoords.lng };

    if (!userMarkerRef.current) {
      userMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({
        map,
        position,
        title: 'You are here',
        content: buildUserDot(),
        zIndex: 999,
      });
    } else {
      userMarkerRef.current.position = position;
    }

    // Centre only on the first fix — afterwards the user controls the viewport.
    if (!centredRef.current) {
      map.setCenter(position);
      centredRef.current = true;
    }
  }, [userCoords, status]);

  // Clean up markers on unmount so detached DOM nodes are not retained.
  useEffect(
    () => () => {
      markersRef.current.forEach((m) => {
        m.map = null;
      });
      markersRef.current.clear();
      if (userMarkerRef.current) userMarkerRef.current.map = null;
      if (areaRef.current) areaRef.current.setMap(null);
    },
    [],
  );

  const recentre = () => {
    if (mapRef.current && userCoords) {
      mapRef.current.panTo({ lat: userCoords.lat, lng: userCoords.lng });
      mapRef.current.setZoom(15);
    }
  };

  const preview = useMemo(() => selected, [selected]);

  // Falls back rather than showing a blank frame when the key is missing or
  // the SDK is blocked.
  if (status === 'failed') return <>{fallback}</>;

  return (
    <div className="gmap" data-testid="google-map">
      <div ref={containerRef} className="gmap__canvas" />

      {status === 'loading' && (
        <div className="gmap__overlay">
          <Loader2 size={22} className="spin" />
          <span>Loading map…</span>
        </div>
      )}

      {userCoords && status === 'ready' && (
        <button
          type="button"
          className="gmap__recentre"
          onClick={recentre}
          aria-label="Centre on my location"
          data-testid="map-recentre"
        >
          <Crosshair size={20} />
        </button>
      )}

      {preview && (
        <div className="gmap__preview">
          <StationPreview
            station={preview}
            onNotify={() => onNotify(preview)}
            onNavigate={() => onNavigate(preview)}
          />
        </div>
      )}
    </div>
  );
}
