import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { AccessTokenPayload } from '../types/auth';

const ISSUER = 'qless-api';
const AUDIENCE = 'qless-clients';

/** Access-token lifetime in seconds. */
export const accessTokenTtlSeconds = env.ACCESS_TOKEN_TTL_MINUTES * 60;

export function signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, env.JWT_SECRET, {
    expiresIn: accessTokenTtlSeconds,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/**
 * Verifies an access token's signature, expiry, issuer and audience.
 * Returns null for ANY invalid token — callers must not distinguish between
 * "expired", "malformed" and "bad signature" when responding to clients.
 */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (typeof decoded !== 'object' || decoded === null) return null;

    const payload = decoded as Partial<AccessTokenPayload>;
    // A refresh token must never be accepted where an access token is expected.
    if (payload.type !== 'access') return null;
    if (!payload.sub || !payload.role || !payload.sid) return null;

    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Refresh tokens are opaque random strings rather than JWTs: they carry no
 * claims, are meaningless without the matching database row, and can therefore
 * be revoked instantly.
 */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/** Refresh tokens are stored only as this hash, never in plaintext. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for hex digests of equal length. */
export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function refreshTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Extracts a bearer token from an Authorization header. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}
