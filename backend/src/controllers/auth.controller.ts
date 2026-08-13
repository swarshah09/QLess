import type { Request, Response } from 'express';
import { AppError } from '../errors/AppError';
import { authService } from '../services/auth/auth.service';
import {
  authContextFrom,
  clearRefreshCookie,
  readRefreshToken,
  setRefreshCookie,
} from '../utils/authCookies';
import { sendCreated, sendSuccess } from '../utils/apiResponse';

export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    const result = await authService.register(req.body, authContextFrom(req));
    setRefreshCookie(res, result.tokens.refreshToken);
    sendCreated(res, result);
  },

  async login(req: Request, res: Response): Promise<void> {
    const result = await authService.login(req.body, authContextFrom(req));
    setRefreshCookie(res, result.tokens.refreshToken);
    sendSuccess(res, result);
  },

  async refresh(req: Request, res: Response): Promise<void> {
    const refreshToken = readRefreshToken(req);
    if (!refreshToken) {
      throw AppError.unauthorized('Refresh token is required');
    }

    const result = await authService.refresh(refreshToken, authContextFrom(req));
    setRefreshCookie(res, result.tokens.refreshToken);
    sendSuccess(res, result);
  },

  /**
   * Always reports success. Logout is idempotent, and telling a caller their
   * token was already invalid would leak information for no benefit.
   */
  async logout(req: Request, res: Response): Promise<void> {
    await authService.logout(readRefreshToken(req), req.sessionId);
    clearRefreshCookie(res);
    sendSuccess(res, { loggedOut: true });
  },

  async logoutAll(req: Request, res: Response): Promise<void> {
    const revokedSessions = await authService.logoutAll(req.user!.id);
    clearRefreshCookie(res);
    sendSuccess(res, { loggedOut: true, revokedSessions });
  },

  async me(req: Request, res: Response): Promise<void> {
    const user = await authService.getProfile(req.user!.id);
    sendSuccess(res, { user });
  },
};
