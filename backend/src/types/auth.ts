import type { UserRole } from '@prisma/client';

/**
 * The authenticated principal attached to a request.
 *
 * Everything here is derived server-side from a verified token or a fresh
 * database read — never from client-supplied fields. In particular `role` is
 * always the value stored in the database, never something the caller sent.
 */
export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string;
  role: UserRole;
}

/** Claims carried by an access token. */
export interface AccessTokenPayload {
  /** Subject — the user id. */
  sub: string;
  role: UserRole;
  /** Session this token was issued from, so logout can be traced. */
  sid: string;
  type: 'access';
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds, so clients can schedule a refresh. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthContext {
  ipAddress?: string;
  userAgent?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `authenticate`; also set by `optionalAuthenticate` when a valid token is present. */
      user?: AuthenticatedUser;
      /** Id of the session backing the current access token. */
      sessionId?: string;
    }
  }
}
