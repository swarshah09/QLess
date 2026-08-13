import type { StationStatus, StationStatusSnapshot } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * Append-only history of computed statuses.
 *
 * Like the raw reports, there is deliberately no update or delete method: a
 * snapshot records what the platform told drivers at a moment in time, and
 * rewriting it would defeat the point.
 */
export const statusSnapshotRepository = {
  async record(params: {
    stationId: string;
    status: StationStatus;
    queueSampleCount: number;
    availabilitySampleCount: number;
    pressureSampleCount: number;
    outlierCount: number;
  }): Promise<StationStatusSnapshot> {
    const { status } = params;

    return prisma.stationStatusSnapshot.create({
      data: {
        stationId: params.stationId,
        availability: status.availability,
        queueMin: status.queueMin,
        queueMax: status.queueMax,
        queueBucket: status.queueBucket,
        waitMin: status.waitMin,
        waitMax: status.waitMax,
        pressureValue: status.pressureValue,
        pressureUnit: status.pressureUnit,
        pressureStatus: status.pressureStatus,
        activeDispensers: status.activeDispensers,
        confidence: status.confidence,
        freshness: status.freshness,
        queueSampleCount: params.queueSampleCount,
        availabilitySampleCount: params.availabilitySampleCount,
        pressureSampleCount: params.pressureSampleCount,
        outlierCount: params.outlierCount,
        computedAt: status.computedAt,
      },
    });
  },

  async listForStation(params: {
    stationId: string;
    skip: number;
    take: number;
  }): Promise<{ items: StationStatusSnapshot[]; total: number }> {
    const where = { stationId: params.stationId };

    const [items, total] = await Promise.all([
      prisma.stationStatusSnapshot.findMany({
        where,
        orderBy: { computedAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.stationStatusSnapshot.count({ where }),
    ]);

    return { items, total };
  },

  async countForStation(stationId: string): Promise<number> {
    return prisma.stationStatusSnapshot.count({ where: { stationId } });
  },
};
