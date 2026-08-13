import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * Minimal station data access for Part 2.
 *
 * Only what the authorization work needs: public reads (to prove guest access
 * works) and a narrow operator update (to enforce the assignment rule).
 * Discovery, distance search and status computation belong to Part 3.
 */

export const stationSelect = {
  id: true,
  name: true,
  address: true,
  city: true,
  state: true,
  pincode: true,
  latitude: true,
  longitude: true,
  operatingHours: true,
  active: true,
  numberOfDispensers: true,
  pressureThresholdLow: true,
  pressureThresholdNormal: true,
  defaultPressureUnit: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StationSelect;

export type StationRecord = Prisma.StationGetPayload<{ select: typeof stationSelect }>;

export const stationRepository = {
  async exists(id: string): Promise<boolean> {
    const found = await prisma.station.findUnique({ where: { id }, select: { id: true } });
    return found !== null;
  },

  async findById(id: string): Promise<StationRecord | null> {
    return prisma.station.findUnique({ where: { id }, select: stationSelect });
  },

  async listPaginated(params: {
    skip: number;
    take: number;
    /** Guests and normal users see only active stations by default. */
    includeInactive?: boolean;
  }): Promise<{ items: StationRecord[]; total: number }> {
    const where: Prisma.StationWhereInput = params.includeInactive ? {} : { active: true };

    const [items, total] = await Promise.all([
      prisma.station.findMany({
        where,
        select: stationSelect,
        orderBy: { name: 'asc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.station.count({ where }),
    ]);

    return { items, total };
  },

  async update(id: string, data: Prisma.StationUpdateInput): Promise<StationRecord> {
    return prisma.station.update({ where: { id }, data, select: stationSelect });
  },
};
