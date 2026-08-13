import type { Request, Response } from 'express';
import { recommendationService } from '../services/recommendation.service';
import { stationDiscoveryService } from '../services/stationDiscovery.service';
import { visitService } from '../services/visit.service';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/apiResponse';

export const visitController = {
  /** "I'm Here" — proximity is verified server-side. */
  async checkIn(req: Request, res: Response): Promise<void> {
    const result = await visitService.checkIn(
      req.params.stationId,
      req.user!.id,
      req.body,
    );
    sendCreated(res, result);
  },

  async joinQueue(req: Request, res: Response): Promise<void> {
    const visit = await visitService.joinQueue(req.params.visitId, req.user!.id);
    sendSuccess(res, { visit });
  },

  async complete(req: Request, res: Response): Promise<void> {
    const visit = await visitService.complete(
      req.params.visitId,
      req.user!.id,
      req.body,
    );
    sendSuccess(res, { visit });
  },

  async history(req: Request, res: Response): Promise<void> {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const { items, total } = await visitService.listForUser(req.user!.id, { page, limit });
    sendPaginated(res, items, page, limit, total);
  },
};

export const recommendationController = {
  /**
   * Recommendation over nearby stations.
   *
   * `stations` is returned in the SAME nearest-first order the discovery
   * endpoint uses — the recommendation is separate metadata, never a reordering.
   */
  async recommend(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as {
      latitude: number;
      longitude: number;
      radius?: number;
      limit: number;
    };

    const radiusM = stationDiscoveryService.clampRadius(query.radius);

    const stations = await stationDiscoveryService.nearby({
      latitude: query.latitude,
      longitude: query.longitude,
      radiusM,
      sort: 'distance',
      limit: query.limit,
      filters: {},
      viewer: req.user,
    });

    const recommendation = recommendationService.recommend(stations);

    sendSuccess(
      res,
      {
        stations,
        recommendation,
        travelAssumptions: recommendationService.travelAssumptions(),
      },
      200,
      { origin: { latitude: query.latitude, longitude: query.longitude }, radiusM },
    );
  },
};
