'use strict';

const { Router } = require('express');
const controller = require('../controllers/station.controller');
const {
  authenticate,
  optionalAuthenticate,
  requireOperator,
  requireStationAssignment,
} = require('../middleware/auth');
const { reportLimiter } = require('../middleware/rateLimit');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const V = require('../validators');

const router = Router();

/**
 * Route order matters: every literal segment must be declared before
 * `/:stationId`, or Express parses "nearby"/"saved"/"mine" as a station id.
 */

// --- Guest-accessible discovery ---
// optionalAuthenticate personalises the response (the `saved` flag) when a
// token is present but never rejects, so discovery works signed out.
router.get('/nearby', optionalAuthenticate, validate({ query: V.nearbyQuerySchema }), asyncHandler(controller.nearby));
router.get('/recommendations', optionalAuthenticate, validate({ query: V.recommendationQuerySchema }), asyncHandler(controller.recommendations));
router.get('/', optionalAuthenticate, validate({ query: V.listStationsQuerySchema }), asyncHandler(controller.list));

// --- Authenticated user ---
router.get('/saved', authenticate, validate({ query: V.savedStationsQuerySchema }), asyncHandler(controller.listSaved));
router.get('/visits', authenticate, validate({ query: V.pagination }), asyncHandler(controller.visitHistory));

// --- Operator ---
router.get('/mine', authenticate, requireOperator, asyncHandler(controller.listAssigned));

// --- Station detail (guest) ---
router.get('/:stationId', optionalAuthenticate, validate({ params: V.stationIdParam, query: V.stationDetailQuerySchema }), asyncHandler(controller.detail));
router.get('/:stationId/reports', optionalAuthenticate, validate({ params: V.stationIdParam, query: V.pagination }), asyncHandler(controller.reportHistory));
router.get('/:stationId/supply-events', optionalAuthenticate, validate({ params: V.stationIdParam, query: V.pagination }), asyncHandler(controller.listSupplyEvents));

// --- Crowd reporting (any authenticated user) ---
// Deliberately NOT gated on an operator assignment: normal users reporting what
// they can see is the platform's primary data source.
router.post(
  '/:stationId/reports',
  authenticate,
  reportLimiter,
  validate({ params: V.stationIdParam, body: V.submitReportSchema }),
  asyncHandler(controller.submitReport),
);

// --- Saved stations ---
router.post('/:stationId/save', authenticate, validate({ params: V.stationIdParam, body: V.saveStationSchema }), asyncHandler(controller.save));
router.delete('/:stationId/save', authenticate, validate({ params: V.stationIdParam }), asyncHandler(controller.unsave));

// --- Visits ("I'm Here") — proximity verified server-side ---
router.post('/:stationId/visits', authenticate, validate({ params: V.stationIdParam, body: V.checkInSchema }), asyncHandler(controller.checkIn));
router.patch('/:stationId/visits/:visitId/join-queue', authenticate, validate({ params: V.visitIdParam }), asyncHandler(controller.joinQueue));
// Ending a visit records only that it ended; the outcome must be stated.
router.patch('/:stationId/visits/:visitId/complete', authenticate, validate({ params: V.visitIdParam, body: V.completeVisitSchema }), asyncHandler(controller.completeVisit));

// --- Operator updates for an ASSIGNED station ---
// requireStationAssignment is what makes operator rights station-scoped.
router.patch(
  '/:stationId',
  authenticate,
  requireOperator,
  validate({ params: V.stationIdParam, body: V.updateStationConfigSchema }),
  requireStationAssignment('stationId'),
  asyncHandler(controller.updateStationConfig),
);
router.post(
  '/:stationId/operator-update',
  authenticate,
  requireOperator,
  validate({ params: V.stationIdParam, body: V.operatorUpdateSchema }),
  requireStationAssignment('stationId'),
  asyncHandler(controller.operatorUpdate),
);
router.post(
  '/:stationId/supply-events',
  authenticate,
  requireOperator,
  validate({ params: V.stationIdParam, body: V.supplyEventSchema }),
  requireStationAssignment('stationId'),
  asyncHandler(controller.createSupplyEvent),
);
router.patch(
  '/:stationId/supply-events/:eventId/close',
  authenticate,
  requireOperator,
  requireStationAssignment('stationId'),
  asyncHandler(controller.closeSupplyEvent),
);

module.exports = router;
