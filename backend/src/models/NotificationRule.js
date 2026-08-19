'use strict';

const mongoose = require('mongoose');
const { AVAILABILITY, NOTIFICATIONS, PRESSURE_UNITS } = require('../config/constants');

/**
 * A user's alert for one station.
 *
 * Conditions combine with AND, and thresholds are evaluated CONSERVATIVELY:
 * a queue range of 4-7 does not satisfy "at most 5", because the range does not
 * guarantee it. See services/ruleEvaluator.
 */
const notificationRuleSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },

    /** Any of these satisfies the rule. Empty means "any availability". */
    requiredAvailability: { type: [String], enum: AVAILABILITY, default: [] },
    maxQueue: { type: Number, default: null },
    maxWaitMinutes: { type: Number, default: null },
    minPressure: { type: Number, default: null },
    pressureUnit: { type: String, enum: PRESSURE_UNITS, default: 'BAR' },

    channel: { type: String, enum: ['WEB_PUSH', 'IN_APP', 'EMAIL', 'SMS'], default: 'WEB_PUSH' },
    enabled: { type: Boolean, default: true },

    /**
     * Whether conditions currently hold, so the rule fires on the TRANSITION
     * into MET rather than on every evaluation.
     */
    conditionState: { type: String, enum: ['UNMET', 'MET', 'UNKNOWN'], default: 'UNKNOWN' },

    lastEvaluatedAt: { type: Date, default: null },
    lastTriggeredAt: { type: Date, default: null },
    cooldownUntil: { type: Date, default: null },
    cooldownMinutes: { type: Number, default: NOTIFICATIONS.defaultCooldownMinutes },
  },
  { timestamps: true },
);

// One alert per user/station/channel.
notificationRuleSchema.index({ user: 1, station: 1, channel: 1 }, { unique: true });
// Evaluation is scoped to the station whose status just changed — never a
// global scan — so this is the index that matters.
notificationRuleSchema.index({ station: 1, enabled: 1 });
notificationRuleSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('NotificationRule', notificationRuleSchema);
