'use strict';

const AuditLog = require('../models/AuditLog');
const NotificationEvent = require('../models/NotificationEvent');
const NotificationRule = require('../models/NotificationRule');
const PushSubscription = require('../models/PushSubscription');
const RefreshSession = require('../models/RefreshSession');
const Report = require('../models/Report');
const Station = require('../models/Station');
const StationOperator = require('../models/StationOperator');
const User = require('../models/User');
const env = require('../config/env');
const logger = require('../config/logger');
const constants = require('../config/constants');
const { ROLES } = constants;
const { ApiError } = require('../utils/ApiError');
const { parseQueueLabel } = require('../utils/domain');
const stationStatusService = require('./stationStatus.service');
const stationService = require('./station.service');
const realtime = require('../sockets/realtime');

/**
 * Writes an audit entry without letting an audit failure undo the action that
 * already succeeded — a missing row is logged loudly instead.
 */
async function audit(actor, context, entry) {
  try {
    await AuditLog.create({
      adminUser: actor.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      reason: entry.reason ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });
  } catch (error) {
    logger.error('Failed to write audit log entry', { error: error.message, ...entry });
  }
}

/** Low must sit below normal, or pressure classification is incoherent. */
function assertThresholdsCoherent(low, normal) {
  if (low == null || normal == null) return;
  if (low >= normal) {
    throw ApiError.validation('Pressure thresholds are inconsistent', [
      {
        field: 'pressureThresholdLow',
        message: 'The low threshold must be below the normal threshold',
      },
    ]);
  }
}

const adminService = {
  // --- Users ---------------------------------------------------------------

  async listUsers({ page = 1, limit = 20, role }) {
    const query = role ? { role } : {};
    const [users, total] = await Promise.all([
      User.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(query),
    ]);
    return { items: users.map((u) => u.toPublic()), total };
  },

  async updateUserRole(userId, role, actor, context) {
    const user = await User.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    if (user.role === role) return user.toPublic();

    // Stops an admin removing their own access and locking the platform out.
    if (String(user._id) === String(actor.id) && role !== ROLES.ADMIN) {
      throw ApiError.badRequest('You cannot change your own role');
    }

    const before = user.role;
    user.role = role;
    await user.save();

    /**
     * A demoted user's live tokens still carry the old role. `authenticate`
     * reads the role from the database every request so they are already
     * powerless, but the sessions are cut to force a clean re-login.
     */
    if (before === ROLES.ADMIN || before === ROLES.STATION_OPERATOR) {
      await RefreshSession.updateMany(
        { user: userId, revokedAt: null },
        { revokedAt: new Date(), revokedReason: 'ROLE_CHANGED' },
      );
    }

    await audit(actor, context, {
      action: 'USER_ROLE_UPDATED',
      entityType: 'User',
      entityId: String(userId),
      before: { role: before },
      after: { role },
    });

    return user.toPublic();
  },

  async setUserActive(userId, active, actor, context) {
    const user = await User.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    if (String(user._id) === String(actor.id) && !active) {
      throw ApiError.badRequest('You cannot deactivate your own account');
    }

    const before = user.active;
    user.active = active;
    await user.save();

    if (!active) {
      await RefreshSession.updateMany(
        { user: userId, revokedAt: null },
        { revokedAt: new Date(), revokedReason: 'ACCOUNT_DEACTIVATED' },
      );
    }

    await audit(actor, context, {
      action: active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      entityType: 'User',
      entityId: String(userId),
      before: { active: before },
      after: { active },
    });

    return user.toPublic();
  },

  // --- Stations ------------------------------------------------------------

  async listStations({ page = 1, limit = 20, includeInactive = true, search }) {
    const query = includeInactive ? {} : { active: true };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
      ];
    }

    const [stations, total] = await Promise.all([
      Station.find(query)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Station.countDocuments(query),
    ]);

    return { items: stations.map((s) => stationService.serializeStation(s)), total };
  },

  async createStation(input, actor, context) {
    assertThresholdsCoherent(input.pressureThresholdLow, input.pressureThresholdNormal);

    const station = await Station.create({
      name: input.name,
      address: input.address,
      city: input.city ?? null,
      state: input.state ?? null,
      pincode: input.pincode ?? null,
      // GeoJSON is [longitude, latitude] — the reverse of how humans say it.
      location: { type: 'Point', coordinates: [input.longitude, input.latitude] },
      numberOfDispensers: input.numberOfDispensers ?? 1,
      operatingHours: input.operatingHours ?? null,
      pressureThresholdLow: input.pressureThresholdLow ?? null,
      pressureThresholdNormal: input.pressureThresholdNormal ?? null,
      defaultPressureUnit: input.defaultPressureUnit ?? 'BAR',
      active: input.active ?? true,
    });

    await audit(actor, context, {
      action: 'STATION_CREATED',
      entityType: 'Station',
      entityId: String(station._id),
      after: { name: station.name, latitude: input.latitude, longitude: input.longitude },
    });

    return stationService.serializeStation(station.toObject());
  },

  async updateStation(stationId, input, actor, context) {
    const station = await Station.findById(stationId);
    if (!station) throw ApiError.notFound('Station not found');

    assertThresholdsCoherent(
      input.pressureThresholdLow !== undefined
        ? input.pressureThresholdLow
        : station.pressureThresholdLow,
      input.pressureThresholdNormal !== undefined
        ? input.pressureThresholdNormal
        : station.pressureThresholdNormal,
    );

    const before = {
      name: station.name,
      active: station.active,
      numberOfDispensers: station.numberOfDispensers,
    };

    for (const key of [
      'name',
      'address',
      'city',
      'state',
      'pincode',
      'numberOfDispensers',
      'operatingHours',
      'pressureThresholdLow',
      'pressureThresholdNormal',
      'defaultPressureUnit',
    ]) {
      if (input[key] !== undefined) station[key] = input[key];
    }

    if (input.latitude !== undefined || input.longitude !== undefined) {
      station.location = {
        type: 'Point',
        coordinates: [
          input.longitude ?? station.location.coordinates[0],
          input.latitude ?? station.location.coordinates[1],
        ],
      };
    }

    await station.save();

    await audit(actor, context, {
      action: 'STATION_UPDATED',
      entityType: 'Station',
      entityId: String(stationId),
      before,
      after: { name: station.name, numberOfDispensers: station.numberOfDispensers },
    });

    // Thresholds feed pressure classification.
    if (
      input.pressureThresholdLow !== undefined ||
      input.pressureThresholdNormal !== undefined
    ) {
      const updated = await stationStatusService.recompute(stationId);
      realtime.emitStationUpdated(updated);
      return stationService.serializeStation(updated.toObject());
    }

    return stationService.serializeStation(station.toObject());
  },

  /**
   * Enables or disables a station. A reason is required: taking a station off
   * the map is user-visible and must be explicable afterwards. Stations are
   * never deleted — that would orphan their historical reports.
   */
  async setStationActive(stationId, active, reason, actor, context) {
    const station = await Station.findById(stationId);
    if (!station) throw ApiError.notFound('Station not found');

    const before = station.active;
    station.active = active;
    await station.save();

    await audit(actor, context, {
      action: active ? 'STATION_ENABLED' : 'STATION_DISABLED',
      entityType: 'Station',
      entityId: String(stationId),
      reason,
      before: { active: before },
      after: { active },
    });

    logger.info('Station availability toggled', {
      adminId: actor.id,
      stationId: String(stationId),
      active,
    });

    return stationService.serializeStation(station.toObject());
  },

  /**
   * Manual override of a station's reported state.
   *
   * Deliberately NOT a direct status write. The override is recorded as
   * ADMIN-sourced report rows and the status recomputed from history, so it is
   * visible in the record rather than appearing as though the crowd reported it.
   *
   * `reason` is mandatory — an override without one cannot be reviewed later.
   */
  async overrideStatus(stationId, input, actor, context) {
    const station = await Station.findById(stationId);
    if (!station) throw ApiError.notFound('Station not found');
    if (!input.reason?.trim()) {
      throw ApiError.badRequest('A reason is required for a manual override');
    }

    const before = station.status ? { ...station.status } : null;
    const overriddenAt = new Date();
    const documents = [];

    if (input.availability !== undefined) {
      documents.push({
        station: stationId,
        user: actor.id,
        kind: 'AVAILABILITY',
        availability: input.availability,
        activeDispensers: input.activeDispensers ?? null,
        source: 'ADMIN',
        locationVerified: true,
        note: `Admin override: ${input.reason}`.slice(0, 500),
      });
    }

    if (input.queueMin !== undefined && input.queueMin !== null) {
      const max = input.queueMax ?? input.queueMin;
      documents.push({
        station: stationId,
        user: actor.id,
        kind: 'QUEUE',
        queueMin: input.queueMin,
        queueMax: max,
        queueLabel: parseQueueLabel(
          require('../utils/domain').queueLabelFor(input.queueMin, max),
        ).label,
        source: 'ADMIN',
        locationVerified: true,
      });
    }

    if (input.pressureValue !== undefined && input.pressureValue !== null) {
      documents.push({
        station: stationId,
        user: actor.id,
        kind: 'PRESSURE',
        pressureValue: input.pressureValue,
        pressureUnit: input.pressureUnit ?? station.defaultPressureUnit,
        source: 'ADMIN',
        locationVerified: true,
      });
    }

    if (documents.length > 0) await Report.insertMany(documents);

    const updated = await stationStatusService.recompute(stationId);
    realtime.emitStationUpdated(updated);
    require('./notification.service').evaluateStation(stationId).catch(() => {});

    // WHO (adminUser), WHY (reason) and WHEN (createdAt / overriddenAt).
    await audit(actor, context, {
      action: 'STATION_STATUS_OVERRIDDEN',
      entityType: 'StationStatus',
      entityId: String(stationId),
      reason: input.reason,
      before,
      after: { ...updated.status, overriddenAt },
    });

    logger.warn('Station status manually overridden by admin', {
      adminId: actor.id,
      stationId: String(stationId),
      reason: input.reason,
    });

    return {
      status: require('./report.service').serializeStatus(updated),
      overriddenAt,
      reason: input.reason,
    };
  },

  // --- Operator assignments -------------------------------------------------

  async listStationOperators(stationId) {
    if (!(await Station.exists({ _id: stationId }))) throw ApiError.notFound('Station not found');

    const operators = await StationOperator.find({ station: stationId, active: true })
      .populate('user', 'name email role active')
      .lean();

    return operators
      .filter((o) => o.user)
      .map((o) => ({
        id: String(o._id),
        role: o.role,
        assignedAt: o.createdAt,
        user: {
          id: String(o.user._id),
          name: o.user.name,
          email: o.user.email,
          role: o.user.role,
        },
      }));
  },

  /**
   * The only way operator rights are granted. The user must already hold the
   * STATION_OPERATOR role, so access takes two deliberate admin actions.
   */
  async assignOperator({ stationId, userId, role = 'STAFF' }, actor, context) {
    const [station, user] = await Promise.all([
      Station.findById(stationId),
      User.findById(userId),
    ]);

    if (!station) throw ApiError.notFound('Station not found');
    if (!user) throw ApiError.notFound('User not found');

    if (user.role !== ROLES.STATION_OPERATOR && user.role !== ROLES.ADMIN) {
      throw ApiError.badRequest(
        'User must hold the STATION_OPERATOR role before being assigned to a station',
      );
    }
    if (!user.active) throw ApiError.badRequest('Cannot assign an inactive user to a station');

    // Upsert revives a previously revoked assignment rather than failing.
    const assignment = await StationOperator.findOneAndUpdate(
      { user: userId, station: stationId },
      { user: userId, station: stationId, role, active: true, revokedAt: null },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await audit(actor, context, {
      action: 'OPERATOR_ASSIGNED',
      entityType: 'StationOperator',
      entityId: String(stationId),
      after: { userId: String(userId), stationId: String(stationId), role },
    });

    return { id: String(assignment._id), role: assignment.role, active: assignment.active };
  },

  /** Soft-revoked so assignment history survives; effective next request. */
  async revokeOperator({ stationId, userId }, actor, context) {
    const result = await StationOperator.findOneAndUpdate(
      { user: userId, station: stationId, active: true },
      { active: false, revokedAt: new Date() },
    );
    if (!result) {
      throw ApiError.notFound('No active assignment found for this user and station');
    }

    await audit(actor, context, {
      action: 'OPERATOR_REVOKED',
      entityType: 'StationOperator',
      entityId: String(stationId),
      before: { userId: String(userId), active: true },
      after: { active: false },
    });
  },

  // --- Moderation and statistics -------------------------------------------

  /** Read-only: reports are never deleted. Moderation acts on reputation. */
  async suspiciousReports({ page = 1, limit = 20, sinceHours = 168 }) {
    const since = new Date(Date.now() - sinceHours * 3600000);

    const lowReputation = await User.find({
      'reputation.score': { $lt: 35 },
      'reputation.totalReports': { $gte: 3 },
    })
      .select('name email reputation')
      .sort({ 'reputation.score': 1 })
      .limit(100)
      .lean();

    const suspectIds = lowReputation.map((u) => u._id);

    const query = {
      createdAt: { $gte: since },
      $or: [
        // Unverified reports from users we already distrust.
        ...(suspectIds.length ? [{ user: { $in: suspectIds }, locationVerified: false }] : []),
        // Implausibly large queues from anyone unverified.
        { queueMin: { $gte: 100 }, locationVerified: false },
      ],
    };

    const [items, total] = await Promise.all([
      Report.find(query)
        .populate('user', 'name email reputation')
        .populate('station', 'name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Report.countDocuments(query),
    ]);

    return {
      items,
      total,
      lowReputationReporters: lowReputation.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        score: u.reputation?.score ?? 50,
        totalReports: u.reputation?.totalReports ?? 0,
      })),
    };
  },

  async reportStatistics({ sinceHours = 24 }) {
    const since = new Date(Date.now() - sinceHours * 3600000);
    const match = { createdAt: { $gte: since } };

    const [byKind, bySource, distinctReporters] = await Promise.all([
      Report.aggregate([{ $match: match }, { $group: { _id: '$kind', count: { $sum: 1 } } }]),
      Report.aggregate([{ $match: match }, { $group: { _id: '$source', count: { $sum: 1 } } }]),
      Report.distinct('user', match),
    ]);

    const kinds = Object.fromEntries(byKind.map((r) => [r._id.toLowerCase(), r.count]));

    return {
      windowHours: sinceHours,
      totals: {
        queue: kinds.queue ?? 0,
        availability: kinds.availability ?? 0,
        pressure: kinds.pressure ?? 0,
        all: (kinds.queue ?? 0) + (kinds.availability ?? 0) + (kinds.pressure ?? 0),
      },
      reportsBySource: Object.fromEntries(bySource.map((r) => [r._id, r.count])),
      distinctReporters: distinctReporters.filter(Boolean).length,
    };
  },

  async notificationStatistics({ sinceHours = 24 }) {
    const since = new Date(Date.now() - sinceHours * 3600000);

    const [byStatus, totalRules, enabledRules, activeSubscriptions] = await Promise.all([
      NotificationEvent.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      NotificationRule.countDocuments(),
      NotificationRule.countDocuments({ enabled: true }),
      PushSubscription.countDocuments({ active: true }),
    ]);

    const counts = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
    const sent = counts.SENT ?? 0;
    const failed = counts.FAILED ?? 0;

    return {
      windowHours: sinceHours,
      events: {
        sent,
        failed,
        pending: counts.PENDING ?? 0,
        suppressed: counts.SUPPRESSED ?? 0,
        // Null rather than a misleading 0% when nothing was attempted.
        deliveryRate: sent + failed > 0 ? Math.round((sent / (sent + failed)) * 100) : null,
      },
      rules: { total: totalRules, enabled: enabledRules },
      activeSubscriptions,
    };
  },

  /**
   * Effective platform configuration. Read-only: these come from environment
   * and constants, so changing them is a deploy concern, not a runtime API.
   */
  platformSettings() {
    return {
      freshnessThresholdsMinutes: constants.FRESHNESS_THRESHOLDS_MINUTES,
      pressureDefaults: constants.PRESSURE_DEFAULTS,
      waitEstimation: constants.WAIT_ESTIMATION,
      reportLimits: constants.REPORT_LIMITS,
      notifications: constants.NOTIFICATIONS,
      recommendation: constants.RECOMMENDATION,
      sourceWeights: constants.SOURCE_WEIGHTS,
      statusInputWindowMinutes: constants.STATUS_INPUT_WINDOW_MINUTES,
      locationVerificationRadiusM: env.LOCATION_VERIFICATION_RADIUS_M,
      webPushConfigured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    };
  },

  async listAuditLogs({ page = 1, limit = 20, action, entityType }) {
    const query = {
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
    };

    const [items, total] = await Promise.all([
      AuditLog.find(query)
        .populate('adminUser', 'name email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    return { items, total };
  },
};

module.exports = adminService;
