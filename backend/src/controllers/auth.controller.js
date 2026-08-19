'use strict';

const env = require('../config/env');
const authService = require('../services/auth.service');
const { API_PREFIX } = require('../config/constants');
const { ApiError } = require('../utils/ApiError');
const { sendCreated, sendSuccess } = require('../utils/response');

/**
 * Refresh-token transport.
 *
 * Browsers get an httpOnly cookie, which XSS cannot read. Native clients read
 * the token from the response body and store it in the platform keychain.
 * Both are supported; the body wins so an explicit token is never shadowed by
 * a stale cookie.
 */
const REFRESH_COOKIE = 'qless_refresh_token';

/** Options minus maxAge — clearCookie must match everything else exactly. */
const clearCookieOptions = () => {
  const options = cookieOptions();
  delete options.maxAge;
  return options;
};

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  // 'lax' still sends the cookie on top-level navigation while blocking the
  // cross-site POSTs that CSRF relies on.
  sameSite: 'lax',
  path: `${API_PREFIX}/auth`,
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
});

const readRefreshToken = (req) => req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE];

const authContext = (req) => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent')?.slice(0, 400),
});

module.exports = {
  async register(req, res) {
    const result = await authService.register(req.body, authContext(req));
    res.cookie(REFRESH_COOKIE, result.tokens.refreshToken, cookieOptions());
    sendCreated(res, result);
  },

  async login(req, res) {
    const result = await authService.login(req.body, authContext(req));
    res.cookie(REFRESH_COOKIE, result.tokens.refreshToken, cookieOptions());
    sendSuccess(res, result);
  },

  async refresh(req, res) {
    const refreshToken = readRefreshToken(req);
    if (!refreshToken) throw ApiError.unauthorized('Refresh token is required');

    const result = await authService.refresh(refreshToken, authContext(req));
    res.cookie(REFRESH_COOKIE, result.tokens.refreshToken, cookieOptions());
    sendSuccess(res, result);
  },

  /** Always reports success — logout is idempotent, and erroring would leak whether the token was real. */
  async logout(req, res) {
    await authService.logout(readRefreshToken(req), req.sessionId);
    res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
    sendSuccess(res, { loggedOut: true });
  },

  async logoutAll(req, res) {
    const revokedSessions = await authService.logoutAll(req.user.id);
    res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
    sendSuccess(res, { loggedOut: true, revokedSessions });
  },

  async me(req, res) {
    sendSuccess(res, { user: await authService.getProfile(req.user.id) });
  },
};
