'use strict';

const mongoose = require('mongoose');
const QPointsEvent = require('../models/QPointsEvent');
const { QPOINTS } = require('../config/constants');

/** Non-expired cutoff: events older than this no longer count. Compute-on-read, no job. */
function expiryCutoff(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - QPOINTS.expiryMonths);
  return cutoff;
}

const qpointsService = {
  /**
   * Total + breakdown + recent history for one user, computed fresh on every
   * call by summing non-expired ledger events — no stored running total, no
   * background job (this backend deliberately has none; see backend/README.md).
   */
  async myTotal(userId, { page = 1, limit = 20 } = {}) {
    const since = expiryCutoff();
    // Mongoose auto-casts string ids in find()/findOne(), but NOT inside a raw
    // aggregate() $match — an uncast string id there silently matches nothing,
    // rather than erroring, so this cast is load-bearing, not defensive fluff.
    const objectId = new mongoose.Types.ObjectId(userId);

    const [totalAgg, byKindAgg, recent, totalHistoryCount] = await Promise.all([
      QPointsEvent.aggregate([
        { $match: { user: objectId, createdAt: { $gte: since } } },
        { $group: { _id: null, total: { $sum: '$points' } } },
      ]),
      QPointsEvent.aggregate([
        { $match: { user: objectId, createdAt: { $gte: since }, type: 'EARNED' } },
        { $group: { _id: '$kind', total: { $sum: '$points' } } },
      ]),
      QPointsEvent.find({ user: userId, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('station', 'name')
        .lean(),
      QPointsEvent.countDocuments({ user: userId, createdAt: { $gte: since } }),
    ]);

    const byKind = Object.fromEntries(
      byKindAgg.filter((r) => r._id).map((r) => [r._id.toLowerCase(), r.total]),
    );

    return {
      total: totalAgg[0]?.total ?? 0,
      byKind: {
        queue: byKind.queue ?? 0,
        availability: byKind.availability ?? 0,
        pressure: byKind.pressure ?? 0,
      },
      expiresAfterMonths: QPOINTS.expiryMonths,
      history: recent.map((e) => ({
        id: String(e._id),
        type: e.type,
        points: e.points,
        kind: e.kind,
        stationId: e.station?._id ? String(e.station._id) : null,
        stationName: e.station?.name ?? null,
        reason: e.reason,
        createdAt: e.createdAt,
      })),
      totalHistoryCount,
    };
  },
};

module.exports = qpointsService;
