'use strict';

const User = require('../models/User');
const RefreshSession = require('../models/RefreshSession');
const StationOperator = require('../models/StationOperator');
const Station = require('../models/Station');
const logger = require('../config/logger');
const { ROLES } = require('../config/constants');
const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { extractBearerToken, verifyAccessToken } = require('../utils/auth');

/**
 * Resolves the caller from an access token.
 *
 * The role is read from the DATABASE, never from the token claim, so revoking
 * an operator's rights takes effect on their next request rather than whenever
 * their access token happens to expire. The session is checked too — a logout
 * must invalidate the access token, which a stateless JWT check alone misses.
 */
async function resolvePrincipal(req) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) return null;

  const payload = verifyAccessToken(token);
  if (!payload) return null;

  const session = await RefreshSession.findById(payload.sid).lean();
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  const user = await User.findById(payload.sub).lean();
  if (!user || !user.active) return null;

  return {
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    },
    sessionId: session._id.toString(),
  };
}

/** Requires a valid access token; 401 otherwise. */
const authenticate = asyncHandler(async (req, _res, next) => {
  const principal = await resolvePrincipal(req);
  if (!principal) throw ApiError.unauthorized('Authentication required');

  req.user = principal.user;
  req.sessionId = principal.sessionId;
  next();
});

/**
 * Attaches the caller when a valid token is present, continues silently
 * otherwise. Used by public station discovery: an INVALID token is treated
 * exactly like no token, so an expired session never breaks browsing.
 */
const optionalAuthenticate = asyncHandler(async (req, _res, next) => {
  const principal = await resolvePrincipal(req);
  if (principal) {
    req.user = principal.user;
    req.sessionId = principal.sessionId;
  }
  next();
});

/**
 * Role gate. Roles come from `req.user`, which was populated from the database
 * — a role in a request body, header or query string is never an input here.
 */
function requireRole(...allowed) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));

    if (!allowed.includes(req.user.role)) {
      logger.warn('Blocked request: insufficient role', {
        userId: req.user.id,
        role: req.user.role,
        required: allowed,
        path: req.originalUrl,
      });
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    return next();
  };
}

const requireAdmin = requireRole(ROLES.ADMIN);
const requireOperator = requireRole(ROLES.STATION_OPERATOR, ROLES.ADMIN);

/**
 * THE operator rule: an operator may act only on stations assigned to them.
 *
 * This is the authoritative backend check — the frontend hiding a station is
 * irrelevant. A non-existent station and an unassigned one return an IDENTICAL
 * 403, so the endpoint cannot be used to enumerate station ids.
 *
 * Admins bypass the assignment requirement (they manage the platform), but the
 * station must still exist.
 */
function requireStationAssignment(paramName = 'stationId') {
  return asyncHandler(async (req, _res, next) => {
    if (!req.user) throw ApiError.unauthorized('Authentication required');

    const stationId = req.params[paramName];
    if (!stationId) throw ApiError.badRequest(`Missing ${paramName} in request path`);

    // Normal users never manage stations, whatever the assignment table says.
    if (req.user.role === ROLES.USER) {
      logger.warn('Blocked request: USER attempted a station management action', {
        userId: req.user.id,
        stationId,
      });
      throw ApiError.forbidden('You do not have permission to manage this station');
    }

    if (req.user.role === ROLES.ADMIN) {
      const exists = await Station.exists({ _id: stationId });
      if (!exists) throw ApiError.notFound('Station not found');
      return next();
    }

    const assignment = await StationOperator.exists({
      user: req.user.id,
      station: stationId,
      active: true,
    });

    if (!assignment) {
      logger.warn('Blocked request: operator is not assigned to this station', {
        userId: req.user.id,
        stationId,
      });
      throw ApiError.forbidden('You are not assigned to this station');
    }

    return next();
  });
}

module.exports = {
  authenticate,
  optionalAuthenticate,
  requireRole,
  requireAdmin,
  requireOperator,
  requireStationAssignment,
};
