import { Router } from 'express';
import { discoveryController } from '../controllers/discovery.controller';
import {
  operatorController,
  reportController,
  savedStationController,
} from '../controllers/report.controller';
import { stationController } from '../controllers/station.controller';
import {
  recommendationController,
  visitController,
} from '../controllers/visit.controller';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate';
import { requireOperator, requireStationAssignment } from '../middleware/authorize';
import { reportRateLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import {
  listStationsQuerySchema,
  stationIdParamSchema,
  updateStationSchema,
} from '../validators/station.validators';
import {
  nearbyQuerySchema,
  operatorUpdateSchema,
  reportHistoryQuerySchema,
  saveStationSchema,
  savedStationsQuerySchema,
  stationDetailQuerySchema,
  submitReportSchema,
  supplyEventListQuerySchema,
  supplyEventParamsSchema,
  supplyEventSchema,
} from '../validators/report.validators';
import {
  checkInSchema,
  completeVisitSchema,
  recommendationQuerySchema,
  visitHistoryQuerySchema,
  visitIdParamSchema,
} from '../validators/visit.validators';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

/**
 * Route order matters throughout this file: every literal path segment must be
 * declared before `/:stationId`, or Express will try to parse "nearby",
 * "mine" and "saved" as station ids.
 */

// --- Guest-accessible discovery -------------------------------------------
// `optionalAuthenticate` personalises the response (the `saved` flag) when a
// token is present but never rejects, so discovery works signed out.

router.get(
  '/nearby',
  optionalAuthenticate,
  validate({ query: nearbyQuerySchema }),
  asyncHandler(discoveryController.nearby),
);

// Recommendation returns the SAME nearest-first list plus separate
// recommendation metadata — it never reorders the stations.
router.get(
  '/recommendations',
  optionalAuthenticate,
  validate({ query: recommendationQuerySchema }),
  asyncHandler(recommendationController.recommend),
);

router.get(
  '/',
  optionalAuthenticate,
  validate({ query: listStationsQuerySchema }),
  asyncHandler(stationController.list),
);

// --- Saved stations (authenticated user) ----------------------------------

router.get(
  '/saved',
  authenticate,
  validate({ query: savedStationsQuerySchema }),
  asyncHandler(savedStationController.list),
);

router.get(
  '/visits',
  authenticate,
  validate({ query: visitHistoryQuerySchema }),
  asyncHandler(visitController.history),
);

// --- Operator ---------------------------------------------------------------

router.get('/mine', authenticate, requireOperator, asyncHandler(stationController.listMine));

// --- Station detail (guest) -------------------------------------------------

router.get(
  '/:stationId',
  optionalAuthenticate,
  validate({ params: stationIdParamSchema, query: stationDetailQuerySchema }),
  asyncHandler(discoveryController.detail),
);

router.get(
  '/:stationId/reports',
  optionalAuthenticate,
  validate({ params: stationIdParamSchema, query: reportHistoryQuerySchema }),
  asyncHandler(reportController.history),
);

router.get(
  '/:stationId/supply-events',
  optionalAuthenticate,
  validate({ params: stationIdParamSchema, query: supplyEventListQuerySchema }),
  asyncHandler(operatorController.listSupplyEvents),
);

// --- Crowd reporting (any authenticated user) -------------------------------
// Deliberately NOT gated on an operator assignment: normal users reporting
// what they can see is the platform's primary data source.

router.post(
  '/:stationId/reports',
  authenticate,
  reportRateLimiter,
  validate({ params: stationIdParamSchema, body: submitReportSchema }),
  asyncHandler(reportController.submit),
);

// --- Station visits ("I'm Here") --------------------------------------------
// Proximity is verified server-side from the submitted coordinates.

router.post(
  '/:stationId/visits',
  authenticate,
  validate({ params: stationIdParamSchema, body: checkInSchema }),
  asyncHandler(visitController.checkIn),
);

router.patch(
  '/:stationId/visits/:visitId/join-queue',
  authenticate,
  validate({ params: visitIdParamSchema }),
  asyncHandler(visitController.joinQueue),
);

// Ending a visit records only that it ended; the outcome must be stated
// explicitly and defaults to UNKNOWN.
router.patch(
  '/:stationId/visits/:visitId/complete',
  authenticate,
  validate({ params: visitIdParamSchema, body: completeVisitSchema }),
  asyncHandler(visitController.complete),
);

// --- Saved stations, per station --------------------------------------------

router.post(
  '/:stationId/save',
  authenticate,
  validate({ params: stationIdParamSchema, body: saveStationSchema }),
  asyncHandler(savedStationController.save),
);

router.delete(
  '/:stationId/save',
  authenticate,
  validate({ params: stationIdParamSchema }),
  asyncHandler(savedStationController.unsave),
);

// --- Operator updates for an ASSIGNED station -------------------------------
// `requireStationAssignment` is what makes an operator's rights station-scoped;
// without it an operator could update any station in the platform.

router.patch(
  '/:stationId',
  authenticate,
  requireOperator,
  validate({ params: stationIdParamSchema, body: updateStationSchema }),
  requireStationAssignment('stationId'),
  asyncHandler(stationController.update),
);

router.post(
  '/:stationId/operator-update',
  authenticate,
  requireOperator,
  validate({ params: stationIdParamSchema, body: operatorUpdateSchema }),
  requireStationAssignment('stationId'),
  asyncHandler(operatorController.update),
);

router.post(
  '/:stationId/supply-events',
  authenticate,
  requireOperator,
  validate({ params: stationIdParamSchema, body: supplyEventSchema }),
  requireStationAssignment('stationId'),
  asyncHandler(operatorController.createSupplyEvent),
);

router.patch(
  '/:stationId/supply-events/:eventId/close',
  authenticate,
  requireOperator,
  validate({ params: supplyEventParamsSchema }),
  requireStationAssignment('stationId'),
  asyncHandler(operatorController.closeSupplyEvent),
);

export default router;
