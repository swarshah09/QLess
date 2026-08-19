'use strict';

const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimit');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { loginSchema, refreshSchema, registerSchema } = require('../validators');

const router = Router();

// --- Public ---
router.post('/register', registerLimiter, validate({ body: registerSchema }), asyncHandler(controller.register));
router.post('/login', loginLimiter, validate({ body: loginSchema }), asyncHandler(controller.login));

// Not authenticate-guarded: the point is to be callable once the access token
// has expired. The refresh token itself is the credential.
router.post('/refresh', validate({ body: refreshSchema }), asyncHandler(controller.refresh));

// Unauthenticated so a client holding only an expired access token can still
// invalidate its refresh token rather than leaving a live session behind.
router.post('/logout', validate({ body: refreshSchema }), asyncHandler(controller.logout));

// --- Authenticated ---
router.get('/me', authenticate, asyncHandler(controller.me));
router.post('/logout-all', authenticate, asyncHandler(controller.logoutAll));

module.exports = router;
