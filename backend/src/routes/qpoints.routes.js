'use strict';

const { Router } = require('express');
const controller = require('../controllers/qpoints.controller');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const V = require('../validators');

const router = Router();

// Guests have no QPoints by design — always authenticated.
router.get('/me', authenticate, validate({ query: V.pagination }), asyncHandler(controller.myTotal));

module.exports = router;
