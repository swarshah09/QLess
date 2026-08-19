'use strict';

const { Router } = require('express');
const mongoose = require('mongoose');
const adminRoutes = require('./admin.routes');
const authRoutes = require('./auth.routes');
const notificationRoutes = require('./notification.routes');
const stationRoutes = require('./station.routes');
const { sendSuccess } = require('../utils/response');

const router = Router();

/** Liveness — always ok if the process is serving. */
router.get('/health', (_req, res) => sendSuccess(res, { status: 'ok' }));

/** Readiness — includes dependency reachability. */
router.get('/health/detailed', (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  sendSuccess(
    res,
    {
      status: connected ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      environment: process.env.NODE_ENV ?? 'development',
      timestamp: new Date().toISOString(),
      dependencies: { database: { status: connected ? 'up' : 'down' } },
    },
    connected ? 200 : 503,
  );
});

router.use('/auth', authRoutes);
router.use('/stations', stationRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
