'use strict';

const mongoose = require('mongoose');

const notificationEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rule: { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationRule', default: null },
    station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', default: null },

    /**
     * Deterministic key derived from (rule, the transition that fired it).
     * Unique, so re-processing the same status change cannot create a second
     * event — the duplicate insert loses the race and is ignored.
     */
    dedupeKey: { type: String, required: true, unique: true, maxlength: 200 },

    channel: { type: String, default: 'WEB_PUSH' },
    status: {
      type: String,
      enum: ['PENDING', 'SENT', 'FAILED', 'SUPPRESSED'],
      default: 'PENDING',
    },

    title: { type: String, required: true, maxlength: 160 },
    body: { type: String, required: true, maxlength: 500 },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Snapshot of the conditions that fired it, for debugging. */
    triggerSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

    error: { type: String, maxlength: 1000, default: null },
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationEventSchema.index({ user: 1, createdAt: -1 });
notificationEventSchema.index({ status: 1, createdAt: 1 });
notificationEventSchema.index({ station: 1, createdAt: -1 });

module.exports = mongoose.model('NotificationEvent', notificationEventSchema);
