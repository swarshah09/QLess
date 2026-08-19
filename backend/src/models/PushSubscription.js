'use strict';

const mongoose = require('mongoose');

/** A browser Web Push endpoint. One user may register several devices. */
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Unique so a browser re-sending its subscription refreshes rather than duplicates. */
    endpoint: { type: String, required: true, unique: true, maxlength: 1000 },
    p256dh: { type: String, required: true, maxlength: 255 },
    auth: { type: String, required: true, maxlength: 255 },
    userAgent: { type: String, maxlength: 400, default: null },
    /** Deactivated when the push service reports the endpoint is gone. */
    active: { type: Boolean, default: true },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

pushSubscriptionSchema.index({ user: 1, active: 1 });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
