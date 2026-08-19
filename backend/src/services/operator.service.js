'use strict';

const Station = require('../models/Station');
const StationOperator = require('../models/StationOperator');
const SupplyEvent = require('../models/SupplyEvent');
const { ROLES } = require('../config/constants');
const { ApiError } = require('../utils/ApiError');
const reportService = require('./report.service');
const stationStatusService = require('./stationStatus.service');
const notificationService = require('./notification.service');
const realtime = require('../sockets/realtime');

/**
 * Operator updates for an assigned station.
 *
 * Critically, an operator update is NOT a direct write to the station status.
 * It creates the same append-only report rows a user report would, tagged
 * `source: OPERATOR`, and the status is recomputed from that history. One code
 * path to reason about, and every operator action stays auditable.
 */

/**
 * Re-asserts the assignment rule at the service boundary. The route middleware
 * already enforces it; repeating it here means the rule holds even if a future
 * caller reaches the service another way.
 */
async function assertMayOperate(actor, stationId) {
  if (actor.role === ROLES.ADMIN) return;
  if (actor.role !== ROLES.STATION_OPERATOR) {
    throw ApiError.forbidden('You do not have permission to manage this station');
  }

  const assigned = await StationOperator.exists({
    user: actor.id,
    station: stationId,
    active: true,
  });
  if (!assigned) throw ApiError.forbidden('You are not assigned to this station');
}

/** Availability implied by each event type; an explicit value overrides it. */
const IMPLIED_AVAILABILITY = {
  SUPPLY_ARRIVED: 'AVAILABLE',
  LOW_SUPPLY: 'LOW_SUPPLY',
  CNG_FINISHED: 'UNAVAILABLE',
  TEMPORARY_INTERRUPTION: 'TEMPORARILY_INTERRUPTED',
  SUPPLY_RESTORED: 'AVAILABLE',
  MAINTENANCE_START: 'TEMPORARILY_INTERRUPTED',
  STATION_CLOSED: 'UNAVAILABLE',
  STATION_REOPENED: 'AVAILABLE',
};

const operatorService = {
  /** Stations the signed-in operator may act on. */
  async listAssignedStations(userId) {
    const assignments = await StationOperator.find({ user: userId, active: true })
      .populate('station', 'name address city active location')
      .sort({ createdAt: -1 })
      .lean();

    return assignments
      .filter((a) => a.station)
      .map((a) => ({
        id: String(a._id),
        role: a.role,
        station: {
          id: String(a.station._id),
          name: a.station.name,
          address: a.station.address,
          city: a.station.city ?? null,
          active: a.station.active,
        },
      }));
  },

  /** Records an operator's observation as history, then recomputes status. */
  async update(stationId, actor, input) {
    await assertMayOperate(actor, stationId);

    // Reuses the crowd-report path with `actingAsOperator`, so operator input
    // is weighted and stored by exactly the same rules.
    return reportService.submit({
      stationId,
      reporter: actor,
      input,
      actingAsOperator: true,
    });
  },

  /**
   * Records a supply event.
   *
   * Some types imply an availability change, so a matching report is written
   * alongside — again as history, so the recomputation picks it up normally.
   */
  async recordSupplyEvent(stationId, actor, { type, note, availability }) {
    await assertMayOperate(actor, stationId);

    const station = await Station.findById(stationId);
    if (!station) throw ApiError.notFound('Station not found');

    const source = actor.role === ROLES.ADMIN ? 'ADMIN' : 'OPERATOR';

    const event = await SupplyEvent.create({
      station: stationId,
      reportedBy: actor.id,
      type,
      source,
      note: note ?? null,
    });

    const implied = availability ?? IMPLIED_AVAILABILITY[type] ?? null;
    if (implied) {
      const Report = require('../models/Report');
      await Report.create({
        station: stationId,
        user: actor.id,
        kind: 'AVAILABILITY',
        availability: implied,
        source,
        locationVerified: true,
        note: note ?? `Supply event: ${type}`,
      });
    }

    const updated = await stationStatusService.recompute(stationId);
    realtime.emitStationUpdated(updated);
    notificationService.evaluateStation(stationId).catch(() => {});

    return {
      event: {
        id: String(event._id),
        type: event.type,
        note: event.note,
        source: event.source,
        reportedByUserId: String(event.reportedBy),
        startedAt: event.startedAt,
        endedAt: event.endedAt,
      },
      status: reportService.serializeStatus(updated),
    };
  },

  /** Closes an open event by recording when it ended — never deletes it. */
  async closeSupplyEvent(stationId, eventId, actor) {
    await assertMayOperate(actor, stationId);

    const event = await SupplyEvent.findById(eventId);
    if (!event || String(event.station) !== String(stationId)) {
      throw ApiError.notFound('Supply event not found');
    }
    if (event.endedAt) throw ApiError.conflict('This supply event is already closed');

    event.endedAt = new Date();
    await event.save();

    return { id: String(event._id), type: event.type, endedAt: event.endedAt };
  },

  async listSupplyEvents(stationId, { page = 1, limit = 20 }) {
    if (!(await Station.exists({ _id: stationId }))) throw ApiError.notFound('Station not found');

    const [items, total] = await Promise.all([
      SupplyEvent.find({ station: stationId })
        .sort({ startedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SupplyEvent.countDocuments({ station: stationId }),
    ]);

    return {
      items: items.map((e) => ({
        id: String(e._id),
        type: e.type,
        note: e.note,
        source: e.source,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
      })),
      total,
    };
  },

  /** Operational configuration an operator may change on an assigned station. */
  async updateStationConfig(stationId, actor, input) {
    await assertMayOperate(actor, stationId);

    const station = await Station.findById(stationId);
    if (!station) throw ApiError.notFound('Station not found');

    const low = input.pressureThresholdLow ?? station.pressureThresholdLow;
    const normal = input.pressureThresholdNormal ?? station.pressureThresholdNormal;
    if (low != null && normal != null && low >= normal) {
      throw ApiError.validation('Pressure thresholds are inconsistent', [
        {
          field: 'pressureThresholdLow',
          message: 'The low threshold must be below the normal threshold',
        },
      ]);
    }

    // Identity and location are platform data an operator must not rewrite.
    for (const key of [
      'active',
      'numberOfDispensers',
      'operatingHours',
      'pressureThresholdLow',
      'pressureThresholdNormal',
    ]) {
      if (input[key] !== undefined) station[key] = input[key];
    }

    await station.save();

    // Thresholds feed pressure classification, so the derived status is stale
    // the moment they change.
    const updated = await stationStatusService.recompute(stationId);
    realtime.emitStationUpdated(updated);

    return { station: require('./station.service').serializeStation(updated) };
  },
};

module.exports = operatorService;
