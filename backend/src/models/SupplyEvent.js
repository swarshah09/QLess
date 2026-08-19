'use strict';

const mongoose = require('mongoose');
const { REPORT_SOURCES, SUPPLY_EVENT_TYPES } = require('../config/constants');

/** Discrete supply-side occurrences. Appended, never rewritten. */
const supplyEventSchema = new mongoose.Schema(
  {
    station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: SUPPLY_EVENT_TYPES, required: true },
    source: { type: String, enum: REPORT_SOURCES, required: true },
    note: { type: String, maxlength: 500, default: null },
    startedAt: { type: Date, default: Date.now },
    /** Set when the event ends — adds information rather than replacing any. */
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

supplyEventSchema.index({ station: 1, startedAt: -1 });
supplyEventSchema.index({ station: 1, endedAt: 1 });

module.exports = mongoose.model('SupplyEvent', supplyEventSchema);
