import type { Availability } from '@prisma/client';
import type { Request, Response } from 'express';
import { stationDiscoveryService, type StationSort } from '../services/stationDiscovery.service';
import { sendSuccess } from '../utils/apiResponse';

interface NearbyQuery {
  latitude: number;
  longitude: number;
  radius?: number;
  sort: StationSort;
  limit: number;
  availability?: Availability[];
  maxQueue?: number;
  maxWait?: number;
  minPressure?: number;
}

export const discoveryController = {
  /** Public. Nearest first unless a different sort is requested. */
  async nearby(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as NearbyQuery;
    const radiusM = stationDiscoveryService.clampRadius(query.radius);

    const stations = await stationDiscoveryService.nearby({
      latitude: query.latitude,
      longitude: query.longitude,
      radiusM,
      sort: query.sort,
      limit: query.limit,
      filters: {
        availability: query.availability,
        maxQueue: query.maxQueue,
        maxWaitMinutes: query.maxWait,
        minPressureBar: query.minPressure,
      },
      viewer: req.user,
    });

    sendSuccess(
      res,
      { stations },
      200,
      {
        origin: { latitude: query.latitude, longitude: query.longitude },
        radiusM,
        sort: query.sort,
        count: stations.length,
      },
    );
  },

  /** Public. Includes distance when the caller supplies coordinates. */
  async detail(req: Request, res: Response): Promise<void> {
    const { latitude, longitude } = req.query as unknown as {
      latitude?: number;
      longitude?: number;
    };

    const station = await stationDiscoveryService.detail(req.params.stationId, {
      origin:
        latitude !== undefined && longitude !== undefined
          ? { latitude, longitude }
          : undefined,
      viewer: req.user,
    });

    sendSuccess(res, { station });
  },
};
