'use strict';

const adminService = require('../services/admin.service');
const { buildPagination, sendCreated, sendPaginated, sendSuccess } = require('../utils/response');

const context = (req) => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent')?.slice(0, 400),
});

module.exports = {
  // --- Users ---
  async listUsers(req, res) {
    const { page, limit, role } = req.query;
    const { items, total } = await adminService.listUsers({ page, limit, role });
    sendPaginated(res, items, page, limit, total);
  },

  async updateUserRole(req, res) {
    const user = await adminService.updateUserRole(
      req.params.userId,
      req.body.role,
      req.user,
      context(req),
    );
    sendSuccess(res, { user });
  },

  async setUserActive(req, res) {
    const user = await adminService.setUserActive(
      req.params.userId,
      req.body.active,
      req.user,
      context(req),
    );
    sendSuccess(res, { user });
  },

  // --- Stations ---
  async listStations(req, res) {
    const { page, limit, includeInactive, search } = req.query;
    const { items, total } = await adminService.listStations({
      page,
      limit,
      includeInactive,
      search,
    });
    sendPaginated(res, items, page, limit, total);
  },

  async createStation(req, res) {
    const station = await adminService.createStation(req.body, req.user, context(req));
    sendCreated(res, { station });
  },

  async updateStation(req, res) {
    const station = await adminService.updateStation(
      req.params.stationId,
      req.body,
      req.user,
      context(req),
    );
    sendSuccess(res, { station });
  },

  async setStationActive(req, res) {
    const station = await adminService.setStationActive(
      req.params.stationId,
      req.body.active,
      req.body.reason,
      req.user,
      context(req),
    );
    sendSuccess(res, { station });
  },

  /** Manual override — records admin identity, reason and timestamp. */
  async overrideStatus(req, res) {
    const result = await adminService.overrideStatus(
      req.params.stationId,
      req.body,
      req.user,
      context(req),
    );
    sendSuccess(res, result);
  },

  // --- Operator assignments ---
  async listStationOperators(req, res) {
    const operators = await adminService.listStationOperators(req.params.stationId);
    sendSuccess(res, { operators });
  },

  async assignOperator(req, res) {
    const assignment = await adminService.assignOperator(
      { stationId: req.params.stationId, userId: req.body.userId, role: req.body.role },
      req.user,
      context(req),
    );
    sendCreated(res, { assignment });
  },

  async revokeOperator(req, res) {
    await adminService.revokeOperator(
      { stationId: req.params.stationId, userId: req.params.userId },
      req.user,
      context(req),
    );
    sendSuccess(res, { revoked: true });
  },

  // --- Moderation and statistics ---
  async suspiciousReports(req, res) {
    const { page, limit, sinceHours } = req.query;
    const { items, total, lowReputationReporters } = await adminService.suspiciousReports({
      page,
      limit,
      sinceHours,
    });
    sendSuccess(res, { reports: items, lowReputationReporters }, 200, {
      pagination: buildPagination(page, limit, total),
    });
  },

  async reportStats(req, res) {
    sendSuccess(res, await adminService.reportStatistics({ sinceHours: req.query.sinceHours }));
  },

  async notificationStats(req, res) {
    sendSuccess(
      res,
      await adminService.notificationStatistics({ sinceHours: req.query.sinceHours }),
    );
  },

  async settings(_req, res) {
    sendSuccess(res, adminService.platformSettings());
  },

  async auditLogs(req, res) {
    const { page, limit, action, entityType } = req.query;
    const { items, total } = await adminService.listAuditLogs({
      page,
      limit,
      action,
      entityType,
    });
    sendPaginated(res, items, page, limit, total);
  },
};
