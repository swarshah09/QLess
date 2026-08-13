import { Router } from 'express';
import adminRoutes from './admin.routes';
import authRoutes from './auth.routes';
import docsRoutes from './docs.routes';
import healthRoutes from './health.routes';
import notificationRoutes from './notification.routes';
import stationRoutes from './station.routes';

/** Root of the v1 API. */
const router = Router();

router.use('/health', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/auth', authRoutes);
router.use('/stations', stationRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);

export default router;
