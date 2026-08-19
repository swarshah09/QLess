'use strict';

const mongoose = require('mongoose');

const savedStationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },
    label: { type: String, maxlength: 80, default: null },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Saving twice is an update, not a duplicate.
savedStationSchema.index({ user: 1, station: 1 }, { unique: true });
savedStationSchema.index({ user: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model('SavedStation', savedStationSchema);
