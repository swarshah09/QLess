import type { Request, Response } from 'express';
import { stationService } from '../services/station.service';
import { sendPaginated, sendSuccess } from '../utils/apiResponse';

export const stationController = {
  /** Public — `req.user` is present only when a valid token was supplied. */
  async list(req: Request, res: Response): Promise<void> {
    const { page, limit, includeInactive } = req.query as unknown as {
      page: number;
      limit: number;
      includeInactive?: boolean;
    };

    const { items, total } = await stationService.list({
      page,
      limit,
      includeInactive,
      viewer: req.user,
    });

    sendPaginated(res, items, page, limit, total);
  },

  /** Public. */
  async getById(req: Request, res: Response): Promise<void> {
    const station = await stationService.getById(req.params.stationId);
    sendSuccess(res, { station });
  },

  /** Operator or admin; the assignment rule is enforced by middleware. */
  async update(req: Request, res: Response): Promise<void> {
    const station = await stationService.updateAsOperator(
      req.params.stationId,
      req.user!,
      req.body,
    );
    sendSuccess(res, { station });
  },

  /** Stations the calling operator is assigned to. */
  async listMine(req: Request, res: Response): Promise<void> {
    const assignments = await stationService.listAssignedStations(req.user!.id);
    sendSuccess(res, { assignments });
  },
};
