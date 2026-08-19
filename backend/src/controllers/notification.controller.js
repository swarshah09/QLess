'use strict';

const notificationService = require('../services/notification.service');
const { publicVapidKey } = require('../notifications/webPush');
const { sendCreated, sendPaginated, sendSuccess } = require('../utils/response');

module.exports = {
  async listRules(req, res) {
    sendSuccess(res, { rules: await notificationService.listRules(req.user.id) });
  },

  async createRule(req, res) {
    sendCreated(res, { rule: await notificationService.createRule(req.user.id, req.body) });
  },

  async updateRule(req, res) {
    const rule = await notificationService.updateRule(req.params.id, req.user.id, req.body);
    sendSuccess(res, { rule });
  },

  async deleteRule(req, res) {
    await notificationService.deleteRule(req.params.id, req.user.id);
    sendSuccess(res, { deleted: true });
  },

  /** Public: clients need this key before they can create a subscription. */
  async vapidKey(_req, res) {
    const key = publicVapidKey();
    sendSuccess(res, { publicKey: key, configured: key !== null });
  },

  async listSubscriptions(req, res) {
    sendSuccess(res, { subscriptions: await notificationService.listSubscriptions(req.user.id) });
  },

  async subscribe(req, res) {
    const subscription = await notificationService.subscribe(req.user.id, {
      endpoint: req.body.endpoint,
      p256dh: req.body.keys.p256dh,
      auth: req.body.keys.auth,
      userAgent: req.get('user-agent')?.slice(0, 400),
    });
    sendCreated(res, { subscription });
  },

  async unsubscribe(req, res) {
    await notificationService.unsubscribe(req.user.id, req.body.endpoint);
    sendSuccess(res, { removed: true });
  },

  async listEvents(req, res) {
    const { page, limit } = req.query;
    const { items, total } = await notificationService.listEvents(req.user.id, { page, limit });
    sendPaginated(res, items, page, limit, total);
  },
};
