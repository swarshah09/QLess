'use strict';

const { createHash, randomBytes, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ISSUER = 'qless-api';
const AUDIENCE = 'qless-clients';

const accessTokenTtlSeconds = env.ACCESS_TOKEN_TTL_MINUTES * 60;

const hashPassword = (plain) => bcrypt.hash(plain, env.BCRYPT_ROUNDS);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/**
 * A hash matching nothing, so a login for an unknown email spends the same CPU
 * time as one for a known email. Without it, response timing reveals which
 * addresses have accounts.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.a1PZ5H0EFmuPUEwG3ZoUC5tXn1IU8pO';
const fakeVerify = (plain) => bcrypt.compare(plain, DUMMY_HASH);

function signAccessToken({ sub, role, sid }) {
  return jwt.sign({ sub, role, sid, type: 'access' }, env.JWT_SECRET, {
    expiresIn: accessTokenTtlSeconds,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/**
 * Returns null for ANY invalid token. Callers must not distinguish between
 * expired, malformed and bad-signature when responding to clients.
 */
function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof decoded !== 'object' || decoded === null) return null;
    // A refresh token must never be accepted where an access token is expected.
    if (decoded.type !== 'access') return null;
    if (!decoded.sub || !decoded.role || !decoded.sid) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Refresh tokens are opaque random strings, not JWTs: they carry no claims,
 * are meaningless without their database row, and can be revoked instantly.
 */
const generateRefreshToken = () => randomBytes(48).toString('base64url');
const hashRefreshToken = (token) => createHash('sha256').update(token).digest('hex');
const refreshTokenExpiry = (from = new Date()) =>
  new Date(from.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

function extractBearerToken(header) {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

module.exports = {
  accessTokenTtlSeconds,
  hashPassword,
  verifyPassword,
  fakeVerify,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  extractBearerToken,
  newFamilyId: randomUUID,
};
