import type {
  Availability,
  AvailabilityReport,
  Prisma,
  PressureReport,
  PressureUnit,
  QueueBucket,
  QueueReport,
  ReportSource,
} from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * Raw report storage.
 *
 * APPEND-ONLY BY DESIGN. There is deliberately no update or delete method on
 * this repository: reports are the historical record from which the computed
 * `StationStatus` is derived, and rewriting them would destroy the evidence
 * behind every past status. Corrections are expressed as new reports.
 */

/** Fields shared by all three report kinds. */
interface BaseReportInput {
  stationId: string;
  userId: string | null;
  source: ReportSource;
  locationVerified: boolean;
  reportedLatitude?: number | null;
  reportedLongitude?: number | null;
  distanceToStationM?: number | null;
}

export interface QueueReportInput extends BaseReportInput {
  /** Both null means the reporter said "not sure" — never coerced to 0. */
  queueMin: number | null;
  queueMax: number | null;
  queueBucket: QueueBucket;
}

export interface AvailabilityReportInput extends BaseReportInput {
  availability: Availability;
  note?: string | null;
}

export interface PressureReportInput extends BaseReportInput {
  pressureValue: number;
  pressureUnit: PressureUnit;
}

function geoFields(input: BaseReportInput) {
  return {
    locationVerified: input.locationVerified,
    reportedLatitude: input.reportedLatitude ?? null,
    reportedLongitude: input.reportedLongitude ?? null,
    distanceToStationM: input.distanceToStationM ?? null,
  };
}

export const reportRepository = {
  async createQueueReport(
    input: QueueReportInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<QueueReport> {
    return tx.queueReport.create({
      data: {
        stationId: input.stationId,
        userId: input.userId,
        queueMin: input.queueMin,
        queueMax: input.queueMax,
        queueBucket: input.queueBucket,
        source: input.source,
        ...geoFields(input),
      },
    });
  },

  async createAvailabilityReport(
    input: AvailabilityReportInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AvailabilityReport> {
    return tx.availabilityReport.create({
      data: {
        stationId: input.stationId,
        userId: input.userId,
        availability: input.availability,
        note: input.note ?? null,
        source: input.source,
        ...geoFields(input),
      },
    });
  },

  async createPressureReport(
    input: PressureReportInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<PressureReport> {
    return tx.pressureReport.create({
      data: {
        stationId: input.stationId,
        userId: input.userId,
        pressureValue: input.pressureValue,
        pressureUnit: input.pressureUnit,
        source: input.source,
        ...geoFields(input),
      },
    });
  },

  // --- Reads used by the status computation -------------------------------

  async recentQueueReports(stationId: string, since: Date): Promise<QueueReport[]> {
    return prisma.queueReport.findMany({
      where: { stationId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async recentAvailabilityReports(
    stationId: string,
    since: Date,
  ): Promise<AvailabilityReport[]> {
    return prisma.availabilityReport.findMany({
      where: { stationId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async recentPressureReports(stationId: string, since: Date): Promise<PressureReport[]> {
    return prisma.pressureReport.findMany({
      where: { stationId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
  },

  // --- Reads used by throttling -------------------------------------------

  /** Most recent report of any kind by this user for this station. */
  async lastReportAtForUserStation(
    userId: string,
    stationId: string,
  ): Promise<Date | null> {
    const [queue, availability, pressure] = await Promise.all([
      prisma.queueReport.findFirst({
        where: { userId, stationId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.availabilityReport.findFirst({
        where: { userId, stationId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.pressureReport.findFirst({
        where: { userId, stationId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const timestamps = [queue, availability, pressure]
      .filter((row): row is { createdAt: Date } => row !== null)
      .map((row) => row.createdAt);

    if (timestamps.length === 0) return null;
    return timestamps.reduce((latest, d) => (d > latest ? d : latest));
  },

  /** Most recent report of any kind by this user for any station. */
  async lastReportAtForUser(userId: string): Promise<Date | null> {
    const [queue, availability, pressure] = await Promise.all([
      prisma.queueReport.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.availabilityReport.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.pressureReport.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const timestamps = [queue, availability, pressure]
      .filter((row): row is { createdAt: Date } => row !== null)
      .map((row) => row.createdAt);

    if (timestamps.length === 0) return null;
    return timestamps.reduce((latest, d) => (d > latest ? d : latest));
  },

  /**
   * Counts a user's report submissions since a cutoff. A single submission may
   * write up to three rows, so the queue table alone would undercount; the
   * maximum across the three kinds approximates submissions without
   * double-counting a combined report.
   */
  async countReportsSince(
    userId: string,
    since: Date,
    stationId?: string,
  ): Promise<number> {
    const where = stationId
      ? { userId, stationId, createdAt: { gte: since } }
      : { userId, createdAt: { gte: since } };

    const [queue, availability, pressure] = await Promise.all([
      prisma.queueReport.count({ where }),
      prisma.availabilityReport.count({ where }),
      prisma.pressureReport.count({ where }),
    ]);

    return Math.max(queue, availability, pressure);
  },

  /**
   * Finds a recent identical submission from the same user, used to reject
   * double-taps and client retries without penalising genuine re-reports.
   */
  async findDuplicate(params: {
    userId: string;
    stationId: string;
    since: Date;
    queueBucket?: QueueBucket;
    availability?: Availability;
    pressureValue?: number;
  }): Promise<boolean> {
    const checks: Array<Promise<unknown | null>> = [];

    if (params.queueBucket) {
      checks.push(
        prisma.queueReport.findFirst({
          where: {
            userId: params.userId,
            stationId: params.stationId,
            queueBucket: params.queueBucket,
            createdAt: { gte: params.since },
          },
          select: { id: true },
        }),
      );
    }

    if (params.availability) {
      checks.push(
        prisma.availabilityReport.findFirst({
          where: {
            userId: params.userId,
            stationId: params.stationId,
            availability: params.availability,
            createdAt: { gte: params.since },
          },
          select: { id: true },
        }),
      );
    }

    if (params.pressureValue !== undefined) {
      checks.push(
        prisma.pressureReport.findFirst({
          where: {
            userId: params.userId,
            stationId: params.stationId,
            pressureValue: params.pressureValue,
            createdAt: { gte: params.since },
          },
          select: { id: true },
        }),
      );
    }

    if (checks.length === 0) return false;

    const results = await Promise.all(checks);
    // Every component of the submission must match for it to be a duplicate;
    // a changed queue alongside an unchanged availability is still new news.
    return results.every((result) => result !== null);
  },

  // --- History reads -------------------------------------------------------

  async listStationHistory(params: {
    stationId: string;
    skip: number;
    take: number;
  }) {
    const [queue, availability, pressure] = await Promise.all([
      prisma.queueReport.findMany({
        where: { stationId: params.stationId },
        orderBy: { createdAt: 'desc' },
        take: params.take,
        skip: params.skip,
      }),
      prisma.availabilityReport.findMany({
        where: { stationId: params.stationId },
        orderBy: { createdAt: 'desc' },
        take: params.take,
        skip: params.skip,
      }),
      prisma.pressureReport.findMany({
        where: { stationId: params.stationId },
        orderBy: { createdAt: 'desc' },
        take: params.take,
        skip: params.skip,
      }),
    ]);

    return { queue, availability, pressure };
  },
};
