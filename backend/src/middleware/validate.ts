import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { AppError, type ErrorDetail } from '../errors/AppError';

export interface RequestSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function zodIssuesToDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.message,
  }));
}

/**
 * Validates and replaces `req.body` / `req.query` / `req.params` with parsed,
 * coerced values. Keeping validation here means controllers can trust their
 * inputs and stay thin.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const details: ErrorDetail[] = [];

    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (result.success) {
        // req.query/params have only getters on some Express versions, so
        // assign through defineProperty to stay safe.
        Object.defineProperty(req, key, {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        details.push(
          ...zodIssuesToDetails(result.error).map((d) => ({
            ...d,
            field: d.field ? `${key}.${d.field}` : key,
          })),
        );
      }
    }

    if (details.length > 0) {
      return next(AppError.validation('Request validation failed', details));
    }
    return next();
  };
}
