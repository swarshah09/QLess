'use strict';

const stationService = require('../services/station.service');
const reportService = require('../services/report.service');
const operatorService = require('../services/operator.service');
const { savedStationService, visitService } = require('../services/user.service');
const { sendCreated, sendPaginated, sendSuccess } = require('../utils/response');

const originFrom = (query) =>
  query.latitude !== undefined && query.longitude !== undefined
    ? { latitude: query.latitude, longitude: query.longitude }
    : undefined;

module.exports = {
  /** Public. Nearest first unless a different sort is requested. */
  async nearby(req, res) {
    const { latitude, longitude, radius, sort, limit, ...filters } = req.query;

    const stations = await stationService.findNearby({
      latitude,
      longitude,
      radiusM: radius,
      sort,
      limit,
      filters,
      userId: req.user?.id,
    });

    sendSuccess(res, { stations }, 200, {
      origin: { latitude, longitude },
      radiusM: radius ?? null,
      sort,
      count: stations.length,
    });
  },

  /** Public. The station list stays nearest-first; the recommendation is metadata. */
  async recommendations(req, res) {
    const { latitude, longitude, radius, limit } = req.query;

    const { stations, recommendation } = await stationService.recommend({
      latitude,
      longitude,
      radiusM: radius,
      limit,
      userId: req.user?.id,
    });

    sendSuccess(res, {
      stations,
      recommendation,
      travelAssumptions: stationService.travelAssumptions(),
    });
  },

  async list(req, res) {
    const { page, limit, includeInactive } = req.query;
    const { items, total } = await stationService.list({
      page,
      limit,
      // Only admins may opt into inactive stations.
      includeInactive: includeInactive === true && req.user?.role === 'ADMIN',
      userId: req.user?.id,
    });
    sendPaginated(res, items, page, limit, total);
  },

  async detail(req, res) {
    const station = await stationService.getById(req.params.stationId, {
      origin: originFrom(req.query),
      userId: req.user?.id,
    });
    sendSuccess(res, { station });
  },

  /** Any authenticated user — no operator assignment required. */
  async submitReport(req, res) {
    const result = await reportService.submit({
      stationId: req.params.stationId,
      reporter: req.user,
      input: req.body,
    });
    sendCreated(res, result);
  },

  async reportHistory(req, res) {
    const { page, limit } = req.query;
    const reports = await reportService.history(req.params.stationId, { page, limit });
    sendSuccess(res, { reports }, 200, { page, limit });
  },

  // --- Saved stations ---
  async listSaved(req, res) {
    const stations = await savedStationService.list(req.user.id, originFrom(req.query));
    sendSuccess(res, { stations });
  },

  async save(req, res) {
    const saved = await savedStationService.save(
      req.user.id,
      req.params.stationId,
      req.body?.label,
    );
    sendCreated(res, { saved });
  },

  async unsave(req, res) {
    await savedStationService.unsave(req.user.id, req.params.stationId);
    sendSuccess(res, { removed: true });
  },

  // --- Visits ("I'm Here") ---
  async checkIn(req, res) {
    const result = await visitService.checkIn(req.params.stationId, req.user.id, {
      latitude: req.body.latitude,
      longitude: req.body.longitude,
    });
    sendCreated(res, result);
  },

  async joinQueue(req, res) {
    const visit = await visitService.joinQueue(req.params.visitId, req.user.id);
    sendSuccess(res, { visit });
  },

  async completeVisit(req, res) {
    const visit = await visitService.complete(
      req.params.visitId,
      req.user.id,
      req.body?.outcome ?? 'UNKNOWN',
    );
    sendSuccess(res, { visit });
  },

  async visitHistory(req, res) {
    const { page, limit } = req.query;
    const { items, total } = await visitService.list(req.user.id, { page, limit });
    sendPaginated(res, items, page, limit, total);
  },

  // --- Operator ---
  async listAssigned(req, res) {
    const assignments = await operatorService.listAssignedStations(req.user.id);
    sendSuccess(res, { assignments });
  },

  async operatorUpdate(req, res) {
    const result = await operatorService.update(req.params.stationId, req.user, req.body);
    sendCreated(res, result);
  },

  async updateStationConfig(req, res) {
    const result = await operatorService.updateStationConfig(
      req.params.stationId,
      req.user,
      req.body,
    );
    sendSuccess(res, result);
  },

  async createSupplyEvent(req, res) {
    const result = await operatorService.recordSupplyEvent(
      req.params.stationId,
      req.user,
      req.body,
    );
    sendCreated(res, result);
  },

  async closeSupplyEvent(req, res) {
    const event = await operatorService.closeSupplyEvent(
      req.params.stationId,
      req.params.eventId,
      req.user,
    );
    sendSuccess(res, { event });
  },

  async listSupplyEvents(req, res) {
    const { page, limit } = req.query;
    const { items, total } = await operatorService.listSupplyEvents(req.params.stationId, {
      page,
      limit,
    });
    sendPaginated(res, items, page, limit, total);
  },
};
