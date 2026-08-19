'use strict';

/**
 * Stable, client-facing error codes. The frontend branches on these strings,
 * so treat them as part of the public API contract.
 */
const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  REPORT_COOLDOWN: 'REPORT_COOLDOWN',
  DUPLICATE_REPORT: 'DUPLICATE_REPORT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
};

class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    /** True for errors we raised deliberately and can safely show to clients. */
    this.isOperational = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, ErrorCode.BAD_REQUEST, message, details);
  }
  static validation(message = 'Validation failed', details) {
    return new ApiError(422, ErrorCode.VALIDATION_ERROR, message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, ErrorCode.UNAUTHORIZED, message);
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(403, ErrorCode.FORBIDDEN, message);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, ErrorCode.NOT_FOUND, message);
  }
  static conflict(message = 'Resource already exists') {
    return new ApiError(409, ErrorCode.CONFLICT, message);
  }
  /** Cooldown on reporting; `retryAfterSeconds` guides the client. */
  static reportCooldown(message, retryAfterSeconds) {
    return new ApiError(
      429,
      ErrorCode.REPORT_COOLDOWN,
      message,
      retryAfterSeconds === undefined
        ? undefined
        : [{ field: 'retryAfterSeconds', message: String(retryAfterSeconds) }],
    );
  }
  static duplicateReport(message = 'An identical report was already submitted') {
    return new ApiError(409, ErrorCode.DUPLICATE_REPORT, message);
  }
  static internal(message = 'Something went wrong') {
    const error = new ApiError(500, ErrorCode.INTERNAL_ERROR, message);
    error.isOperational = false;
    return error;
  }
}

module.exports = { ApiError, ErrorCode };
