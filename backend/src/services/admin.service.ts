import { type Prisma, StationOperatorRole, UserRole } from '@prisma/client';
import { logger } from '../config/logger';
import { AppError } from '../errors/AppError';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { sessionRepository } from '../repositories/session.repository';
import { stationRepository } from '../repositories/station.repository';
import { stationOperatorRepository } from '../repositories/stationOperator.repository';
import { userRepository } from '../repositories/user.repository';
import type { AuthContext, AuthenticatedUser } from '../types/auth';

/**
 * Writes an audit entry without letting an audit failure undo the action that
 * already succeeded. A missing audit row is logged at error level so it is
 * still visible in monitoring.
 */
async function audit(
  actor: AuthenticatedUser,
  context: AuthContext,
  entry: {
    action: string;
    entityType: string;
    entityId?: string;
    reason?: string | null;
    before?: Prisma.InputJsonObject;
    after?: Prisma.InputJsonObject;
  },
): Promise<void> {
  try {
    await auditLogRepository.record({
      adminUserId: actor.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      reason: entry.reason ?? null,
      before: entry.before,
      after: entry.after,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });
  } catch (error) {
    logger.error({ err: error, ...entry }, 'Failed to write audit log entry');
  }
}

export const adminService = {
  async listUsers(params: { page: number; limit: number; role?: UserRole }) {
    return userRepository.listPaginated({
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      role: params.role,
    });
  },

  /**
   * Changes a user's role.
   *
   * Promoting to STATION_OPERATOR grants nothing on its own — the operator
   * still needs an explicit station assignment before they can modify anything.
   */
  async updateUserRole(
    userId: string,
    role: UserRole,
    actor: AuthenticatedUser,
    context: AuthContext,
  ) {
    const existing = await userRepository.findById(userId);
    if (!existing) throw AppError.notFound('User not found');

    if (existing.role === role) return existing;

    // Stops an admin removing their own access and locking the platform out.
    if (existing.id === actor.id && role !== UserRole.ADMIN) {
      throw AppError.badRequest('You cannot change your own role');
    }

    const updated = await userRepository.updateRole(userId, role);

    // A demoted user's live tokens still carry the old role in their claims.
    // `authenticate` reads the role from the database on every request so they
    // are already powerless, but the sessions are cut anyway to force a clean
    // re-login rather than leaving stale principals around.
    if (existing.role === UserRole.ADMIN || existing.role === UserRole.STATION_OPERATOR) {
      await sessionRepository.revokeAllForUser(userId, 'ROLE_CHANGED');
    }

    await audit(actor, context, {
      action: 'USER_ROLE_UPDATED',
      entityType: 'User',
      entityId: userId,
      before: { role: existing.role },
      after: { role: updated.role },
    });

    return updated;
  },

  /** Deactivates or reactivates an account. */
  async setUserActive(
    userId: string,
    active: boolean,
    actor: AuthenticatedUser,
    context: AuthContext,
  ) {
    const existing = await userRepository.findById(userId);
    if (!existing) throw AppError.notFound('User not found');

    if (existing.id === actor.id && !active) {
      throw AppError.badRequest('You cannot deactivate your own account');
    }

    const updated = await userRepository.setActive(userId, active);

    if (!active) {
      await sessionRepository.revokeAllForUser(userId, 'ACCOUNT_DEACTIVATED');
    }

    await audit(actor, context, {
      action: active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      entityType: 'User',
      entityId: userId,
      before: { active: existing.active },
      after: { active: updated.active },
    });

    return updated;
  },

  async listStationOperators(stationId: string) {
    const exists = await stationRepository.exists(stationId);
    if (!exists) throw AppError.notFound('Station not found');
    return stationOperatorRepository.listForStation(stationId);
  },

  /**
   * Assigns an operator to a station — the only way operator rights are
   * granted. The user must already hold the STATION_OPERATOR role, so gaining
   * access takes two deliberate admin actions rather than one.
   */
  async assignOperator(
    params: { stationId: string; userId: string; role: StationOperatorRole },
    actor: AuthenticatedUser,
    context: AuthContext,
  ) {
    const [station, user] = await Promise.all([
      stationRepository.findById(params.stationId),
      userRepository.findById(params.userId),
    ]);

    if (!station) throw AppError.notFound('Station not found');
    if (!user) throw AppError.notFound('User not found');

    if (user.role !== UserRole.STATION_OPERATOR && user.role !== UserRole.ADMIN) {
      throw AppError.badRequest(
        'User must hold the STATION_OPERATOR role before being assigned to a station',
      );
    }

    if (!user.active) {
      throw AppError.badRequest('Cannot assign an inactive user to a station');
    }

    const assignment = await stationOperatorRepository.assign(params);

    await audit(actor, context, {
      action: 'OPERATOR_ASSIGNED',
      entityType: 'StationOperator',
      entityId: params.stationId,
      after: { userId: params.userId, stationId: params.stationId, role: params.role },
    });

    logger.info(
      { adminId: actor.id, userId: params.userId, stationId: params.stationId },
      'Operator assigned to station',
    );

    return assignment;
  },

  /** Revokes an assignment. Takes effect on the operator's next request. */
  async revokeOperator(
    params: { stationId: string; userId: string },
    actor: AuthenticatedUser,
    context: AuthContext,
  ): Promise<void> {
    const revoked = await stationOperatorRepository.revoke(
      params.userId,
      params.stationId,
    );

    if (!revoked) {
      throw AppError.notFound('No active assignment found for this user and station');
    }

    await audit(actor, context, {
      action: 'OPERATOR_REVOKED',
      entityType: 'StationOperator',
      entityId: params.stationId,
      before: { userId: params.userId, stationId: params.stationId, active: true },
      after: { active: false },
    });

    logger.info(
      { adminId: actor.id, userId: params.userId, stationId: params.stationId },
      'Operator assignment revoked',
    );
  },

  async listAuditLogs(params: {
    page: number;
    limit: number;
    action?: string;
    entityType?: string;
  }) {
    return auditLogRepository.listPaginated({
      skip: (params.page - 1) * params.limit,
      take: params.limit,
      action: params.action,
      entityType: params.entityType,
    });
  },
};
