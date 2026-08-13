import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';
import { AppError } from '../errors/AppError';
import { sessionRepository } from '../repositories/session.repository';
import { userRepository } from '../repositories/user.repository';
import { extractBearerToken, verifyAccessToken } from '../utils/tokens';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Resolves the caller from an access token.
 *
 * Returns null for anything less than a fully valid, live principal. The role
 * is read from the DATABASE, never from the token claim, so revoking an
 * operator's rights takes effect on their very next request instead of when
 * their access token happens to expire.
 */
async function resolvePrincipal(req: Request): Promise<
  { user: NonNullable<Request['user']>; sessionId: string } | null
> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) return null;

  const payload = verifyAccessToken(token);
  if (!payload) return null;

  // The session behind this token may have been revoked by a logout since it
  // was issued; a stateless JWT check alone would miss that.
  const session = await sessionRepository.findById(payload.sid);
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }

  const user = await userRepository.findAuthContextById(payload.sub);
  if (!user || !user.active) return null;

  if (user.role !== payload.role) {
    // Not an attack — the role changed after the token was minted. The
    // database value wins.
    logger.info(
      { userId: user.id, tokenRole: payload.role, currentRole: user.role },
      'Access token role is stale; using the stored role',
    );
  }

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    sessionId: session.id,
  };
}

/**
 * Requires a valid access token. Rejects with 401 otherwise.
 * Attach to every route that acts on behalf of a user.
 */
export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const principal = await resolvePrincipal(req);

    if (!principal) {
      throw AppError.unauthorized('Authentication required');
    }

    req.user = principal.user;
    req.sessionId = principal.sessionId;
    next();
  },
);

/**
 * Attaches the caller when a valid token is present and continues silently when
 * it is not.
 *
 * Used by public station discovery, which must serve guests but can personalise
 * for a signed-in user. An INVALID token is treated exactly like no token — a
 * guest — rather than an error, so an expired token never breaks browsing.
 */
export const optionalAuthenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const principal = await resolvePrincipal(req);

    if (principal) {
      req.user = principal.user;
      req.sessionId = principal.sessionId;
    }

    next();
  },
);
