import { Availability, Prisma, PressureUnit, ReportSource } from '@prisma/client';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { AppError } from '../errors/AppError';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { reportRepository } from '../repositories/report.repository';
import { stationRepository, stationSelect } from '../repositories/station.repository';
import { bucketForRange } from '../utils/queue';
import { stationStateService } from './stationState.service';
import type { AuthContext, AuthenticatedUser } from '../types/auth';

/**
 * Admin station management.
 *
 * Manual overrides are the sensitive path here: an admin can force a station's
 * state, so every override records WHO, WHY and WHEN, and writes an ordinary
 * report row rather than mutating history.
 */

async function audit(
  actor: AuthenticatedUser,
  context: AuthContext,
  entry: {
    action: string;
    entityType: string;
    entityId?: string;
    reason?: string | null;
    before?: Prisma.InputJsonObject;
    after?: Prisma.InputJsonObject;
  },
): Promise<void> {
  try {
    await auditLogRepository.record({
      adminUserId: actor.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      reason: entry.reason ?? null,
      before: entry.before,
      after: entry.after,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });
  } catch (error) {
    logger.error({ err: error, ...entry }, 'Failed to write audit log entry');
  }
}

export interface CreateStationInput {
  name: string;
  address: string;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude: number;
  longitude: number;
  numberOfDispensers?: number;
  operatingHours?: Prisma.InputJsonObject | null;
  pressureThresholdLow?: number | null;
  pressureThresholdNormal?: number | null;
  defaultPressureUnit?: PressureUnit;
  active?: boolean;
}

export type UpdateStationInput = Partial<CreateStationInput>;

/** Low must sit below normal, or pressure classification is incoherent. */
function assertThresholdsCoherent(
  low: number | null | undefined,
  normal: number | null | undefined,
): void {
  if (low === null || low === undefined) return;
  if (normal === null || normal === undefined) return;

  if (low >= normal) {
    throw AppError.validation('Pressure thresholds are inconsistent', [
      {
        field: 'pressureThresholdLow',
        message: 'The low threshold must be below the normal threshold',
      },
    ]);
  }
}

export const adminStationService = {
  async list(params: {
    page: number;
    limit: number;
    includeInactive: boolean;
    search?: string;
  }) {
    const where: Prisma.StationWhereInput = {
      ...(params.includeInactive ? {} : { active: true }),
      ...(params.search && {
        OR: [
          { name: { contains: params.search, mode: 'insensitive' as const } },
          { address: { contains: params.search, mode: 'insensitive' as const } },
          { city: { contains: params.search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      prisma.station.findMany({
        where,
        select: { ...stationSelect, status: true, _count: { select: { operators: true } } },
        orderBy: { name: 'asc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.station.count({ where }),
    ]);

    return { items, total };
  },

  async create(
    input: CreateStationInput,
    actor: AuthenticatedUser,
    context: AuthContext,
  ) {
    assertThresholdsCoherent(input.pressureThresholdLow, input.pressureThresholdNormal);

    const station = await prisma.station.create({
      data: {
        name: input.name,
        address: input.address,
        city: input.city ?? null,
        state: input.state ?? null,
        pincode: input.pincode ?? null,
        latitude: input.latitude,
        longitude: input.longitude,
        numberOfDispensers: input.numberOfDispensers ?? 1,
        operatingHours: input.operatingHours ?? undefined,
        pressureThresholdLow: input.pressureThresholdLow ?? null,
        pressureThresholdNormal: input.pressureThresholdNormal ?? null,
        defaultPressureUnit: input.defaultPressureUnit ?? PressureUnit.BAR,
        active: input.active ?? true,
      },
      select: stationSelect,
    });

    await audit(actor, context, {
      action: 'STATION_CREATED',
      entityType: 'Station',
      entityId: station.id,
      after: { name: station.name, latitude: station.latitude, longitude: station.longitude },
    });

    return station;
  },

  async update(
    stationId: string,
    input: UpdateStationInput,
    actor: AuthenticatedUser,
    context: AuthContext,
  ) {
    const existing = await stationRepository.findById(stationId);
    if (!existing) throw AppError.notFound('Station not found');

    assertThresholdsCoherent(
      input.pressureThresholdLow !== undefined
        ? input.pressureThresholdLow
        : existing.pressureThresholdLow,
      input.pressureThresholdNormal !== undefined
        ? input.pressureThresholdNormal
        : existing.pressureThresholdNormal,
    );

    const station = await prisma.station.update({
      where: { id: stationId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.city !== undefined && { city: input.city }),
        ...(input.state !== undefined && { state: input.state }),
        ...(input.pincode !== undefined && { pincode: input.pincode }),
        ...(input.latitude !== undefined && { latitude: input.latitude }),
        ...(input.longitude !== undefined && { longitude: input.longitude }),
        ...(input.numberOfDispensers !== undefined && {
          numberOfDispensers: input.numberOfDispensers,
        }),
        ...(input.operatingHours !== undefined && {
          operatingHours: input.operatingHours ?? Prisma.JsonNull,
        }),
        ...(input.pressureThresholdLow !== undefined && {
          pressureThresholdLow: input.pressureThresholdLow,
        }),
        ...(input.pressureThresholdNormal !== undefined && {
          pressureThresholdNormal: input.pressureThresholdNormal,
        }),
        ...(input.defaultPressureUnit !== undefined && {
          defaultPressureUnit: input.defaultPressureUnit,
        }),
      },
      select: stationSelect,
    });

    await audit(actor, context, {
      action: 'STATION_UPDATED',
      entityType: 'Station',
      entityId: stationId,
      before: existing as unknown as Prisma.InputJsonObject,
      after: station as unknown as Prisma.InputJsonObject,
    });

    // Thresholds feed pressure classification, so the derived status is stale
    // the moment they change.
    if (
      input.pressureThresholdLow !== undefined ||
      input.pressureThresholdNormal !== undefined
    ) {
      await stationStateService.recompute(stationId);
    }

    return station;
  },

  /**
   * Enables or disables a station. A reason is required: taking a station off
   * the map is user-visible and must be explicable afterwards.
   */
  async setActive(
    stationId: string,
    active: boolean,
    reason: string,
    actor: AuthenticatedUser,
    context: AuthContext,
  ) {
    const existing = await stationRepository.findById(stationId);
    if (!existing) throw AppError.notFound('Station not found');

    const station = await prisma.station.update({
      where: { id: stationId },
      data: { active },
      select: stationSelect,
    });

    await audit(actor, context, {
      action: active ? 'STATION_ENABLED' : 'STATION_DISABLED',
      entityType: 'Station',
      entityId: stationId,
      reason,
      before: { active: existing.active },
      after: { active: station.active },
    });

    logger.info({ adminId: actor.id, stationId, active, reason }, 'Station availability toggled');
    return station;
  },

  /**
   * Manual override of a station's reported state.
   *
   * Deliberately NOT a direct write to StationStatus. The override is recorded
   * as ADMIN-sourced report rows and the status is recomputed from history like
   * any other input, so the override is visible in the record rather than
   * appearing as though the crowd reported it.
   *
   * `reason` is mandatory — an override without one cannot be reviewed later.
   */
  async overrideStatus(
    stationId: string,
    input: {
      availability?: Availability;
      queueMin?: number | null;
      queueMax?: number | null;
      pressureValue?: number | null;
      pressureUnit?: PressureUnit;
      activeDispensers?: number;
      reason: string;
    },
    actor: AuthenticatedUser,
    context: AuthContext,
  ) {
    const station = await stationRepository.findById(stationId);
    if (!station) throw AppError.notFound('Station not found');

    if (!input.reason?.trim()) {
      throw AppError.badRequest('A reason is required for a manual override');
    }

    const before = await prisma.stationStatus.findUnique({ where: { stationId } });
    const overriddenAt = new Date();

    await prisma.$transaction(async (tx) => {
      if (input.availability !== undefined) {
        await reportRepository.createAvailabilityReport(
          {
            stationId,
            userId: actor.id,
            availability: input.availability,
            note: `Admin override: ${input.reason}`.slice(0, 500),
            source: ReportSource.ADMIN,
            locationVerified: true,
          },
          tx,
        );

        if (input.activeDispensers !== undefined) {
          const created = await tx.availabilityReport.findFirst({
            where: { stationId, userId: actor.id, source: ReportSource.ADMIN },
            orderBy: { createdAt: 'desc' },
          });
          if (created) {
            await tx.availabilityReport.update({
              where: { id: created.id },
              data: { activeDispensers: input.activeDispensers },
            });
          }
        }
      }

      if (input.queueMin !== undefined && input.queueMin !== null) {
        const max = input.queueMax ?? input.queueMin;
        await reportRepository.createQueueReport(
          {
            stationId,
            userId: actor.id,
            queueMin: input.queueMin,
            queueMax: max,
            queueBucket: bucketForRange({ min: input.queueMin, max }),
            source: ReportSource.ADMIN,
            locationVerified: true,
          },
          tx,
        );
      }

      if (input.pressureValue !== undefined && input.pressureValue !== null) {
        await reportRepository.createPressureReport(
          {
            stationId,
            userId: actor.id,
            pressureValue: input.pressureValue,
            pressureUnit: input.pressureUnit ?? station.defaultPressureUnit,
            source: ReportSource.ADMIN,
            locationVerified: true,
          },
          tx,
        );
      }
    });

    const { status } = await stationStateService.recompute(stationId);

    // WHO (adminUserId), WHY (reason) and WHEN (createdAt/overriddenAt).
    await audit(actor, context, {
      action: 'STATION_STATUS_OVERRIDDEN',
      entityType: 'StationStatus',
      entityId: stationId,
      reason: input.reason,
      before: (before ?? {}) as unknown as Prisma.InputJsonObject,
      after: {
        ...(status as unknown as Prisma.InputJsonObject),
        overriddenAt: overriddenAt.toISOString(),
      },
    });

    logger.warn(
      { adminId: actor.id, stationId, reason: input.reason },
      'Station status manually overridden by admin',
    );

    return { status, overriddenAt, reason: input.reason };
  },

  /**
   * Suspicious reports for moderation review.
   *
   * Read-only: reports are never deleted. Moderation acts on the reporter's
   * reputation, not by rewriting the record.
   */
  async suspiciousReports(params: { page: number; limit: number; sinceHours: number }) {
    const since = new Date(Date.now() - params.sinceHours * 60 * 60_000);
    const skip = (params.page - 1) * params.limit;

    // Low-reputation reporters are the practical definition of "worth a look".
    const lowReputation = await prisma.reporterReputation.findMany({
      where: { score: { lt: 35 }, totalReports: { gte: 3 } },
      select: { userId: true, score: true, totalReports: true, rejectedReports: true },
      orderBy: { score: 'asc' },
      take: 100,
    });

    const suspectIds = lowReputation.map((row) => row.userId);

    const where: Prisma.QueueReportWhereInput = {
      createdAt: { gte: since },
      OR: [
        // Unverified reports from users we already distrust.
        ...(suspectIds.length > 0
          ? [{ userId: { in: suspectIds }, locationVerified: false }]
          : []),
        // Implausibly large queues from anyone unverified.
        { queueMin: { gte: 100 }, locationVerified: false },
      ],
    };

    const [items, total] = await Promise.all([
      prisma.queueReport.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
          station: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      prisma.queueReport.count({ where }),
    ]);

    return { items, total, lowReputationReporters: lowReputation };
  },

  /** Platform-wide report activity. */
  async reportStatistics(params: { sinceHours: number }) {
    const since = new Date(Date.now() - params.sinceHours * 60 * 60_000);
    const where = { createdAt: { gte: since } };

    const [queue, availability, pressure, bySource, activeReporters] = await Promise.all([
      prisma.queueReport.count({ where }),
      prisma.availabilityReport.count({ where }),
      prisma.pressureReport.count({ where }),
      prisma.queueReport.groupBy({ by: ['source'], where, _count: true }),
      prisma.queueReport.findMany({
        where,
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    return {
      windowHours: params.sinceHours,
      totals: { queue, availability, pressure, all: queue + availability + pressure },
      queueReportsBySource: Object.fromEntries(
        bySource.map((row) => [row.source, row._count]),
      ),
      distinctReporters: activeReporters.filter((row) => row.userId !== null).length,
    };
  },

  /** Notification delivery health. */
  async notificationStatistics(params: { sinceHours: number }) {
    const since = new Date(Date.now() - params.sinceHours * 60 * 60_000);
    const where = { createdAt: { gte: since } };

    const [byStatus, totalRules, enabledRules, activeSubscriptions, topStations] =
      await Promise.all([
        prisma.notificationEvent.groupBy({ by: ['status'], where, _count: true }),
        prisma.notificationRule.count(),
        prisma.notificationRule.count({ where: { enabled: true } }),
        prisma.pushSubscription.count({ where: { active: true } }),
        prisma.notificationEvent.groupBy({
          by: ['stationId'],
          where,
          _count: true,
          orderBy: { _count: { stationId: 'desc' } },
          take: 5,
        }),
      ]);

    const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count]));
    const sent = counts.SENT ?? 0;
    const failed = counts.FAILED ?? 0;

    return {
      windowHours: params.sinceHours,
      events: {
        sent,
        failed,
        pending: counts.PENDING ?? 0,
        suppressed: counts.SUPPRESSED ?? 0,
        // Null rather than a misleading 0% when nothing was attempted.
        deliveryRate: sent + failed > 0 ? Math.round((sent / (sent + failed)) * 100) : null,
      },
      rules: { total: totalRules, enabled: enabledRules },
      activeSubscriptions,
      topStations: topStations.map((row) => ({
        stationId: row.stationId,
        events: row._count,
      })),
    };
  },

  /**
   * Effective platform configuration.
   *
   * Read-only: these come from environment and constants, so changing them is a
   * deploy concern, not a runtime API. Exposed so an admin can confirm what the
   * running instance is actually using.
   */
  async platformSettings() {
    const { FRESHNESS_THRESHOLDS_MINUTES, PRESSURE_DEFAULTS, WAIT_ESTIMATION, REPORT_LIMITS, NOTIFICATIONS, RECOMMENDATION, SOURCE_WEIGHTS, STATUS_INPUT_WINDOW_MINUTES } =
      await import('../config/constants');
    const { env } = await import('../config/env');

    return {
      freshnessThresholdsMinutes: FRESHNESS_THRESHOLDS_MINUTES,
      pressureDefaults: PRESSURE_DEFAULTS,
      waitEstimation: WAIT_ESTIMATION,
      reportLimits: REPORT_LIMITS,
      notifications: NOTIFICATIONS,
      recommendation: RECOMMENDATION,
      sourceWeights: SOURCE_WEIGHTS,
      statusInputWindowMinutes: STATUS_INPUT_WINDOW_MINUTES,
      locationVerificationRadiusM: env.LOCATION_VERIFICATION_RADIUS_M,
      webPushConfigured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    };
  },
};
