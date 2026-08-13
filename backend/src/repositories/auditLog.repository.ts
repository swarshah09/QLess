import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

export const auditLogRepository = {
  /**
   * Records a sensitive action. Never throws into the caller's path — an audit
   * write failing must not roll back or block the action the admin performed,
   * but it does get logged loudly by the service layer.
   */
  async record(entry: {
    adminUserId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    reason?: string | null;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    return prisma.adminAuditLog.create({
      data: {
        adminUserId: entry.adminUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        reason: entry.reason ?? null,
        before: entry.before,
        after: entry.after,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  },

  async listPaginated(params: {
    skip: number;
    take: number;
    action?: string;
    entityType?: string;
    adminUserId?: string;
  }) {
    const where: Prisma.AdminAuditLogWhereInput = {
      ...(params.action && { action: params.action }),
      ...(params.entityType && { entityType: params.entityType }),
      ...(params.adminUserId && { adminUserId: params.adminUserId }),
    };

    const [items, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where,
        include: { adminUser: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.adminAuditLog.count({ where }),
    ]);
    return { items, total };
  },
};
