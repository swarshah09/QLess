import type { Request, Response } from 'express';
import { healthService } from '../services/health.service';
import { sendSuccess } from '../utils/apiResponse';

/**
 * Controllers stay thin: they read the request, delegate to a service, and
 * shape the response. No business logic here.
 */
export const healthController = {
  getHealth(_req: Request, res: Response): void {
    sendSuccess(res, healthService.getStatus());
  },

  async getDetailedHealth(_req: Request, res: Response): Promise<void> {
    const status = await healthService.getDetailedStatus();
    sendSuccess(res, status, status.status === 'ok' ? 200 : 503);
  },
};
