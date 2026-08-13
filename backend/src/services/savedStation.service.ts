import { AppError } from '../errors/AppError';
import { savedStationRepository } from '../repositories/savedStation.repository';
import { stationRepository } from '../repositories/station.repository';
import { stationStatusRepository } from '../repositories/stationStatus.repository';
import { stationStateService } from './stationState.service';
import { haversineDistanceM, metresToKm, type Coordinates } from '../utils/geo';

/** A user may not save an unbounded number of stations. */
const MAX_SAVED_STATIONS = 50;

export const savedStationService = {
  /**
   * The user's saved stations with their current status, sorted nearest first
   * when the caller supplies coordinates and by the user's own ordering
   * otherwise.
   */
  async list(userId: string, origin?: Coordinates) {
    const saved = await savedStationRepository.list(userId);
    if (saved.length === 0) return [];

    const statuses = await stationStatusRepository.findManyByStationIds(
      saved.map((row) => row.stationId),
    );
    const statusByStation = new Map(statuses.map((s) => [s.stationId, s]));

    const items = saved.map((row) => {
      const distanceM = origin
        ? haversineDistanceM(origin, {
            latitude: row.station.latitude,
            longitude: row.station.longitude,
          })
        : null;

      return {
        id: row.id,
        label: row.label,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt,
        station: row.station,
        distanceM: distanceM === null ? null : Math.round(distanceM),
        distanceKm: distanceM === null ? null : metresToKm(distanceM),
        // Re-derived for now, so a saved station never shows a stale status
        // as though it were live.
        status: (() => {
          const stored = statusByStation.get(row.stationId);
          return stored ? stationStateService.decay(stored) : null;
        })(),
      };
    });

    if (origin) {
      items.sort(
        (a, b) =>
          (a.distanceM ?? Number.MAX_SAFE_INTEGER) - (b.distanceM ?? Number.MAX_SAFE_INTEGER),
      );
    }

    return items;
  },

  /** Idempotent — saving twice updates the label rather than erroring. */
  async save(userId: string, stationId: string, label?: string | null) {
    const exists = await stationRepository.exists(stationId);
    if (!exists) throw AppError.notFound('Station not found');

    const alreadySaved = await savedStationRepository.exists(userId, stationId);

    if (!alreadySaved) {
      const count = await savedStationRepository.count(userId);
      if (count >= MAX_SAVED_STATIONS) {
        throw AppError.badRequest(
          `You can save at most ${MAX_SAVED_STATIONS} stations`,
        );
      }
    }

    return savedStationRepository.save({ userId, stationId, label });
  },

  async unsave(userId: string, stationId: string): Promise<void> {
    const removed = await savedStationRepository.unsave(userId, stationId);
    if (!removed) throw AppError.notFound('This station is not in your saved list');
  },
};
