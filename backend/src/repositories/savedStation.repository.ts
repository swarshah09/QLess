import type { SavedStation } from '@prisma/client';
import { prisma } from '../config/prisma';
import { stationSelect } from './station.repository';

export const savedStationRepository = {
  async list(userId: string) {
    return prisma.savedStation.findMany({
      where: { userId },
      include: { station: { select: stationSelect } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  },

  async listStationIds(userId: string): Promise<string[]> {
    const rows = await prisma.savedStation.findMany({
      where: { userId },
      select: { stationId: true },
    });
    return rows.map((row) => row.stationId);
  },

  async exists(userId: string, stationId: string): Promise<boolean> {
    const found = await prisma.savedStation.findUnique({
      where: { userId_stationId: { userId, stationId } },
      select: { id: true },
    });
    return found !== null;
  },

  /**
   * Idempotent: saving an already-saved station updates its label instead of
   * failing on the unique constraint, so a client retry is harmless.
   */
  async save(params: {
    userId: string;
    stationId: string;
    label?: string | null;
    sortOrder?: number;
  }): Promise<SavedStation> {
    return prisma.savedStation.upsert({
      where: { userId_stationId: { userId: params.userId, stationId: params.stationId } },
      create: {
        userId: params.userId,
        stationId: params.stationId,
        label: params.label ?? null,
        sortOrder: params.sortOrder ?? 0,
      },
      update: {
        ...(params.label !== undefined && { label: params.label }),
        ...(params.sortOrder !== undefined && { sortOrder: params.sortOrder }),
      },
    });
  },

  async unsave(userId: string, stationId: string): Promise<boolean> {
    const result = await prisma.savedStation.deleteMany({ where: { userId, stationId } });
    return result.count > 0;
  },

  async count(userId: string): Promise<number> {
    return prisma.savedStation.count({ where: { userId } });
  },
};
