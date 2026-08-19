'use strict';

const { Server } = require('socket.io');
const env = require('../config/env');
const logger = require('../config/logger');

/**
 * Socket.IO realtime gateway.
 *
 * Kept behind this module so services can emit without knowing whether a socket
 * server exists — in tests, seeds and CLI runs `emitStationUpdated` is simply a
 * no-op, rather than every caller needing a conditional.
 */

const EVENTS = {
  SUBSCRIBE: 'station:subscribe',
  UNSUBSCRIBE: 'station:unsubscribe',
  UPDATED: 'station:updated',
  ACK: 'station:subscription',
  ERROR: 'error',
};

/** One room per station, so a client only receives what it asked for. */
const roomFor = (stationId) => `station:${stationId}`;

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

let io = null;

/** Flattened status payload, mirroring the REST shape so clients can apply it directly. */
function toPayload(station) {
  const s = station.status ?? {};
  return {
    stationId: String(station._id),
    availability: s.availability ?? 'UNKNOWN',
    // Null stays null — an unknown queue is never emitted as zero.
    queueMin: s.queueMin ?? null,
    queueMax: s.queueMax ?? null,
    waitMin: s.waitMin ?? null,
    waitMax: s.waitMax ?? null,
    pressureValue: s.pressureValue ?? null,
    pressureUnit: s.pressureUnit ?? 'BAR',
    pressureStatus: s.pressureStatus ?? 'UNKNOWN',
    activeDispensers: s.activeDispensers ?? null,
    confidence: s.confidence ?? 0,
    freshness: s.freshness ?? 'UNKNOWN',
    computedAt: s.computedAt ? new Date(s.computedAt).toISOString() : null,
  };
}

function attach(httpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: env.corsOrigins, credentials: true },
    // Native clients may not support websockets everywhere.
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.on('connection', (socket) => {
    // Station data is public, so an unauthenticated socket is valid — the same
    // guest-access rule the REST discovery endpoints follow.
    logger.debug('Socket connected', { socketId: socket.id });

    socket.on(EVENTS.SUBSCRIBE, (stationId) => {
      if (typeof stationId !== 'string' || !OBJECT_ID.test(stationId)) {
        socket.emit(EVENTS.ERROR, { message: 'A valid stationId is required' });
        return;
      }
      socket.join(roomFor(stationId));
      socket.emit(EVENTS.ACK, { stationId, subscribed: true });
    });

    socket.on(EVENTS.UNSUBSCRIBE, (stationId) => {
      if (typeof stationId !== 'string' || !OBJECT_ID.test(stationId)) return;
      socket.leave(roomFor(stationId));
      socket.emit(EVENTS.ACK, { stationId, subscribed: false });
    });
  });

  logger.info('Realtime gateway attached', { path: '/socket.io' });
  return io;
}

/** Broadcasts to that station's room only — never a global emit. */
function emitStationUpdated(station) {
  if (!io || !station) return;
  io.to(roomFor(String(station._id))).emit(EVENTS.UPDATED, toPayload(station));
}

function roomSize(stationId) {
  return io?.sockets.adapter.rooms.get(roomFor(stationId))?.size ?? 0;
}

async function close() {
  if (!io) return;
  await io.close();
  io = null;
}

module.exports = { attach, emitStationUpdated, roomSize, close, EVENTS, toPayload };
