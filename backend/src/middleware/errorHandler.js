'use strict';

const { ZodError } = require('zod');
const env = require('../config/env');
const logger = require('../config/logger');
const { ApiError, ErrorCode } = require('../utils/ApiError');

/** Turns anything thrown into the standard failure envelope. */
function normalize(error) {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
      isOperational: error.isOperational,
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 422,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Request validation failed',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.') || undefined,
        message: issue.message,
      })),
      isOperational: true,
    };
  }

  // Mongoose / MongoDB
  if (error?.name === 'ValidationError') {
    return {
      statusCode: 422,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      details: Object.values(error.errors || {}).map((e) => ({
        field: e.path,
        message: e.message,
      })),
      isOperational: true,
    };
  }
  if (error?.name === 'CastError') {
    return {
      statusCode: 400,
      code: ErrorCode.BAD_REQUEST,
      message: `Invalid value for ${error.path}`,
      isOperational: true,
    };
  }
  if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern || {}).join(', ');
    return {
      statusCode: 409,
      code: ErrorCode.CONFLICT,
      message: field
        ? `A record with this ${field} already exists`
        : 'A record with these values already exists',
      isOperational: true,
    };
  }
  if (error?.name === 'MongoNetworkError' || error?.name === 'MongooseServerSelectionError') {
    return {
      statusCode: 503,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Database is unavailable',
      isOperational: false,
    };
  }

  // Body-parser
  if (error?.type === 'entity.too.large') {
    return {
      statusCode: 413,
      code: ErrorCode.PAYLOAD_TOO_LARGE,
      message: 'Request body is too large',
      isOperational: true,
    };
  }
  if (error?.type === 'entity.parse.failed') {
    return {
      statusCode: 400,
      code: ErrorCode.BAD_REQUEST,
      message: 'Request body is not valid JSON',
      isOperational: true,
    };
  }

  return {
    statusCode: 500,
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Something went wrong',
    isOperational: false,
  };
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const n = normalize(error);

  /**
   * Expected client-side outcomes are normal traffic, not incidents. Logging
   * their stack traces would drown the real errors.
   */
  const isRoutine = n.isOperational && [400, 401, 403, 404, 409, 422, 429].includes(n.statusCode);

  const meta = { method: req.method, path: req.originalUrl, statusCode: n.statusCode, code: n.code };
  if (isRoutine) logger.warn(n.message, meta);
  else logger.error(n.message, { ...meta, stack: error?.stack });

  const body = {
    success: false,
    error: { code: n.code, message: n.message, ...(n.details ? { details: n.details } : {}) },
  };

  // Stack traces are a development-only debugging aid.
  if (!env.isProduction && error?.stack) {
    body.error.stack = String(error.stack).split('\n').slice(0, 6);
  }

  res.status(n.statusCode).json(body);
}

function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
}

module.exports = { errorHandler, notFoundHandler };
