'use strict';

/**
 * Response helpers. Every controller goes through these so the envelope stays
 * identical across every endpoint and every client platform.
 */

function sendSuccess(res, data, statusCode = 200, meta) {
  return res.status(statusCode).json(meta ? { success: true, data, meta } : { success: true, data });
}

function sendCreated(res, data) {
  return sendSuccess(res, data, 201);
}

function buildPagination(page, limit, total) {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

function sendPaginated(res, items, page, limit, total) {
  return sendSuccess(res, { items, pagination: buildPagination(page, limit, total) });
}

module.exports = { sendSuccess, sendCreated, sendPaginated, buildPagination };
