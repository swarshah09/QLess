import type { Request, Response } from 'express';
import { operatorReportService } from '../services/operatorReport.service';
import { reportService } from '../services/report.service';
import { savedStationService } from '../services/savedStation.service';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/apiResponse';

export const reportController = {
  /** Any authenticated user — no operator assignment required. */
  async submit(req: Request, res: Response): Promise<void> {
    const result = await reportService.submit(req.params.stationId, req.user!, req.body);
    sendCreated(res, result);
  },

  /** Public: the append-only raw history behind a station's current status. */
  async history(req: Request, res: Response): Promise<void> {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const reports = await reportService.history(req.params.stationId, { page, limit });
    sendSuccess(res, { reports }, 200, { page, limit });
  },
};

export const operatorController = {
  async update(req: Request, res: Response): Promise<void> {
    const result = await operatorReportService.update(
      req.params.stationId,
      req.user!,
      req.body,
    );
    sendCreated(res, result);
  },

  async createSupplyEvent(req: Request, res: Response): Promise<void> {
    const result = await operatorReportService.recordSupplyEvent(
      req.params.stationId,
      req.user!,
      req.body,
    );
    sendCreated(res, result);
  },

  async closeSupplyEvent(req: Request, res: Response): Promise<void> {
    const event = await operatorReportService.closeSupplyEvent(
      req.params.stationId,
      req.params.eventId,
      req.user!,
    );
    sendSuccess(res, { event });
  },

  async listSupplyEvents(req: Request, res: Response): Promise<void> {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const { items, total } = await operatorReportService.listSupplyEvents(
      req.params.stationId,
      { page, limit },
    );
    sendPaginated(res, items, page, limit, total);
  },
};

export const savedStationController = {
  async list(req: Request, res: Response): Promise<void> {
    const { latitude, longitude } = req.query as unknown as {
      latitude?: number;
      longitude?: number;
    };

    const stations = await savedStationService.list(
      req.user!.id,
      latitude !== undefined && longitude !== undefined
        ? { latitude, longitude }
        : undefined,
    );

    sendSuccess(res, { stations });
  },

  async save(req: Request, res: Response): Promise<void> {
    const saved = await savedStationService.save(
      req.user!.id,
      req.params.stationId,
      req.body?.label,
    );
    sendCreated(res, { saved });
  },

  async unsave(req: Request, res: Response): Promise<void> {
    await savedStationService.unsave(req.user!.id, req.params.stationId);
    sendSuccess(res, { removed: true });
  },
};
