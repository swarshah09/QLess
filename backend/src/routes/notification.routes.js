'use strict';

const { Router } = require('express');
const controller = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const V = require('../validators');

const router = Router();

// Public: the client needs the VAPID key before it can subscribe.
router.get('/vapid-public-key', asyncHandler(controller.vapidKey));

// Everything below acts on the caller's own data.
router.use(authenticate);

router.get('/rules', asyncHandler(controller.listRules));
router.post('/rules', validate({ body: V.createRuleSchema }), asyncHandler(controller.createRule));
router.patch('/rules/:id', validate({ params: V.idParam, body: V.updateRuleSchema }), asyncHandler(controller.updateRule));
router.delete('/rules/:id', validate({ params: V.idParam }), asyncHandler(controller.deleteRule));

// Multiple devices per user.
router.get('/subscriptions', asyncHandler(controller.listSubscriptions));
router.post('/subscriptions', validate({ body: V.subscribeSchema }), asyncHandler(controller.subscribe));
router.delete('/subscriptions', validate({ body: V.unsubscribeSchema }), asyncHandler(controller.unsubscribe));

router.get('/events', validate({ query: V.pagination }), asyncHandler(controller.listEvents));

module.exports = router;
