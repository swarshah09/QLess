import { type StationVisit, VisitOutcome } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { AppError } from '../errors/AppError';
import { stationRepository } from '../repositories/station.repository';
import { haversineDistanceM, type Coordinates } from '../utils/geo';

/**
 * Station visits — the "I'm Here" flow.
 *
 * Proximity is verified server-side from submitted coordinates, exactly as with
 * crowd reports: the client sends where it is, never whether that counts.
 *
 * The load-bearing rule: completing a visit does NOT imply a successful
 * refuel. `completedAt` records only that the visit ended; `outcome` stays
 * UNKNOWN until the user says what actually happened.
 */

/** A visit older than this is considered abandoned rather than ongoing. */
const ACTIVE_VISIT_WINDOW_MINUTES = 240;

export interface CheckInInput {
  latitude: number;
  longitude: number;
}

export interface CheckInResult {
  visit: StationVisit;
  locationVerified: boolean;
  distanceToStationM: number;
}

export const visitService = {
  /**
   * Records a user arriving at a station.
   *
   * Rejected when the user is not actually near the station — unlike a report,
   * a visit is a claim about the user's own physical presence, so an unverified
   * one carries no meaning worth storing.
   */
  async checkIn(
    stationId: string,
    userId: string,
    input: CheckInInput,
  ): Promise<CheckInResult> {
    const station = await stationRepository.findById(stationId);
    if (!station) throw AppError.notFound('Station not found');

    const reporter: Coordinates = {
      latitude: input.latitude,
      longitude: input.longitude,
    };

    const distanceToStationM = Math.round(
      haversineDistanceM(reporter, {
        latitude: station.latitude,
        longitude: station.longitude,
      }),
    );

    const radius = env.LOCATION_VERIFICATION_RADIUS_M;
    const locationVerified = distanceToStationM <= radius;

    if (!locationVerified) {
      throw AppError.validation('You do not appear to be at this station', [
        {
          field: 'location',
          message: `You are approximately ${distanceToStationM}m away; check in within ${radius}m`,
        },
      ]);
    }

    // Re-arriving during an open visit updates it rather than opening a second
    // one — a user whose GPS re-fires should not accumulate duplicate visits.
    const existing = await this.findActiveVisit(userId, stationId);

    if (existing) {
      const visit = await prisma.stationVisit.update({
        where: { id: existing.id },
        data: { arrivedAt: existing.arrivedAt ?? new Date(), locationVerified: true },
      });
      return { visit, locationVerified, distanceToStationM };
    }

    const visit = await prisma.stationVisit.create({
      data: {
        userId,
        stationId,
        locationVerified: true,
        arrivedAt: new Date(),
        // Explicitly UNKNOWN: arriving says nothing about the outcome.
        outcome: VisitOutcome.UNKNOWN,
      },
    });

    return { visit, locationVerified, distanceToStationM };
  },

  /** The user's open visit to a station, if one is recent enough to still count. */
  async findActiveVisit(userId: string, stationId: string): Promise<StationVisit | null> {
    const cutoff = new Date(Date.now() - ACTIVE_VISIT_WINDOW_MINUTES * 60_000);

    return prisma.stationVisit.findFirst({
      where: {
        userId,
        stationId,
        completedAt: null,
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findOwnedVisit(visitId: string, userId: string): Promise<StationVisit> {
    const visit = await prisma.stationVisit.findUnique({ where: { id: visitId } });

    // Someone else's visit reads as missing so visit ids cannot be probed.
    if (!visit || visit.userId !== userId) throw AppError.notFound('Visit not found');

    return visit;
  },

  /** Marks the moment the user joined the queue. */
  async joinQueue(visitId: string, userId: string): Promise<StationVisit> {
    const visit = await this.findOwnedVisit(visitId, userId);

    if (visit.completedAt) {
      throw AppError.conflict('This visit has already ended');
    }

    if (visit.joinedQueueAt) return visit;

    return prisma.stationVisit.update({
      where: { id: visitId },
      data: { joinedQueueAt: new Date() },
    });
  },

  /**
   * Ends a visit.
   *
   * `outcome` must be supplied by the user. Leaving is not evidence of a
   * successful refuel — a driver who gave up on the queue and one who filled
   * up both stop being at the station, and conflating them would corrupt every
   * wait-time measurement derived from visits.
   */
  async complete(
    visitId: string,
    userId: string,
    input: { outcome?: VisitOutcome } = {},
  ): Promise<StationVisit> {
    const visit = await this.findOwnedVisit(visitId, userId);

    if (visit.completedAt) {
      throw AppError.conflict('This visit has already ended');
    }

    const completedAt = new Date();
    const outcome = input.outcome ?? VisitOutcome.UNKNOWN;

    /**
     * An observed wait is only recorded for a confirmed refuel: the interval
     * from joining the queue to being served. For any other outcome the
     * elapsed time measures how long someone was willing to wait, which is a
     * different quantity and must not pollute wait estimates.
     */
    const observedWaitMinutes =
      outcome === VisitOutcome.REFUELLED && visit.joinedQueueAt
        ? Math.max(
            0,
            Math.round((completedAt.getTime() - visit.joinedQueueAt.getTime()) / 60_000),
          )
        : null;

    return prisma.stationVisit.update({
      where: { id: visitId },
      data: { completedAt, outcome, observedWaitMinutes },
    });
  },

  async listForUser(userId: string, params: { page: number; limit: number }) {
    const where = { userId };

    const [items, total] = await Promise.all([
      prisma.stationVisit.findMany({
        where,
        include: { station: { select: { id: true, name: true, address: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.stationVisit.count({ where }),
    ]);

    return { items, total };
  },
};
