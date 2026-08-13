import type { Prisma, ReporterReputation } from '@prisma/client';
import { prisma } from '../config/prisma';
import { REPUTATION } from '../config/constants';

export const reputationRepository = {
  async findByUserId(userId: string): Promise<ReporterReputation | null> {
    return prisma.reporterReputation.findUnique({ where: { userId } });
  },

  async findManyByUserIds(userIds: string[]): Promise<ReporterReputation[]> {
    if (userIds.length === 0) return [];
    return prisma.reporterReputation.findMany({ where: { userId: { in: userIds } } });
  },

  /**
   * Applies a scored outcome. Upsert rather than update so a first-time
   * reporter gets a row without a separate registration step.
   */
  async applyOutcome(
    params: {
      userId: string;
      score: number;
      agreed: boolean;
      rejected: boolean;
      reportedAt: Date;
    },
    tx: Prisma.TransactionClient = prisma,
  ): Promise<ReporterReputation> {
    return tx.reporterReputation.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        score: params.score,
        totalReports: 1,
        verifiedReports: params.agreed ? 1 : 0,
        rejectedReports: params.rejected ? 1 : 0,
        lastReportAt: params.reportedAt,
      },
      update: {
        score: params.score,
        totalReports: { increment: 1 },
        ...(params.agreed && { verifiedReports: { increment: 1 } }),
        ...(params.rejected && { rejectedReports: { increment: 1 } }),
        lastReportAt: params.reportedAt,
      },
    });
  },

  /** Ensures a row exists so weighting has something to read. */
  async ensure(userId: string): Promise<ReporterReputation> {
    return prisma.reporterReputation.upsert({
      where: { userId },
      create: { userId, score: REPUTATION.startingScore },
      update: {},
    });
  },
};
