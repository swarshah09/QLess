import type { CookieOptions, Request, Response } from 'express';
import { API_PREFIX } from '../config/constants';
import { env } from '../config/env';

/**
 * Refresh-token transport.
 *
 * The backend serves a browser PWA and, later, native Android/iOS clients, so
 * both transports are supported:
 *
 *   - Browsers get an httpOnly cookie, which JavaScript (and therefore XSS)
 *     cannot read.
 *   - Native clients read the token from the response body and store it in the
 *     platform keychain, where cookies are not a useful mechanism.
 *
 * The cookie is scoped to the auth routes so it is not attached to ordinary API
 * calls that have no use for it.
 */
export const REFRESH_COOKIE_NAME = 'qless_refresh_token';

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Requires HTTPS in production; relaxed locally so http://localhost works.
    secure: env.isProduction,
    // 'lax' still sends the cookie on top-level navigation while blocking the
    // cross-site POSTs that CSRF relies on.
    sameSite: 'lax',
    path: `${API_PREFIX}/auth`,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, cookieOptions());
}

export function clearRefreshCookie(res: Response): void {
  // Options other than maxAge must match the original for the clear to apply.
  const { maxAge: _maxAge, ...options } = cookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, options);
}

/**
 * Reads the refresh token from either transport. The body wins so a native
 * client's explicit token is never shadowed by a stale cookie.
 */
export function readRefreshToken(req: Request): string | undefined {
  const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
  if (fromBody) return fromBody;

  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[REFRESH_COOKIE_NAME];
}

/** Request metadata recorded on a session for auditing. */
export function authContextFrom(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 400),
  };
}
