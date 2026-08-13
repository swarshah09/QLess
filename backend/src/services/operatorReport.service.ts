import {
  Availability,
  PressureUnit,
  ReportSource,
  type StationStatus,
  type SupplyEvent,
  type SupplyEventType,
  UserRole,
} from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../errors/AppError';
import { reportRepository } from '../repositories/report.repository';
import { stationRepository } from '../repositories/station.repository';
import { stationOperatorRepository } from '../repositories/stationOperator.repository';
import { supplyEventRepository } from '../repositories/supplyEvent.repository';
import type { AuthenticatedUser } from '../types/auth';
import { isPlausiblePressure } from '../utils/pressure';
import { storableRangeForLabel } from '../utils/queue';
import { stationStatusService } from './stationStatus.service';

/**
 * Operator updates for an assigned station.
 *
 * Critically, an operator update is NOT a direct write to `StationStatus`. It
 * creates the same append-only report rows a user report would, tagged with
 * `source: OPERATOR`, and the status is then recomputed from that history like
 * any other. This keeps one code path to reason about and means an operator
 * update is fully auditable after the fact.
 */

export interface OperatorUpdateInput {
  queueRange?: string;
  availability?: Availability;
  pressureValue?: number;
  pressureUnit?: PressureUnit;
  activeDispensers?: number;
  note?: string;
}

export interface OperatorUpdateResult {
  reportIds: { queue?: string; availability?: string; pressure?: string };
  status: StationStatus;
}

/**
 * Re-asserts the assignment rule at the service boundary.
 *
 * `requireStationAssignment` already enforces this on the route; repeating the
 * check here means the rule holds even if a future caller reaches the service
 * another way.
 */
async function assertMayOperate(
  actor: AuthenticatedUser,
  stationId: string,
): Promise<void> {
  if (actor.role === UserRole.ADMIN) return;

  if (actor.role !== UserRole.STATION_OPERATOR) {
    throw AppError.forbidden('You do not have permission to manage this station');
  }

  const assigned = await stationOperatorRepository.hasActiveAssignment(actor.id, stationId);
  if (!assigned) {
    throw AppError.forbidden('You are not assigned to this station');
  }
}

export const operatorReportService = {
  /** Records an operator's station update as history, then recomputes status. */
  async update(
    stationId: string,
    actor: AuthenticatedUser,
    input: OperatorUpdateInput,
  ): Promise<OperatorUpdateResult> {
    await assertMayOperate(actor, stationId);

    const station = await stationRepository.findById(stationId);
    if (!station) throw AppError.notFound('Station not found');

    const queue = input.queueRange ? storableRangeForLabel(input.queueRange) : null;
    const reportsQueue = queue !== null && queue.min !== null;
    const reportsAvailability =
      input.availability !== undefined && input.availability !== Availability.UNKNOWN;
    const reportsPressure = input.pressureValue !== undefined;
    const reportsDispensers = input.activeDispensers !== undefined;

    if (!reportsQueue && !reportsAvailability && !reportsPressure && !reportsDispensers) {
      throw AppError.badRequest('An update must change at least one observable value');
    }

    const pressureUnit = input.pressureUnit ?? station.defaultPressureUnit;
    if (reportsPressure && !isPlausiblePressure(input.pressureValue!, pressureUnit)) {
      throw AppError.validation('Pressure reading is outside the plausible range', [
        { field: 'pressureValue', message: 'Value is not physically plausible' },
      ]);
    }

    if (reportsDispensers && input.activeDispensers! > station.numberOfDispensers) {
      throw AppError.validation('More active dispensers than the station has', [
        {
          field: 'activeDispensers',
          message: `This station has ${station.numberOfDispensers} dispensers`,
        },
      ]);
    }

    // Operators are authoritative for their own station, and their location is
    // established by the assignment rather than by GPS.
    const source = actor.role === UserRole.ADMIN ? ReportSource.ADMIN : ReportSource.OPERATOR;
    const geo = {
      locationVerified: true,
      reportedLatitude: null,
      reportedLongitude: null,
      distanceToStationM: null,
    };

    const reportIds = await prisma.$transaction(async (tx) => {
      const ids: OperatorUpdateResult['reportIds'] = {};

      if (reportsQueue) {
        const created = await reportRepository.createQueueReport(
          {
            stationId,
            userId: actor.id,
            queueMin: queue!.min,
            queueMax: queue!.max,
            queueBucket: queue!.bucket,
            source,
            ...geo,
          },
          tx,
        );
        ids.queue = created.id;
      }

      // A dispenser count is an observation about availability, so it rides on
      // an availability report. When the operator reported only the count, the
      // availability itself is left UNKNOWN rather than assumed.
      if (reportsAvailability || reportsDispensers) {
        const created = await reportRepository.createAvailabilityReport(
          {
            stationId,
            userId: actor.id,
            availability: input.availability ?? Availability.UNKNOWN,
            note: input.note ?? null,
            source,
            ...geo,
          },
          tx,
        );

        if (reportsDispensers) {
          await tx.availabilityReport.update({
            where: { id: created.id },
            data: { activeDispensers: input.activeDispensers },
          });
        }

        if (reportsAvailability) ids.availability = created.id;
      }

      if (reportsPressure) {
        const created = await reportRepository.createPressureReport(
          {
            stationId,
            userId: actor.id,
            pressureValue: input.pressureValue!,
            pressureUnit,
            source,
            ...geo,
          },
          tx,
        );
        ids.pressure = created.id;
      }

      return ids;
    });

    const status = await stationStatusService.recompute(stationId);
    return { reportIds, status };
  },

  /**
   * Records a supply event.
   *
   * Some event types imply an availability change, so a matching availability
   * report is written alongside — again as history, so the status recomputation
   * picks it up through the normal path.
   */
  async recordSupplyEvent(
    stationId: string,
    actor: AuthenticatedUser,
    input: { type: SupplyEventType; note?: string; availability?: Availability },
  ): Promise<{ event: SupplyEvent; status: StationStatus }> {
    await assertMayOperate(actor, stationId);

    const station = await stationRepository.findById(stationId);
    if (!station) throw AppError.notFound('Station not found');

    const source = actor.role === UserRole.ADMIN ? ReportSource.ADMIN : ReportSource.OPERATOR;

    /**
     * Availability implied by each event type. An explicit `availability` in
     * the request overrides this; `null` means the event says nothing definite
     * about availability on its own.
     */
    const impliedAvailability: Partial<Record<SupplyEventType, Availability>> = {
      SUPPLY_ARRIVED: Availability.AVAILABLE,
      LOW_SUPPLY: Availability.LOW_SUPPLY,
      CNG_FINISHED: Availability.UNAVAILABLE,
      TEMPORARY_INTERRUPTION: Availability.TEMPORARILY_INTERRUPTED,
      SUPPLY_RESTORED: Availability.AVAILABLE,
      MAINTENANCE_START: Availability.TEMPORARILY_INTERRUPTED,
      STATION_CLOSED: Availability.UNAVAILABLE,
      STATION_REOPENED: Availability.AVAILABLE,
    };

    const availability = input.availability ?? impliedAvailability[input.type] ?? null;

    const event = await prisma.$transaction(async (tx) => {
      const created = await supplyEventRepository.create(
        {
          stationId,
          reportedByUserId: actor.id,
          type: input.type,
          source,
          note: input.note ?? null,
        },
        tx,
      );

      if (availability) {
        await reportRepository.createAvailabilityReport(
          {
            stationId,
            userId: actor.id,
            availability,
            note: input.note ?? `Supply event: ${input.type}`,
            source,
            locationVerified: true,
          },
          tx,
        );
      }

      return created;
    });

    const status = await stationStatusService.recompute(stationId);
    return { event, status };
  },

  /** Closes an open supply event by recording when it ended. */
  async closeSupplyEvent(
    stationId: string,
    eventId: string,
    actor: AuthenticatedUser,
  ): Promise<SupplyEvent> {
    await assertMayOperate(actor, stationId);

    const event = await supplyEventRepository.findById(eventId);
    if (!event || event.stationId !== stationId) {
      throw AppError.notFound('Supply event not found');
    }

    if (event.endedAt) {
      throw AppError.conflict('This supply event is already closed');
    }

    return supplyEventRepository.close(eventId);
  },

  async listSupplyEvents(stationId: string, params: { page: number; limit: number }) {
    const exists = await stationRepository.exists(stationId);
    if (!exists) throw AppError.notFound('Station not found');

    return supplyEventRepository.listForStation({
      stationId,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    });
  },
};
