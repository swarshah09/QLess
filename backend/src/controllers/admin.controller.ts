import type { Request, Response } from 'express';
import { adminService } from '../services/admin.service';
import { adminStationService } from '../services/adminStation.service';
import { authContextFrom } from '../utils/authCookies';
import {
  buildPaginationMeta,
  sendCreated,
  sendPaginated,
  sendSuccess,
} from '../utils/apiResponse';

export const adminController = {
  async listUsers(req: Request, res: Response): Promise<void> {
    const { page, limit, role } = req.query as unknown as {
      page: number;
      limit: number;
      role?: Parameters<typeof adminService.listUsers>[0]['role'];
    };

    const { items, total } = await adminService.listUsers({ page, limit, role });
    sendPaginated(res, items, page, limit, total);
  },

  async updateUserRole(req: Request, res: Response): Promise<void> {
    const user = await adminService.updateUserRole(
      req.params.userId,
      req.body.role,
      req.user!,
      authContextFrom(req),
    );
    sendSuccess(res, { user });
  },

  async setUserActive(req: Request, res: Response): Promise<void> {
    const user = await adminService.setUserActive(
      req.params.userId,
      req.body.active,
      req.user!,
      authContextFrom(req),
    );
    sendSuccess(res, { user });
  },

  async listStationOperators(req: Request, res: Response): Promise<void> {
    const operators = await adminService.listStationOperators(req.params.stationId);
    sendSuccess(res, { operators });
  },

  async assignOperator(req: Request, res: Response): Promise<void> {
    const assignment = await adminService.assignOperator(
      {
        stationId: req.params.stationId,
        userId: req.body.userId,
        role: req.body.role,
      },
      req.user!,
      authContextFrom(req),
    );
    sendCreated(res, { assignment });
  },

  async revokeOperator(req: Request, res: Response): Promise<void> {
    await adminService.revokeOperator(
      { stationId: req.params.stationId, userId: req.params.userId },
      req.user!,
      authContextFrom(req),
    );
    sendSuccess(res, { revoked: true });
  },

  async listAuditLogs(req: Request, res: Response): Promise<void> {
    const { page, limit, action, entityType } = req.query as unknown as {
      page: number;
      limit: number;
      action?: string;
      entityType?: string;
    };
    const { items, total } = await adminService.listAuditLogs({
      page,
      limit,
      action,
      entityType,
    });
    sendPaginated(res, items, page, limit, total);
  },
};

/** Station management, moderation and platform statistics. */
export const adminStationController = {
  async listStations(req: Request, res: Response): Promise<void> {
    const { page, limit, includeInactive, search } = req.query as unknown as {
      page: number;
      limit: number;
      includeInactive: boolean;
      search?: string;
    };

    const { items, total } = await adminStationService.list({
      page,
      limit,
      includeInactive,
      search,
    });
    sendPaginated(res, items, page, limit, total);
  },

  async createStation(req: Request, res: Response): Promise<void> {
    const station = await adminStationService.create(
      req.body,
      req.user!,
      authContextFrom(req),
    );
    sendCreated(res, { station });
  },

  async updateStation(req: Request, res: Response): Promise<void> {
    const station = await adminStationService.update(
      req.params.stationId,
      req.body,
      req.user!,
      authContextFrom(req),
    );
    sendSuccess(res, { station });
  },

  async setStationActive(req: Request, res: Response): Promise<void> {
    const station = await adminStationService.setActive(
      req.params.stationId,
      req.body.active,
      req.body.reason,
      req.user!,
      authContextFrom(req),
    );
    sendSuccess(res, { station });
  },

  /** Manual override — records admin identity, reason and timestamp. */
  async overrideStatus(req: Request, res: Response): Promise<void> {
    const result = await adminStationService.overrideStatus(
      req.params.stationId,
      req.body,
      req.user!,
      authContextFrom(req),
    );
    sendSuccess(res, result);
  },

  async suspiciousReports(req: Request, res: Response): Promise<void> {
    const { page, limit, sinceHours } = req.query as unknown as {
      page: number;
      limit: number;
      sinceHours: number;
    };

    const { items, total, lowReputationReporters } =
      await adminStationService.suspiciousReports({ page, limit, sinceHours });

    sendSuccess(
      res,
      { reports: items, lowReputationReporters },
      200,
      { pagination: buildPaginationMeta(page, limit, total) },
    );
  },

  async reportStats(req: Request, res: Response): Promise<void> {
    const { sinceHours } = req.query as unknown as { sinceHours: number };
    sendSuccess(res, await adminStationService.reportStatistics({ sinceHours }));
  },

  async notificationStats(req: Request, res: Response): Promise<void> {
    const { sinceHours } = req.query as unknown as { sinceHours: number };
    sendSuccess(res, await adminStationService.notificationStatistics({ sinceHours }));
  },

  async platformSettings(_req: Request, res: Response): Promise<void> {
    sendSuccess(res, await adminStationService.platformSettings());
  },
};
