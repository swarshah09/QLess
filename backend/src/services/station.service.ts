import { Prisma, UserRole } from '@prisma/client';
import { AppError } from '../errors/AppError';
import {
  type StationRecord,
  stationRepository,
} from '../repositories/station.repository';
import { stationOperatorRepository } from '../repositories/stationOperator.repository';
import type { AuthenticatedUser } from '../types/auth';

/**
 * Station read/update needed by Part 2's authorization work only.
 * Discovery, distance search, status computation and reporting are Part 3.
 */

/** Fields an operator is allowed to change on a station they are assigned to. */
export interface OperatorStationUpdate {
  active?: boolean;
  numberOfDispensers?: number;
  operatingHours?: Prisma.InputJsonObject | null;
  pressureThresholdLow?: number | null;
  pressureThresholdNormal?: number | null;
}

export const stationService = {
  /**
   * Public listing. Guests and normal users see only active stations; admins
   * may opt into inactive ones for platform management.
   */
  async list(params: {
    page: number;
    limit: number;
    includeInactive?: boolean;
    viewer?: AuthenticatedUser;
  }): Promise<{ items: StationRecord[]; total: number }> {
    const canSeeInactive = params.viewer?.role === UserRole.ADMIN;

    return stationRepository.listPaginated({
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      includeInactive: canSeeInactive && params.includeInactive === true,
    });
  },

  /** Public detail. Inactive stations stay visible so clients can explain why. */
  async getById(id: string): Promise<StationRecord> {
    const station = await stationRepository.findById(id);
    if (!station) throw AppError.notFound('Station not found');
    return station;
  },

  /**
   * Applies an operator update.
   *
   * Authorization has already been enforced by `requireStationAssignment`; the
   * assignment is re-checked here anyway so the rule cannot be bypassed by a
   * future caller that forgets the middleware.
   */
  async updateAsOperator(
    stationId: string,
    actor: AuthenticatedUser,
    update: OperatorStationUpdate,
  ): Promise<StationRecord> {
    if (actor.role !== UserRole.ADMIN) {
      const assigned = await stationOperatorRepository.hasActiveAssignment(
        actor.id,
        stationId,
      );
      if (!assigned) {
        throw AppError.forbidden('You are not assigned to this station');
      }
    }

    const existing = await stationRepository.findById(stationId);
    if (!existing) throw AppError.notFound('Station not found');

    if (Object.keys(update).length === 0) {
      throw AppError.badRequest('No updatable fields were provided');
    }

    // A station with no dispensers cannot be serving anyone.
    if (update.numberOfDispensers !== undefined && update.numberOfDispensers < 1) {
      throw AppError.validation('A station must have at least one dispenser', [
        { field: 'numberOfDispensers', message: 'Must be at least 1' },
      ]);
    }

    const low = update.pressureThresholdLow ?? existing.pressureThresholdLow;
    const normal = update.pressureThresholdNormal ?? existing.pressureThresholdNormal;
    if (low !== null && normal !== null && low >= normal) {
      throw AppError.validation('Pressure thresholds are inconsistent', [
        {
          field: 'pressureThresholdLow',
          message: 'The low threshold must be below the normal threshold',
        },
      ]);
    }

    return stationRepository.update(stationId, {
      ...(update.active !== undefined && { active: update.active }),
      ...(update.numberOfDispensers !== undefined && {
        numberOfDispensers: update.numberOfDispensers,
      }),
      // Prisma needs the explicit JsonNull sentinel to write a SQL NULL into a
      // nullable Json column; plain `null` would mean "leave unchanged".
      ...(update.operatingHours !== undefined && {
        operatingHours: update.operatingHours ?? Prisma.JsonNull,
      }),
      ...(update.pressureThresholdLow !== undefined && {
        pressureThresholdLow: update.pressureThresholdLow,
      }),
      ...(update.pressureThresholdNormal !== undefined && {
        pressureThresholdNormal: update.pressureThresholdNormal,
      }),
    });
  },

  /** Stations the calling operator may act on. */
  async listAssignedStations(userId: string) {
    return stationOperatorRepository.listForUser(userId);
  },
};
