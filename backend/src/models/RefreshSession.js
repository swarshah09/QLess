'use strict';

const mongoose = require('mongoose');

/**
 * A refresh-token session.
 *
 * Access tokens are stateless JWTs; refresh tokens are opaque random strings
 * stored ONLY as a SHA-256 hash, so a database leak yields no usable tokens.
 * Rotation keeps `familyId` constant — presenting an already-revoked token
 * means it leaked, so the whole family is revoked at once.
 */
const refreshSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true, maxlength: 64 },
    familyId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, maxlength: 80, default: null },
    ipAddress: { type: String, maxlength: 64, default: null },
    userAgent: { type: String, maxlength: 400, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

refreshSessionSchema.index({ user: 1, revokedAt: 1 });
refreshSessionSchema.index({ familyId: 1 });
// Mongo reaps expired sessions itself, so no cleanup job is needed.
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshSession', refreshSessionSchema);
