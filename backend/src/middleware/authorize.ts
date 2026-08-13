import { UserRole } from '@prisma/client';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../config/logger';
import { AppError } from '../errors/AppError';
import { stationOperatorRepository } from '../repositories/stationOperator.repository';
import { stationRepository } from '../repositories/station.repository';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Role-based access control.
 *
 * Roles come from `req.user`, which `authenticate` populated from the database.
 * Nothing here ever reads a role from the request body, a header or a query
 * parameter — a client-supplied role is not an input to any decision.
 */
export function requireRole(...allowed: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      // Ordering guard: requireRole is meaningless without authenticate first.
      return next(AppError.unauthorized('Authentication required'));
    }

    if (!allowed.includes(req.user.role)) {
      logger.warn(
        { userId: req.user.id, role: req.user.role, required: allowed, path: req.originalUrl },
        'Blocked request: insufficient role',
      );
      return next(AppError.forbidden('You do not have permission to perform this action'));
    }

    return next();
  };
}

/** Convenience wrappers for the two most common gates. */
export const requireAdmin = requireRole(UserRole.ADMIN);
export const requireOperator = requireRole(UserRole.STATION_OPERATOR, UserRole.ADMIN);

/**
 * Enforces the operator-station rule: an operator may only act on a station
 * they hold an active assignment for.
 *
 * This is the backend's authoritative check. The frontend hiding a station is
 * irrelevant — an operator calling this route directly for someone else's
 * station gets 403 here.
 *
 * Admins bypass the assignment requirement by design (they manage the whole
 * platform), but the station must still exist.
 *
 * A missing station yields 404 only for callers who are allowed to act on
 * stations at all; unauthorised callers get 403 first, so the endpoint cannot
 * be used to probe which station ids exist.
 */
export function requireStationAssignment(paramName = 'stationId'): RequestHandler {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw AppError.unauthorized('Authentication required');
    }

    const stationId = req.params[paramName];
    if (!stationId) {
      throw AppError.badRequest(`Missing ${paramName} in request path`);
    }

    // Normal users never manage stations, whatever the assignment table says.
    if (req.user.role === UserRole.USER) {
      logger.warn(
        { userId: req.user.id, stationId },
        'Blocked request: USER attempted a station management action',
      );
      throw AppError.forbidden('You do not have permission to manage this station');
    }

    if (req.user.role === UserRole.ADMIN) {
      const exists = await stationRepository.exists(stationId);
      if (!exists) throw AppError.notFound('Station not found');
      return next();
    }

    const assigned = await stationOperatorRepository.hasActiveAssignment(
      req.user.id,
      stationId,
    );

    if (!assigned) {
      logger.warn(
        { userId: req.user.id, stationId },
        'Blocked request: operator is not assigned to this station',
      );
      // Deliberately identical to the response for a station that does not
      // exist, so an operator cannot enumerate stations they have no rights to.
      throw AppError.forbidden('You are not assigned to this station');
    }

    return next();
  });
}
