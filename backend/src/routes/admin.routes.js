'use strict';

const { Router } = require('express');
const controller = require('../controllers/admin.controller');
const { authenticate, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const V = require('../validators');

const router = Router();

/**
 * Every admin route is gated here rather than per-route, so a new endpoint
 * added to this file cannot accidentally ship unguarded. Order matters:
 * authenticate yields 401 for anonymous callers, then requireAdmin yields 403.
 */
router.use(authenticate, requireAdmin);

// --- Users ---
router.get('/users', validate({ query: V.listUsersQuerySchema }), asyncHandler(controller.listUsers));
router.patch('/users/:userId/role', validate({ params: V.userIdParam, body: V.updateUserRoleSchema }), asyncHandler(controller.updateUserRole));
router.patch('/users/:userId/active', validate({ params: V.userIdParam, body: V.setUserActiveSchema }), asyncHandler(controller.setUserActive));

// --- Stations ---
router.get('/stations', validate({ query: V.adminStationsQuerySchema }), asyncHandler(controller.listStations));
router.post('/stations', validate({ body: V.createStationSchema }), asyncHandler(controller.createStation));
router.patch('/stations/:stationId', validate({ params: V.stationIdParam, body: V.updateStationAdminSchema }), asyncHandler(controller.updateStation));
// Enable/disable rather than delete: removing a station would orphan its
// historical reports, which must never be destroyed.
router.patch('/stations/:stationId/active', validate({ params: V.stationIdParam, body: V.setStationActiveSchema }), asyncHandler(controller.setStationActive));
// Manual override — the schema makes `reason` mandatory, and it is audited.
router.post('/stations/:stationId/override', validate({ params: V.stationIdParam, body: V.overrideStatusSchema }), asyncHandler(controller.overrideStatus));

// --- Operator assignments ---
router.get('/stations/:stationId/operators', validate({ params: V.stationIdParam }), asyncHandler(controller.listStationOperators));
router.post('/stations/:stationId/operators', validate({ params: V.stationIdParam, body: V.assignOperatorSchema }), asyncHandler(controller.assignOperator));
router.delete('/stations/:stationId/operators/:userId', validate({ params: V.revokeOperatorParams }), asyncHandler(controller.revokeOperator));

// --- Moderation and statistics ---
router.get('/reports/suspicious', validate({ query: V.suspiciousQuerySchema }), asyncHandler(controller.suspiciousReports));
router.get('/stats/reports', validate({ query: V.statsQuerySchema }), asyncHandler(controller.reportStats));
router.get('/stats/notifications', validate({ query: V.statsQuerySchema }), asyncHandler(controller.notificationStats));
router.get('/settings', asyncHandler(controller.settings));
router.get('/audit-logs', validate({ query: V.auditLogQuerySchema }), asyncHandler(controller.auditLogs));

module.exports = router;
