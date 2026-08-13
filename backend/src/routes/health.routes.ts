import { Router } from 'express';
import { healthController } from '../controllers/health.controller';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// GET /api/v1/health -> { success: true, data: { status: "ok" } }
router.get('/', healthController.getHealth);

// Readiness probe including dependency checks.
router.get('/detailed', asyncHandler(healthController.getDetailedHealth));

export default router;
