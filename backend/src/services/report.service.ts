import { Availability, PressureUnit, type StationStatus, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../errors/AppError';
import { reportRepository } from '../repositories/report.repository';
import { stationRepository } from '../repositories/station.repository';
import type { AuthenticatedUser } from '../types/auth';
import { isPlausiblePressure } from '../utils/pressure';
import { storableRangeForLabel } from '../utils/queue';
import { locationVerificationService } from './locationVerification.service';
import { reportThrottleService } from './reportThrottle.service';
import { stationStatusService } from './stationStatus.service';

/**
 * Crowd reporting by ordinary authenticated users.
 *
 * Any signed-in USER may report queue length and availability, and optionally
 * pressure — no operator assignment is required. This is the primary data
 * source for the platform; operators are a higher-trust supplement, not a
 * prerequisite.
 */

export interface SubmitReportInput {
  /** One of the queue labels, e.g. "4-7". "UNKNOWN" is a valid answer. */
  queueRange?: string;
  availability?: Availability;
  pressureValue?: number;
  pressureUnit?: PressureUnit;
  latitude?: number;
  longitude?: number;
  note?: string;
}

export interface SubmitReportResult {
  reportIds: { queue?: string; availability?: string; pressure?: string };
  locationVerified: boolean;
  source: string;
  distanceToStationM: number | null;
  status: StationStatus;
}

export const reportService = {
  /**
   * Records a user's observation and refreshes the derived status.
   *
   * Partial reports are the norm — someone can see the queue from the road but
   * has no idea about pressure. Every field is optional; the only requirement
   * is that the submission says *something*.
   */
  async submit(
    stationId: string,
    reporter: AuthenticatedUser,
    input: SubmitReportInput,
  ): Promise<SubmitReportResult> {
    const station = await stationRepository.findById(stationId);
    if (!station) throw AppError.notFound('Station not found');

    if (!station.active) {
      throw AppError.badRequest('This station is not currently active');
    }

    const queue = input.queueRange ? storableRangeForLabel(input.queueRange) : null;

    // An explicit "not sure" for both fields carries no information at all.
    const reportsQueue = queue !== null && queue.min !== null;
    const reportsAvailability =
      input.availability !== undefined && input.availability !== Availability.UNKNOWN;
    const reportsPressure = input.pressureValue !== undefined;

    if (!reportsQueue && !reportsAvailability && !reportsPressure) {
      throw AppError.badRequest(
        'A report must include a queue length, an availability, or a pressure reading',
      );
    }

    const pressureUnit = input.pressureUnit ?? station.defaultPressureUnit;
    if (reportsPressure && !isPlausiblePressure(input.pressureValue!, pressureUnit)) {
      throw AppError.validation('Pressure reading is outside the plausible range', [
        { field: 'pressureValue', message: 'Value is not physically plausible' },
      ]);
    }

    // Trust level is derived server-side. Whatever the client claimed about
    // verification is not consulted here or anywhere downstream.
    const verification = locationVerificationService.verify({
      reporterRole: reporter.role,
      actingAsOperator: false,
      coordinates:
        input.latitude !== undefined && input.longitude !== undefined
          ? { latitude: input.latitude, longitude: input.longitude }
          : null,
      station: { latitude: station.latitude, longitude: station.longitude },
    });

    // Admins report through this route for convenience but are not throttled;
    // ordinary users always are.
    if (reporter.role !== UserRole.ADMIN) {
      await reportThrottleService.assertAllowed({
        userId: reporter.id,
        stationId,
        queueBucket: reportsQueue ? queue!.bucket : undefined,
        availability: reportsAvailability ? input.availability : undefined,
        pressureValue: reportsPressure ? input.pressureValue : undefined,
      });
    }

    const geo = {
      locationVerified: verification.locationVerified,
      reportedLatitude: verification.latitude,
      reportedLongitude: verification.longitude,
      distanceToStationM: verification.distanceToStationM,
    };

    // One transaction so a partially-written multi-part report cannot skew the
    // status that is computed immediately afterwards.
    const reportIds = await prisma.$transaction(async (tx) => {
      const ids: SubmitReportResult['reportIds'] = {};

      if (reportsQueue) {
        const created = await reportRepository.createQueueReport(
          {
            stationId,
            userId: reporter.id,
            queueMin: queue!.min,
            queueMax: queue!.max,
            queueBucket: queue!.bucket,
            source: verification.source,
            ...geo,
          },
          tx,
        );
        ids.queue = created.id;
      }

      if (reportsAvailability) {
        const created = await reportRepository.createAvailabilityReport(
          {
            stationId,
            userId: reporter.id,
            availability: input.availability!,
            note: input.note ?? null,
            source: verification.source,
            ...geo,
          },
          tx,
        );
        ids.availability = created.id;
      }

      if (reportsPressure) {
        const created = await reportRepository.createPressureReport(
          {
            stationId,
            userId: reporter.id,
            pressureValue: input.pressureValue!,
            pressureUnit,
            source: verification.source,
            ...geo,
          },
          tx,
        );
        ids.pressure = created.id;
      }

      return ids;
    });

    // Recomputed from the full history, never patched from this one report.
    const status = await stationStatusService.recompute(stationId);

    return {
      reportIds,
      locationVerified: verification.locationVerified,
      source: verification.source,
      distanceToStationM: verification.distanceToStationM,
      status,
    };
  },

  /** Raw report history for a station — the append-only record. */
  async history(stationId: string, params: { page: number; limit: number }) {
    const exists = await stationRepository.exists(stationId);
    if (!exists) throw AppError.notFound('Station not found');

    return reportRepository.listStationHistory({
      stationId,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    });
  },
};
