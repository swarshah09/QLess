'use strict';

const qpointsService = require('../services/qpoints.service');
const { sendSuccess } = require('../utils/response');

module.exports = {
  async myTotal(req, res) {
    const { page, limit } = req.query;
    const summary = await qpointsService.myTotal(req.user.id, { page, limit });
    sendSuccess(res, { qpoints: summary });
  },
};
