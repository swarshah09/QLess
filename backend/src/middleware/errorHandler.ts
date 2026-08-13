import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError, type ErrorDetail } from '../errors/AppError';
import { ErrorCode, type ErrorCodeValue } from '../errors/errorCodes';
import { errorBody } from '../utils/apiResponse';
import { zodIssuesToDetails } from './validate';

interface NormalizedError {
  statusCode: number;
  code: ErrorCodeValue | string;
  message: string;
  details?: ErrorDetail[];
  isOperational: boolean;
}

function normalizePrismaError(error: unknown): NormalizedError | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const target = (error.meta?.target as string[] | undefined)?.join(', ');
        return {
          statusCode: 409,
          code: ErrorCode.CONFLICT,
          message: target
            ? `A record with this ${target} already exists`
            : 'A record with these values already exists',
          isOperational: true,
        };
      }
      case 'P2025':
        return {
          statusCode: 404,
          code: ErrorCode.NOT_FOUND,
          message: 'The requested record was not found',
          isOperational: true,
        };
      case 'P2003':
        return {
          statusCode: 400,
          code: ErrorCode.BAD_REQUEST,
          message: 'Related record does not exist',
          isOperational: true,
        };
      default:
        return {
          statusCode: 500,
          code: ErrorCode.DATABASE_ERROR,
          message: 'A database error occurred',
          isOperational: false,
        };
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return {
      statusCode: 400,
      code: ErrorCode.BAD_REQUEST,
      message: 'Invalid database query',
      isOperational: false,
    };
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      statusCode: 503,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Database is unavailable',
      isOperational: false,
    };
  }

  return null;
}

function normalize(error: unknown): NormalizedError {
  if (error instanceof AppError) {
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
      details: zodIssuesToDetails(error),
      isOperational: true,
    };
  }

  const prismaError = normalizePrismaError(error);
  if (prismaError) return prismaError;

  // Body-parser errors surface as plain Errors with a `type`/`status`.
  const candidate = error as { type?: string; status?: number; message?: string };
  if (candidate?.type === 'entity.too.large') {
    return {
      statusCode: 413,
      code: ErrorCode.PAYLOAD_TOO_LARGE,
      message: 'Request body is too large',
      isOperational: true,
    };
  }
  if (candidate?.type === 'entity.parse.failed') {
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

/**
 * Centralized error handler — the single place that turns anything thrown into
 * the standard failure envelope. Stack traces are logged, never returned in
 * production.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalized = normalize(error);
  const logPayload = {
    method: req.method,
    path: req.originalUrl,
    statusCode: normalized.statusCode,
    code: normalized.code,
    requestId: res.getHeader('x-request-id'),
    err: error,
  };

  if (normalized.isOperational && normalized.statusCode < 500) {
    logger.warn(logPayload, normalized.message);
  } else {
    logger.error(logPayload, normalized.message);
  }

  const body = errorBody(normalized.code, normalized.message, normalized.details);

  // Stack traces are a development-only debugging aid.
  if (!env.isProduction && error instanceof Error && error.stack) {
    (body.error as Record<string, unknown>).stack = error.stack.split('\n');
  }

  res.status(normalized.statusCode).json(body);
}
