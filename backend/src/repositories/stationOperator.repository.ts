import type { StationOperator, StationOperatorRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { publicUserSelect } from './user.repository';

export const stationOperatorRepository = {
  /**
   * The single source of truth for "may this operator touch this station?".
   *
   * Only an ACTIVE, un-revoked assignment counts. Authorization checks must go
   * through this rather than reading the join table ad hoc.
   */
  async hasActiveAssignment(userId: string, stationId: string): Promise<boolean> {
    const assignment = await prisma.stationOperator.findFirst({
      where: { userId, stationId, active: true, revokedAt: null },
      select: { id: true },
    });
    return assignment !== null;
  },

  async findAssignment(userId: string, stationId: string): Promise<StationOperator | null> {
    return prisma.stationOperator.findUnique({
      where: { userId_stationId: { userId, stationId } },
    });
  },

  /** Station ids an operator may act on. */
  async listStationIdsForUser(userId: string): Promise<string[]> {
    const rows = await prisma.stationOperator.findMany({
      where: { userId, active: true, revokedAt: null },
      select: { stationId: true },
    });
    return rows.map((row) => row.stationId);
  },

  async listForUser(userId: string) {
    return prisma.stationOperator.findMany({
      where: { userId, active: true, revokedAt: null },
      include: {
        station: {
          select: { id: true, name: true, address: true, city: true, active: true },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });
  },

  async listForStation(stationId: string) {
    return prisma.stationOperator.findMany({
      where: { stationId, active: true, revokedAt: null },
      include: { user: { select: publicUserSelect } },
      orderBy: { assignedAt: 'desc' },
    });
  },

  /**
   * Assigns an operator, reviving a previously revoked assignment rather than
   * failing on the unique constraint.
   */
  async assign(params: {
    userId: string;
    stationId: string;
    role: StationOperatorRole;
  }): Promise<StationOperator> {
    return prisma.stationOperator.upsert({
      where: { userId_stationId: { userId: params.userId, stationId: params.stationId } },
      create: {
        userId: params.userId,
        stationId: params.stationId,
        role: params.role,
      },
      update: {
        role: params.role,
        active: true,
        revokedAt: null,
        assignedAt: new Date(),
      },
    });
  },

  /** Soft-revokes so the assignment history survives for auditing. */
  async revoke(userId: string, stationId: string): Promise<boolean> {
    const result = await prisma.stationOperator.updateMany({
      where: { userId, stationId, active: true },
      data: { active: false, revokedAt: new Date() },
    });
    return result.count > 0;
  },
};
