import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  createRuleSchema,
  historyQuerySchema,
  ruleIdParamSchema,
  subscribeSchema,
  unsubscribeSchema,
  updateRuleSchema,
} from '../validators/notification.validators';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Public: the client needs the VAPID public key before it can subscribe.
router.get('/vapid-public-key', asyncHandler(notificationController.vapidKey));

// Everything below acts on the caller's own data.
router.use(authenticate);

// --- Rules ---------------------------------------------------------------

router.get('/rules', asyncHandler(notificationController.listRules));

router.post(
  '/rules',
  validate({ body: createRuleSchema }),
  asyncHandler(notificationController.createRule),
);

router.patch(
  '/rules/:id',
  validate({ params: ruleIdParamSchema, body: updateRuleSchema }),
  asyncHandler(notificationController.updateRule),
);

router.delete(
  '/rules/:id',
  validate({ params: ruleIdParamSchema }),
  asyncHandler(notificationController.deleteRule),
);

// --- Push subscriptions (multiple devices per user) ----------------------

router.get('/subscriptions', asyncHandler(notificationController.listSubscriptions));

router.post(
  '/subscriptions',
  validate({ body: subscribeSchema }),
  asyncHandler(notificationController.subscribe),
);

router.delete(
  '/subscriptions',
  validate({ body: unsubscribeSchema }),
  asyncHandler(notificationController.unsubscribe),
);

// --- Delivery history ----------------------------------------------------

router.get(
  '/events',
  validate({ query: historyQuerySchema }),
  asyncHandler(notificationController.history),
);

export default router;
