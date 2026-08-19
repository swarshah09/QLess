'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocationService } from '@/services/LocationService';
import { distanceFrom } from '@/lib/geo';
import type { Coordinates } from '@/types';

/**
 * Live GPS tracking, scoped to the component that mounts it.
 *
 * The watch starts on mount and is cleared on unmount, so tracking runs only
 * while the map is on screen — an app-wide watch would keep the GPS radio
 * active on every screen and drain the battery for no benefit.
 */

export interface LiveLocationState {
  coords: Coordinates | null;
  accuracyM: number | null;
  /** Whether a watch is currently running. */
  tracking: boolean;
  error: 'denied' | 'unavailable' | 'timeout' | null;
}

interface Options {
  /** Start watching immediately on mount. */
  enabled?: boolean;
  /**
   * Movement in metres before `onMove` fires. Raw GPS jitters by several metres
   * while stationary; without this threshold a parked user would trigger a
   * station refetch every couple of seconds.
   */
  minMoveMeters?: number;
  /** Called when the user has genuinely moved. */
  onMove?: (coords: Coordinates) => void;
}

export function useLiveLocation({
  enabled = true,
  minMoveMeters = 150,
  onMove,
}: Options = {}): LiveLocationState & { start: () => void; stop: () => void } {
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState<LiveLocationState['error']>(null);

  const stopRef = useRef<(() => void) | null>(null);
  /** Last position that triggered onMove — the baseline for the threshold. */
  const lastNotifiedRef = useRef<Coordinates | null>(null);
  // Held in a ref so a changing callback identity does not restart the watch.
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setTracking(false);
  }, []);

  const start = useCallback(() => {
    // Guard against double-starts leaving an orphaned watch behind.
    if (stopRef.current) return;

    setError(null);
    setTracking(true);

    stopRef.current = LocationService.watchPosition(
      (next, accuracy) => {
        setCoords(next);
        setAccuracyM(accuracy);

        const previous = lastNotifiedRef.current;
        const movedFar =
          !previous ||
          distanceFrom(previous, next.lat, next.lng) * 1000 >= minMoveMeters;

        if (movedFar) {
          lastNotifiedRef.current = next;
          onMoveRef.current?.(next);
        }
      },
      (reason) => {
        setError(reason);
        // A denied permission will not resolve by waiting, so stop cleanly
        // rather than leaving a dead watch registered.
        if (reason === 'denied') stop();
      },
    );
  }, [minMoveMeters, stop]);

  useEffect(() => {
    if (enabled) start();
    // Always clear on unmount, whatever the enabled state was.
    return () => stop();
  }, [enabled, start, stop]);

  return { coords, accuracyM, tracking, error, start, stop };
}
