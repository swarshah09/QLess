import { Router } from 'express';
import {
  adminController,
  adminStationController,
} from '../controllers/admin.controller';
import { authenticate } from '../middleware/authenticate';
import { requireAdmin } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  auditLogFilterSchema,
  createStationSchema,
  listStationsAdminQuerySchema,
  overrideStatusSchema,
  setStationActiveSchema,
  statsQuerySchema,
  suspiciousReportsQuerySchema,
  updateStationAdminSchema,
  assignOperatorParamsSchema,
  assignOperatorSchema,
  listUsersQuerySchema,
  revokeOperatorParamsSchema,
  setUserActiveSchema,
  stationIdParamSchema,
  updateUserRoleSchema,
  userIdParamSchema,
} from '../validators/admin.validators';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

/**
 * Every admin route is gated here rather than per-route, so a new endpoint
 * added to this file cannot accidentally ship unguarded.
 *
 * Order matters: `authenticate` yields 401 for anonymous callers, then
 * `requireAdmin` yields 403 for authenticated non-admins.
 */
router.use(authenticate, requireAdmin);

// --- Users ---------------------------------------------------------------

router.get('/users', validate({ query: listUsersQuerySchema }), asyncHandler(adminController.listUsers));

router.patch(
  '/users/:userId/role',
  validate({ params: userIdParamSchema, body: updateUserRoleSchema }),
  asyncHandler(adminController.updateUserRole),
);

router.patch(
  '/users/:userId/active',
  validate({ params: userIdParamSchema, body: setUserActiveSchema }),
  asyncHandler(adminController.setUserActive),
);

// --- Station CRUD ---------------------------------------------------------

router.get(
  '/stations',
  validate({ query: listStationsAdminQuerySchema }),
  asyncHandler(adminStationController.listStations),
);

router.post(
  '/stations',
  validate({ body: createStationSchema }),
  asyncHandler(adminStationController.createStation),
);

router.patch(
  '/stations/:stationId',
  validate({ params: stationIdParamSchema, body: updateStationAdminSchema }),
  asyncHandler(adminStationController.updateStation),
);

// Enable/disable rather than delete: removing a station would orphan its
// historical reports, which must never be destroyed.
router.patch(
  '/stations/:stationId/active',
  validate({ params: stationIdParamSchema, body: setStationActiveSchema }),
  asyncHandler(adminStationController.setStationActive),
);

// Manual override. The schema makes `reason` mandatory, and the action is
// audited with admin identity and timestamp.
router.post(
  '/stations/:stationId/override',
  validate({ params: stationIdParamSchema, body: overrideStatusSchema }),
  asyncHandler(adminStationController.overrideStatus),
);

// --- Moderation and statistics --------------------------------------------

router.get(
  '/reports/suspicious',
  validate({ query: suspiciousReportsQuerySchema }),
  asyncHandler(adminStationController.suspiciousReports),
);

router.get(
  '/stats/reports',
  validate({ query: statsQuerySchema }),
  asyncHandler(adminStationController.reportStats),
);

router.get(
  '/stats/notifications',
  validate({ query: statsQuerySchema }),
  asyncHandler(adminStationController.notificationStats),
);

router.get('/settings', asyncHandler(adminStationController.platformSettings));

// --- Operator-station assignments ----------------------------------------

router.get(
  '/stations/:stationId/operators',
  validate({ params: stationIdParamSchema }),
  asyncHandler(adminController.listStationOperators),
);

router.post(
  '/stations/:stationId/operators',
  validate({ params: assignOperatorParamsSchema, body: assignOperatorSchema }),
  asyncHandler(adminController.assignOperator),
);

router.delete(
  '/stations/:stationId/operators/:userId',
  validate({ params: revokeOperatorParamsSchema }),
  asyncHandler(adminController.revokeOperator),
);

// --- Audit ---------------------------------------------------------------

router.get(
  '/audit-logs',
  validate({ query: auditLogFilterSchema }),
  asyncHandler(adminController.listAuditLogs),
);

export default router;
