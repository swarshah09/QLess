import type { Server as HttpServer } from 'node:http';
import type { StationStatus } from '@prisma/client';
import { Server as SocketServer, type Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { userRepository } from '../repositories/user.repository';
import { sessionRepository } from '../repositories/session.repository';
import { extractBearerToken, verifyAccessToken } from '../utils/tokens';
import {
  SOCKET_EVENTS,
  stationRoom,
  toStationUpdatedPayload,
  type StationUpdatedPayload,
} from './events';

/**
 * Realtime gateway.
 *
 * Behind an interface so services can emit without knowing whether a socket
 * server exists. In tests, seeds and CLI runs the no-op implementation is used
 * and emitting is simply a function call that does nothing — no conditional
 * checks scattered through the business logic.
 */
export interface RealtimeGateway {
  readonly enabled: boolean;
  emitStationUpdated(status: StationStatus): void;
  /** Subscriber count for a station. Diagnostics and tests. */
  roomSize(stationId: string): number;
  close(): Promise<void>;
}

export const noopGateway: RealtimeGateway = {
  enabled: false,
  emitStationUpdated: () => undefined,
  roomSize: () => 0,
  close: async () => undefined,
};

let gateway: RealtimeGateway = noopGateway;

export function getRealtimeGateway(): RealtimeGateway {
  return gateway;
}

export function setRealtimeGateway(next: RealtimeGateway): void {
  gateway = next;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Optional authentication for a socket connection.
 *
 * Station data is public, so an unauthenticated socket is allowed — the same
 * guest-access rule the REST discovery endpoints follow. A valid token simply
 * attaches identity for future per-user channels; an invalid one is treated as
 * a guest rather than rejected, so an expired token never breaks a live map.
 */
async function resolveSocketUser(socket: Socket): Promise<string | null> {
  const raw =
    (socket.handshake.auth?.token as string | undefined) ??
    socket.handshake.headers.authorization;

  const token = extractBearerToken(
    raw?.startsWith('Bearer ') ? raw : raw ? `Bearer ${raw}` : undefined,
  );
  if (!token) return null;

  const payload = verifyAccessToken(token);
  if (!payload) return null;

  const session = await sessionRepository.findById(payload.sid);
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  const user = await userRepository.findAuthContextById(payload.sub);
  if (!user || !user.active) return null;

  return user.id;
}

export function createRealtimeGateway(httpServer: HttpServer): RealtimeGateway {
  const io = new SocketServer(httpServer, {
    path: '/socket.io',
    cors: {
      origin: env.corsOrigins,
      credentials: true,
    },
    // Native clients may not support websockets everywhere; polling is the
    // fallback rather than a hard failure.
    transports: ['websocket', 'polling'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.on('connection', (socket) => {
    void (async () => {
      const userId = await resolveSocketUser(socket);
      socket.data.userId = userId;

      logger.debug({ socketId: socket.id, authenticated: userId !== null }, 'Socket connected');

      /**
       * Room-per-station subscription.
       *
       * A driver watching two stations should not receive traffic for the other
       * two hundred, so updates are never broadcast globally.
       */
      socket.on(SOCKET_EVENTS.SUBSCRIBE_STATION, (stationId: unknown) => {
        if (typeof stationId !== 'string' || !UUID_PATTERN.test(stationId)) {
          socket.emit(SOCKET_EVENTS.ERROR, { message: 'A valid stationId is required' });
          return;
        }

        void socket.join(stationRoom(stationId));
        socket.emit(SOCKET_EVENTS.SUBSCRIPTION_ACK, { stationId, subscribed: true });
      });

      socket.on(SOCKET_EVENTS.UNSUBSCRIBE_STATION, (stationId: unknown) => {
        if (typeof stationId !== 'string' || !UUID_PATTERN.test(stationId)) return;

        void socket.leave(stationRoom(stationId));
        socket.emit(SOCKET_EVENTS.SUBSCRIPTION_ACK, { stationId, subscribed: false });
      });
    })();
  });

  return {
    enabled: true,

    emitStationUpdated(status: StationStatus): void {
      const payload: StationUpdatedPayload = toStationUpdatedPayload(status);
      io.to(stationRoom(status.stationId)).emit(SOCKET_EVENTS.STATION_UPDATED, payload);
    },

    roomSize(stationId: string): number {
      return io.sockets.adapter.rooms.get(stationRoom(stationId))?.size ?? 0;
    },

    async close(): Promise<void> {
      await io.close();
    },
  };
}
