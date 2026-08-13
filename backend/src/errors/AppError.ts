import { ErrorCode, type ErrorCodeValue } from './errorCodes';

export interface ErrorDetail {
  field?: string;
  message: string;
}

/**
 * Application error carrying everything the error handler needs to build a
 * response. Anything thrown that is NOT an AppError is treated as unexpected
 * and reported as a generic 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCodeValue;
  readonly details?: ErrorDetail[];
  /** True for errors we raised deliberately and can safely show to clients. */
  readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: ErrorCodeValue,
    message: string,
    details?: ErrorDetail[],
    isOperational = true,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message = 'Bad request', details?: ErrorDetail[]) {
    return new AppError(400, ErrorCode.BAD_REQUEST, message, details);
  }

  static validation(message = 'Validation failed', details?: ErrorDetail[]) {
    return new AppError(422, ErrorCode.VALIDATION_ERROR, message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new AppError(401, ErrorCode.UNAUTHORIZED, message);
  }

  static forbidden(message = 'You do not have access to this resource') {
    return new AppError(403, ErrorCode.FORBIDDEN, message);
  }

  static notFound(message = 'Resource not found') {
    return new AppError(404, ErrorCode.NOT_FOUND, message);
  }

  static conflict(message = 'Resource already exists') {
    return new AppError(409, ErrorCode.CONFLICT, message);
  }

  static rateLimited(message = 'Too many requests') {
    return new AppError(429, ErrorCode.RATE_LIMITED, message);
  }

  /** Cooldown or per-window cap on reporting; `retryAfterSeconds` guides clients. */
  static reportCooldown(message: string, retryAfterSeconds?: number) {
    return new AppError(
      429,
      ErrorCode.REPORT_COOLDOWN,
      message,
      retryAfterSeconds === undefined
        ? undefined
        : [{ field: 'retryAfterSeconds', message: String(retryAfterSeconds) }],
    );
  }

  static duplicateReport(message = 'An identical report was already submitted') {
    return new AppError(409, ErrorCode.DUPLICATE_REPORT, message);
  }

  static internal(message = 'Something went wrong') {
    return new AppError(500, ErrorCode.INTERNAL_ERROR, message, undefined, false);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable') {
    return new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, message);
  }
}
