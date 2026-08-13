import type {
  Prisma,
  ReportSource,
  SupplyEvent,
  SupplyEventType,
} from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * Supply events are historical records like the raw reports: appended, never
 * rewritten. An event that has finished is closed by setting `endedAt`, which
 * adds information rather than replacing any.
 */
export const supplyEventRepository = {
  async create(
    input: {
      stationId: string;
      reportedByUserId: string | null;
      type: SupplyEventType;
      source: ReportSource;
      note?: string | null;
      startedAt?: Date;
    },
    tx: Prisma.TransactionClient = prisma,
  ): Promise<SupplyEvent> {
    return tx.supplyEvent.create({
      data: {
        stationId: input.stationId,
        reportedByUserId: input.reportedByUserId,
        type: input.type,
        source: input.source,
        note: input.note ?? null,
        startedAt: input.startedAt ?? new Date(),
      },
    });
  },

  /** Events that have started but not yet ended. */
  async findOpenForStation(stationId: string): Promise<SupplyEvent[]> {
    return prisma.supplyEvent.findMany({
      where: { stationId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
  },

  async findById(id: string): Promise<SupplyEvent | null> {
    return prisma.supplyEvent.findUnique({ where: { id } });
  },

  async close(id: string, endedAt: Date = new Date()): Promise<SupplyEvent> {
    return prisma.supplyEvent.update({ where: { id }, data: { endedAt } });
  },

  async listForStation(params: {
    stationId: string;
    skip: number;
    take: number;
  }): Promise<{ items: SupplyEvent[]; total: number }> {
    const where = { stationId: params.stationId };

    const [items, total] = await Promise.all([
      prisma.supplyEvent.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.supplyEvent.count({ where }),
    ]);

    return { items, total };
  },
};
