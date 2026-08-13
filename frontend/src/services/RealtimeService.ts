import { io, type Socket } from 'socket.io-client';
import { REALTIME_ENABLED, SOCKET_URL } from '@/lib/api/config';
import { getAccessToken } from '@/lib/api/tokens';
import { toConfidence, toQueueRange } from '@/lib/api/mappers';
import type { Availability, Station } from '@/types';

// RealtimeService — Socket.IO station updates.
//
// One shared connection for the whole app, with per-station rooms so a client
// only receives traffic for what is currently on screen.

export interface StationUpdate {
  stationId: string;
  availability: Availability;
  queueMin: number | null;
  queueMax: number | null;
  waitMin: number | null;
  waitMax: number | null;
  pressureValue: number | null;
  pressureUnit: string;
  pressureStatus: string;
  activeDispensers: number | null;
  confidence: number;
  freshness: string;
  computedAt: string;
}

type Listener = (update: StationUpdate) => void;

let socket: Socket | null = null;
/** Station id → listeners. Doubles as the set of rooms we should be in. */
const listeners = new Map<string, Set<Listener>>();

function ensureSocket(): Socket | null {
  if (typeof window === 'undefined' || !REALTIME_ENABLED) return null;
  if (socket) return socket;

  socket = io(SOCKET_URL, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    // Station data is public, so a guest connection is valid; the token is
    // attached when present for future per-user channels.
    auth: { token: getAccessToken() ?? undefined },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    // Re-subscribe after a reconnect — rooms do not survive a dropped socket.
    for (const stationId of listeners.keys()) {
      socket?.emit('station:subscribe', stationId);
    }
  });

  socket.on('station:updated', (update: StationUpdate) => {
    listeners.get(update.stationId)?.forEach((listener) => listener(update));
  });

  return socket;
}

export const RealtimeService = {
  /**
   * Subscribes to one station. Returns an unsubscribe function; the room is
   * left only when the last listener for that station goes away.
   */
  subscribe(stationId: string, listener: Listener): () => void {
    const active = ensureSocket();

    let set = listeners.get(stationId);
    if (!set) {
      set = new Set();
      listeners.set(stationId, set);
      active?.emit('station:subscribe', stationId);
    }
    set.add(listener);

    return () => {
      const current = listeners.get(stationId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        listeners.delete(stationId);
        socket?.emit('station:unsubscribe', stationId);
      }
    };
  },

  /** Subscribes to several stations at once (e.g. a visible list). */
  subscribeMany(stationIds: string[], listener: Listener): () => void {
    const unsubscribes = stationIds.map((id) => this.subscribe(id, listener));
    return () => unsubscribes.forEach((fn) => fn());
  },

  /** Re-authenticates the socket after login/logout. */
  reconnect(): void {
    if (!socket) return;
    socket.disconnect();
    socket = null;
    // ensureSocket() re-reads the token and re-joins every active room.
    ensureSocket();
  },

  disconnect(): void {
    socket?.disconnect();
    socket = null;
    listeners.clear();
  },

  isConnected(): boolean {
    return socket?.connected ?? false;
  },
};

/**
 * Applies a realtime update to a Station already in UI state.
 *
 * Mirrors the REST mapper exactly, including the rule that null queue bounds
 * mean UNKNOWN rather than zero.
 */
export function applyStationUpdate(station: Station, update: StationUpdate): Station {
  return {
    ...station,
    availability: update.availability,
    queue: toQueueRange(update.queueMin, update.queueMax),
    wait:
      update.waitMin === null && update.waitMax === null
        ? null
        : {
            minMinutes: update.waitMin ?? update.waitMax ?? 0,
            maxMinutes: update.waitMax ?? update.waitMin ?? 0,
          },
    pressure: {
      value: update.pressureValue,
      unit: update.pressureUnit === 'BAR' ? 'bar' : update.pressureUnit.toLowerCase(),
      status: update.pressureStatus,
    },
    activeDispensers: update.activeDispensers,
    confidence: toConfidence(update.confidence, update.freshness),
    // A realtime update means a report just landed, so the inputs are current.
    lastUpdated: update.computedAt,
  };
}
