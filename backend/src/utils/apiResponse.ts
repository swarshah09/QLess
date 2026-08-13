import type { Response } from 'express';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  PaginatedData,
  PaginationMeta,
} from '../types/api';
import type { ErrorDetail } from '../errors/AppError';
import type { ErrorCodeValue } from '../errors/errorCodes';

/**
 * Response helpers. All controllers must go through these so the envelope
 * stays identical across every endpoint and every client platform.
 */

export function successBody<T>(data: T, meta?: Record<string, unknown>): ApiSuccessResponse<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function errorBody(
  code: ErrorCodeValue | string,
  message: string,
  details?: ErrorDetail[],
): ApiErrorResponse {
  return {
    success: false,
    error: details && details.length > 0 ? { code, message, details } : { code, message },
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>,
): Response {
  return res.status(statusCode).json(successBody(data, meta));
}

export function sendCreated<T>(res: Response, data: T): Response {
  return sendSuccess(res, data, 201);
}

export function sendError(
  res: Response,
  statusCode: number,
  code: ErrorCodeValue | string,
  message: string,
  details?: ErrorDetail[],
): Response {
  return res.status(statusCode).json(errorBody(code, message, details));
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
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

export function sendPaginated<T>(
  res: Response,
  items: T[],
  page: number,
  limit: number,
  total: number,
): Response {
  const payload: PaginatedData<T> = {
    items,
    pagination: buildPaginationMeta(page, limit, total),
  };
  return sendSuccess(res, payload);
}
