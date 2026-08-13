import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError';

/** Converts unmatched routes into a standard 404 through the error pipeline. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
}
