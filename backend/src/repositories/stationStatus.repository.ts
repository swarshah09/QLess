import type {
  Availability,
  Freshness,
  Prisma,
  PressureStatus,
  PressureUnit,
  QueueBucket,
  StationStatus,
} from '@prisma/client';
import { prisma } from '../config/prisma';

export interface StatusUpsertInput {
  stationId: string;
  availability: Availability;
  queueMin: number | null;
  queueMax: number | null;
  queueBucket: QueueBucket;
  waitMin: number | null;
  waitMax: number | null;
  pressureValue: number | null;
  pressureUnit: PressureUnit;
  pressureStatus: PressureStatus;
  activeDispensers: number | null;
  confidence: number;
  freshness: Freshness;
  computedAt: Date;
  lastOperatorUpdateAt: Date | null;
  lastUserUpdateAt: Date | null;
}

/**
 * The computed current-state projection.
 *
 * This row is overwritten on every recomputation, which is safe precisely
 * because it is derived data — the raw reports it was computed from are never
 * touched. Nothing here should ever be read as history.
 */
export const stationStatusRepository = {
  async findByStationId(stationId: string): Promise<StationStatus | null> {
    return prisma.stationStatus.findUnique({ where: { stationId } });
  },

  async findManyByStationIds(stationIds: string[]): Promise<StationStatus[]> {
    if (stationIds.length === 0) return [];
    return prisma.stationStatus.findMany({ where: { stationId: { in: stationIds } } });
  },

  async upsert(
    input: StatusUpsertInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<StationStatus> {
    const { stationId, ...fields } = input;

    return tx.stationStatus.upsert({
      where: { stationId },
      create: { stationId, ...fields },
      update: fields,
    });
  },
};
