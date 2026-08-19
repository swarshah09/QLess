'use strict';

const User = require('../models/User');
const RefreshSession = require('../models/RefreshSession');
const logger = require('../config/logger');
const { ROLES } = require('../config/constants');
const { ApiError } = require('../utils/ApiError');
const {
  accessTokenTtlSeconds,
  fakeVerify,
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  newFamilyId,
  refreshTokenExpiry,
  signAccessToken,
  verifyPassword,
} = require('../utils/auth');

/**
 * One generic message for every credential failure. Whether the email is
 * unknown, the password wrong, or the account disabled, the client sees exactly
 * this — the API must not be usable to enumerate accounts.
 */
const GENERIC_CREDENTIAL_ERROR = 'Invalid email or password';

/** Creates a session and its token pair. */
async function issueSession(user, context, familyId = newFamilyId()) {
  const refreshToken = generateRefreshToken();

  const session = await RefreshSession.create({
    user: user._id,
    tokenHash: hashRefreshToken(refreshToken),
    familyId,
    expiresAt: refreshTokenExpiry(),
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });

  return {
    accessToken: signAccessToken({
      sub: user._id.toString(),
      role: user.role,
      sid: session._id.toString(),
    }),
    refreshToken,
    expiresIn: accessTokenTtlSeconds,
    tokenType: 'Bearer',
  };
}

const authService = {
  /**
   * Registers an account. Self-registration ALWAYS produces a USER — elevated
   * roles are granted only through the admin surface, so a caller cannot make
   * themselves an operator by sending a `role` field.
   */
  async register(input, context) {
    const email = input.email.toLowerCase().trim();

    if (await User.exists({ email })) {
      // Registration is the one place an address must be revealed — the account
      // genuinely cannot be created twice. Rate limiting is what stops this
      // becoming a bulk enumeration oracle.
      throw ApiError.conflict('An account with this email already exists');
    }

    const user = await User.create({
      name: input.name,
      email,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password),
      role: ROLES.USER,
    });

    logger.info('User registered', { userId: user._id.toString() });
    return { user: user.toPublic(), tokens: await issueSession(user, context) };
  },

  async login(input, context) {
    const email = input.email.toLowerCase().trim();
    // `passwordHash` is select:false, so it must be asked for explicitly.
    const user = await User.findOne({ email }).select('+passwordHash');

    if (!user) {
      // Same CPU cost as a real check, so timing does not leak existence.
      await fakeVerify(input.password);
      logger.warn('Failed login attempt', { reason: 'UNKNOWN_IDENTIFIER' });
      throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR);
    }

    const matches = await verifyPassword(input.password, user.passwordHash);
    if (!matches) {
      logger.warn('Failed login attempt', { reason: 'BAD_CREDENTIAL' });
      throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR);
    }

    // Checked after the password, so a disabled account is not revealed to
    // someone who does not already know the password.
    if (!user.active) {
      logger.warn('Failed login attempt', { reason: 'ACCOUNT_INACTIVE' });
      throw ApiError.unauthorized(GENERIC_CREDENTIAL_ERROR);
    }

    user.lastLoginAt = new Date();
    await user.save();

    logger.info('User logged in', { userId: user._id.toString() });
    return { user: user.toPublic(), tokens: await issueSession(user, context) };
  },

  /**
   * Rotates a refresh token.
   *
   * Presenting an already-revoked token means it leaked, so the whole family is
   * killed — both the attacker's and the victim's copies stop working, and the
   * victim's forced re-login is the signal that something went wrong.
   */
  async refresh(refreshToken, context) {
    const tokenHash = hashRefreshToken(refreshToken);
    const session = await RefreshSession.findOne({ tokenHash });

    if (!session) throw ApiError.unauthorized('Invalid or expired session');

    if (session.revokedAt) {
      const result = await RefreshSession.updateMany(
        { familyId: session.familyId, revokedAt: null },
        { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
      );
      logger.error('Refresh token reuse detected — session family revoked', {
        userId: session.user.toString(),
        revokedCount: result.modifiedCount,
      });
      throw ApiError.unauthorized('Invalid or expired session');
    }

    if (session.expiresAt <= new Date()) {
      session.revokedAt = new Date();
      session.revokedReason = 'EXPIRED';
      await session.save();
      throw ApiError.unauthorized('Invalid or expired session');
    }

    // Re-read the user so a deactivation or role change takes effect now.
    const user = await User.findById(session.user);
    if (!user || !user.active) {
      await RefreshSession.updateMany(
        { user: session.user, revokedAt: null },
        { revokedAt: new Date(), revokedReason: 'ACCOUNT_INACTIVE' },
      );
      throw ApiError.unauthorized('Invalid or expired session');
    }

    /**
     * Atomic claim: only the request that flips revokedAt from null may rotate.
     * A concurrent double-refresh therefore cannot leave two live tokens.
     */
    const claimed = await RefreshSession.findOneAndUpdate(
      { _id: session._id, revokedAt: null },
      { revokedAt: new Date(), revokedReason: 'ROTATED' },
    );
    if (!claimed) throw ApiError.unauthorized('Invalid or expired session');

    return {
      user: user.toPublic(),
      tokens: await issueSession(user, context, session.familyId),
    };
  },

  /**
   * Ends a session. Idempotent and always reported as success — an unknown
   * token still leaves the caller logged out, and erroring would leak whether
   * the token was real.
   */
  async logout(refreshToken, sessionId) {
    if (refreshToken) {
      const updated = await RefreshSession.findOneAndUpdate(
        { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
        { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      );
      if (updated) return;
    }
    // Mobile clients may hold only an access token.
    if (sessionId) {
      await RefreshSession.updateOne(
        { _id: sessionId, revokedAt: null },
        { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      );
    }
  },

  async logoutAll(userId) {
    const result = await RefreshSession.updateMany(
      { user: userId, revokedAt: null },
      { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' },
    );
    return result.modifiedCount;
  },

  async getProfile(userId) {
    const user = await User.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    return user.toPublic();
  },
};

module.exports = authService;
