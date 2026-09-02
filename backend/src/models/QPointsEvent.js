'use strict';

const mongoose = require('mongoose');

const QPOINTS_EVENT_TYPES = ['EARNED', 'ADMIN_PENALTY'];

/**
 * QPoints ledger — APPEND-ONLY, mirroring Report's append-only design.
 *
 * A running total is never stored on User: points expire 9 months after being
 * earned, so the true total can only be known by summing non-expired events
 * at read time (compute-on-read — this backend deliberately has no background
 * job scheduler, see backend/README.md). This also gives the admin penalty a
 * natural, auditable home as just another (negative) ledger entry, and gives
 * the profile page a history for free.
 */
const qPointsEventSchema = new mongoose.Schema(
  {
    /** A ledger entry only ever belongs to a logged-in user — guests never earn points. */
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    /** Context for display; null only for an admin penalty with no station context. */
    station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', default: null },

    /** The Report that earned this entry. Null for an ADMIN_PENALTY. */
    report: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: null },

    /** Null for an ADMIN_PENALTY, which is not tied to one report kind. */
    kind: { type: String, enum: ['QUEUE', 'AVAILABILITY', 'PRESSURE'], default: null },

    type: { type: String, enum: QPOINTS_EVENT_TYPES, required: true },

    /** Positive for EARNED, negative for ADMIN_PENALTY. Never zero — a no-op event is never written. */
    points: { type: Number, required: true },

    /** Required only for ADMIN_PENALTY — mirrors AuditLog.reason. */
    reason: { type: String, maxlength: 500, default: null },

    /** WHO performed an ADMIN_PENALTY; null for a normal EARNED event. */
    adminUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The profile "my total" read sums non-expired events for one user.
qPointsEventSchema.index({ user: 1, createdAt: -1 });
// The per-kind points-cooldown reads "this user's last EARNED event of this
// kind at this station" — indexed for that exact lookup.
qPointsEventSchema.index({ user: 1, station: 1, kind: 1, createdAt: -1 });
// Admin audit / moderation: all penalties, most recent first.
qPointsEventSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('QPointsEvent', qPointsEventSchema);
module.exports.QPOINTS_EVENT_TYPES = QPOINTS_EVENT_TYPES;
