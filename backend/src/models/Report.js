'use strict';

const mongoose = require('mongoose');
const {
  AVAILABILITY,
  PRESSURE_UNITS,
  QUEUE_LABELS,
  REPORT_SOURCES,
} = require('../config/constants');

/**
 * Raw crowd/operator reports — APPEND-ONLY.
 *
 * One collection for all three report kinds rather than three: they share every
 * field except the observation itself, they are always queried together by
 * station and time, and a single collection keeps the status computation to one
 * query instead of three. `kind` discriminates.
 *
 * Nothing in the codebase updates or deletes these documents. Corrections are
 * expressed as new reports, because the computed status is derived from this
 * history and rewriting it would destroy the evidence behind past answers.
 */
const reportSchema = new mongoose.Schema(
  {
    station: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Station',
      required: true,
    },
    /** Null for a SYSTEM_ESTIMATE. */
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    kind: {
      type: String,
      enum: ['QUEUE', 'AVAILABILITY', 'PRESSURE'],
      required: true,
    },

    source: { type: String, enum: REPORT_SOURCES, required: true },

    // --- Queue observation (kind: QUEUE) ---
    // Both null means the reporter explicitly did not know.
    queueMin: { type: Number, default: null },
    queueMax: { type: Number, default: null },
    queueLabel: { type: String, enum: QUEUE_LABELS, default: null },

    // --- Availability observation (kind: AVAILABILITY) ---
    availability: { type: String, enum: AVAILABILITY, default: null },
    /** Only operators reliably know this, so it is usually null. */
    activeDispensers: { type: Number, default: null },

    // --- Pressure observation (kind: PRESSURE) ---
    pressureValue: { type: Number, default: null },
    pressureUnit: { type: String, enum: PRESSURE_UNITS, default: 'BAR' },

    /** Always computed server-side; a client-supplied flag is never trusted. */
    locationVerified: { type: Boolean, default: false },
    reportedLocation: {
      type: { type: String, enum: ['Point'], default: undefined },
      coordinates: { type: [Number], default: undefined },
    },
    distanceToStationM: { type: Number, default: null },

    note: { type: String, maxlength: 500, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The status computation reads "recent reports for this station" constantly.
reportSchema.index({ station: 1, createdAt: -1 });
// Throttling reads "this user's recent reports", globally and per station.
reportSchema.index({ user: 1, createdAt: -1 });
reportSchema.index({ user: 1, station: 1, createdAt: -1 });
// Admin moderation scans by source over a recent window.
reportSchema.index({ source: 1, createdAt: -1 });
reportSchema.index({ station: 1, kind: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
