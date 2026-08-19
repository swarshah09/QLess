'use strict';

const mongoose = require('mongoose');

/**
 * Operator ↔ station assignment. This is the ONLY thing that grants an
 * operator rights over a station; the role alone grants nothing.
 */
const stationOperatorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },
    role: { type: String, enum: ['MANAGER', 'STAFF'], default: 'STAFF' },
    /** Soft-revoked so assignment history survives for auditing. */
    active: { type: Boolean, default: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One assignment per user/station pair; revoking flips `active` rather than
// deleting, so the unique constraint must not include it.
stationOperatorSchema.index({ user: 1, station: 1 }, { unique: true });
// "May this operator act on this station?" — the authorization hot path.
stationOperatorSchema.index({ user: 1, active: 1 });
stationOperatorSchema.index({ station: 1, active: 1 });

module.exports = mongoose.model('StationOperator', stationOperatorSchema);
