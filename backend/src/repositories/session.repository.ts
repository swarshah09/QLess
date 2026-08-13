import type { AuthMethod, AuthSession } from '@prisma/client';
import { prisma } from '../config/prisma';

export const sessionRepository = {
  async create(data: {
    userId: string;
    tokenHash: string;
    familyId: string;
    method: AuthMethod;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<AuthSession> {
    return prisma.authSession.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        familyId: data.familyId,
        method: data.method,
        expiresAt: data.expiresAt,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
      },
    });
  },

  /**
   * Looks a session up by token hash. Returns revoked and expired sessions too —
   * the service needs to see them to detect refresh-token reuse.
   */
  async findByTokenHash(tokenHash: string): Promise<AuthSession | null> {
    return prisma.authSession.findUnique({ where: { tokenHash } });
  },

  async findById(id: string): Promise<AuthSession | null> {
    return prisma.authSession.findUnique({ where: { id } });
  },

  async revoke(id: string, reason: string): Promise<void> {
    await prisma.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  },

  /**
   * Revokes every live session descended from one login. Used when a refresh
   * token is replayed, which means the token has leaked.
   */
  async revokeFamily(familyId: string, reason: string): Promise<number> {
    const result = await prisma.authSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  },

  /** Revokes every live session for a user — "sign out everywhere". */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const result = await prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  },

  async markUsed(id: string): Promise<void> {
    await prisma.authSession.update({ where: { id }, data: { lastUsedAt: new Date() } });
  },

  /**
   * Atomically rotates a session: revokes the old row and creates its successor
   * in the same family. The transaction stops a concurrent double-refresh from
   * leaving two live tokens behind.
   */
  async rotate(params: {
    currentSessionId: string;
    userId: string;
    familyId: string;
    method: AuthMethod;
    newTokenHash: string;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<AuthSession> {
    return prisma.$transaction(async (tx) => {
      const revoked = await tx.authSession.updateMany({
        where: { id: params.currentSessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
      });

      // Another request already rotated this token; treat it as reuse.
      if (revoked.count === 0) {
        throw new Error('SESSION_ALREADY_ROTATED');
      }

      return tx.authSession.create({
        data: {
          userId: params.userId,
          tokenHash: params.newTokenHash,
          familyId: params.familyId,
          method: params.method,
          expiresAt: params.expiresAt,
          ipAddress: params.ipAddress ?? null,
          userAgent: params.userAgent ?? null,
          lastUsedAt: new Date(),
        },
      });
    });
  },

  async countActiveForUser(userId: string): Promise<number> {
    return prisma.authSession.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  },

  /** Housekeeping for a later scheduled job. */
  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const result = await prisma.authSession.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return result.count;
  },
};
