import { randomUUID } from 'node:crypto';
import { AuthMethod, type User, UserRole } from '@prisma/client';
import { logger } from '../../config/logger';
import { AppError } from '../../errors/AppError';
import {
  type PublicUser,
  userRepository,
} from '../../repositories/user.repository';
import { sessionRepository } from '../../repositories/session.repository';
import { hashPassword } from '../../utils/password';
import {
  accessTokenTtlSeconds,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../../utils/tokens';
import type { AuthContext, IssuedTokens } from '../../types/auth';
import { passwordStrategy } from './password.strategy';

/**
 * A single generic message for every credential failure. Whether the email is
 * unknown, the password is wrong, or the account is disabled, the client sees
 * exactly this — the API must not be usable to enumerate accounts.
 */
const GENERIC_CREDENTIAL_ERROR = 'Invalid email or password';

export interface AuthResult {
  user: PublicUser;
  tokens: IssuedTokens;
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    active: user.active,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

/**
 * Creates a session and its token pair. Deliberately independent of how the
 * user proved their identity, so any future strategy reuses it unchanged.
 */
async function issueSession(
  user: Pick<User, 'id' | 'role'>,
  method: AuthMethod,
  context: AuthContext,
  familyId: string = randomUUID(),
): Promise<IssuedTokens> {
  const refreshToken = generateRefreshToken();

  const session = await sessionRepository.create({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    familyId,
    method,
    expiresAt: refreshTokenExpiry(),
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });

  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    sid: session.id,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: accessTokenTtlSeconds,
    tokenType: 'Bearer',
  };
}

export const authService = {
  /**
   * Registers a new account. Self-registration always produces a USER —
   * elevated roles are granted only through the admin surface, so a caller
   * cannot make themselves an operator or admin by sending a `role` field.
   */
  async register(
    input: { name: string; email: string; phone?: string; password: string },
    context: AuthContext,
  ): Promise<AuthResult> {
    const alreadyExists = await userRepository.existsByEmail(input.email);
    if (alreadyExists) {
      // Registration is the one place the address must be revealed — the
      // account genuinely cannot be created twice. Rate limiting on this route
      // is what keeps it from becoming a bulk enumeration oracle.
      throw AppError.conflict('An account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await userRepository.create({
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      passwordHash,
      role: UserRole.USER,
    });

    const tokens = await issueSession(user, AuthMethod.PASSWORD, context);
    logger.info({ userId: user.id }, 'User registered');

    return { user, tokens };
  },

  /** Verifies credentials through the strategy, then issues a session. */
  async login(
    input: { email: string; password: string },
    context: AuthContext,
  ): Promise<AuthResult> {
    const result = await passwordStrategy.verify(input);

    if (!result.ok) {
      // The reason is recorded server-side but never sent to the client.
      logger.warn({ reason: result.reason }, 'Failed login attempt');
      throw AppError.unauthorized(GENERIC_CREDENTIAL_ERROR);
    }

    const { user, method } = result.identity;
    const tokens = await issueSession(user, method, context);
    await userRepository.touchLastLogin(user.id);

    logger.info({ userId: user.id, method }, 'User logged in');
    return { user: toPublicUser(user), tokens };
  },

  /**
   * Rotates a refresh token.
   *
   * Presenting a token that is already revoked means it leaked — the whole
   * family is killed so both the attacker's and the victim's copies stop
   * working, and the victim is forced to log in again.
   */
  async refresh(refreshToken: string, context: AuthContext): Promise<AuthResult> {
    const tokenHash = hashRefreshToken(refreshToken);
    const session = await sessionRepository.findByTokenHash(tokenHash);

    if (!session) {
      throw AppError.unauthorized('Invalid or expired session');
    }

    if (session.revokedAt) {
      const revokedCount = await sessionRepository.revokeFamily(
        session.familyId,
        'REUSE_DETECTED',
      );
      logger.error(
        { userId: session.userId, familyId: session.familyId, revokedCount },
        'Refresh token reuse detected — session family revoked',
      );
      throw AppError.unauthorized('Invalid or expired session');
    }

    if (session.expiresAt <= new Date()) {
      await sessionRepository.revoke(session.id, 'EXPIRED');
      throw AppError.unauthorized('Invalid or expired session');
    }

    // Re-read the user so a deactivation or role change since login takes
    // effect immediately rather than at the next login.
    const user = await userRepository.findAuthContextById(session.userId);
    if (!user || !user.active) {
      await sessionRepository.revokeAllForUser(session.userId, 'ACCOUNT_INACTIVE');
      throw AppError.unauthorized('Invalid or expired session');
    }

    const newRefreshToken = generateRefreshToken();

    let rotated;
    try {
      rotated = await sessionRepository.rotate({
        currentSessionId: session.id,
        userId: session.userId,
        familyId: session.familyId,
        method: session.method,
        newTokenHash: hashRefreshToken(newRefreshToken),
        expiresAt: refreshTokenExpiry(),
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      });
    } catch (error) {
      // Lost a race with a concurrent refresh of the same token.
      if (error instanceof Error && error.message === 'SESSION_ALREADY_ROTATED') {
        await sessionRepository.revokeFamily(session.familyId, 'CONCURRENT_ROTATION');
        throw AppError.unauthorized('Invalid or expired session');
      }
      throw error;
    }

    const fullUser = await userRepository.findById(user.id);
    if (!fullUser) throw AppError.unauthorized('Invalid or expired session');

    return {
      user: fullUser,
      tokens: {
        accessToken: signAccessToken({ sub: user.id, role: user.role, sid: rotated.id }),
        refreshToken: newRefreshToken,
        expiresIn: accessTokenTtlSeconds,
        tokenType: 'Bearer',
      },
    };
  },

  /**
   * Ends a session. Idempotent and always reported as success: an already-dead
   * or unrecognised token still leaves the caller logged out, and returning an
   * error would leak whether the token was real.
   */
  async logout(refreshToken: string | undefined, sessionId?: string): Promise<void> {
    if (refreshToken) {
      const session = await sessionRepository.findByTokenHash(hashRefreshToken(refreshToken));
      if (session && !session.revokedAt) {
        await sessionRepository.revoke(session.id, 'LOGOUT');
        logger.info({ userId: session.userId }, 'User logged out');
        return;
      }
    }

    // No refresh token supplied (common for mobile clients that only hold an
    // access token in memory) — fall back to the session the access token names.
    if (sessionId) {
      await sessionRepository.revoke(sessionId, 'LOGOUT');
    }
  },

  /** Signs the user out of every device. */
  async logoutAll(userId: string): Promise<number> {
    const count = await sessionRepository.revokeAllForUser(userId, 'LOGOUT_ALL');
    logger.info({ userId, count }, 'All sessions revoked');
    return count;
  },

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await userRepository.findById(userId);
    if (!user) throw AppError.notFound('User not found');
    return user;
  },
};
