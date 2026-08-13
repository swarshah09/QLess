import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import {
  loginRateLimiter,
  refreshRateLimiter,
  registerRateLimiter,
} from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from '../validators/auth.validators';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// --- Public ---------------------------------------------------------------

router.post(
  '/register',
  registerRateLimiter,
  validate({ body: registerSchema }),
  asyncHandler(authController.register),
);

router.post(
  '/login',
  loginRateLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login),
);

// Not `authenticate`-guarded: the whole point is to be callable once the
// access token has expired. The refresh token itself is the credential.
router.post(
  '/refresh',
  refreshRateLimiter,
  validate({ body: refreshSchema }),
  asyncHandler(authController.refresh),
);

// Unauthenticated so a client holding only an expired access token can still
// invalidate its refresh token rather than leaving a live session behind.
router.post('/logout', validate({ body: logoutSchema }), asyncHandler(authController.logout));

// --- Authenticated --------------------------------------------------------

router.get('/me', authenticate, asyncHandler(authController.me));

router.post('/logout-all', authenticate, asyncHandler(authController.logoutAll));

export default router;
