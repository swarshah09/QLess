'use strict';

const mongoose = require('mongoose');
const { VISIT_OUTCOMES } = require('../config/constants');

/**
 * A user's trip to a station ("I'm Here").
 *
 * `completedAt` records only that the visit ENDED. Whether refuelling actually
 * succeeded lives in `outcome` and stays UNKNOWN until the user says so —
 * conflating "left the station" with "refuelled" would corrupt every wait-time
 * measurement derived from visits.
 */
const stationVisitSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },
    locationVerified: { type: Boolean, default: false },
    arrivedAt: { type: Date, default: null },
    joinedQueueAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    outcome: { type: String, enum: VISIT_OUTCOMES, default: 'UNKNOWN' },
    /** Only set for a confirmed refuel, where it is actually measurable. */
    observedWaitMinutes: { type: Number, default: null },
  },
  { timestamps: true },
);

stationVisitSchema.index({ user: 1, createdAt: -1 });
stationVisitSchema.index({ station: 1, createdAt: -1 });
// Finding a user's still-open visit at a station.
stationVisitSchema.index({ user: 1, station: 1, completedAt: 1 });

module.exports = mongoose.model('StationVisit', stationVisitSchema);
