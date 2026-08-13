import { Availability, Freshness, PressureStatus } from '@prisma/client';
import { RECOMMENDATION } from '../config/constants';
import type { StationView } from './stationDiscovery.service';

/**
 * Station recommendation.
 *
 * DELIBERATELY SEPARATE FROM SORTING. The station list stays nearest-first;
 * this layer annotates it. `recommend()` never reorders its input — it returns
 * which station it would pick and why, and the caller decides how to present
 * that alongside the unchanged list.
 *
 * The question it answers is "where will I actually finish soonest?", which is
 * travel time plus expected wait — not "what is closest".
 */

export interface ScoredStation {
  stationId: string;
  /** Minutes to drive there, approximate. */
  travelMinutes: number;
  /** Expected minutes queueing on arrival, from the computed status. */
  waitMinutes: number | null;
  /** travel + wait + risk penalties. The comparison key. */
  effectiveMinutes: number;
  /** Penalty minutes applied for supply risk or missing data. */
  penaltyMinutes: number;
  eligible: boolean;
  /** Why a station was excluded from being the best choice. */
  ineligibleReason: string | null;
}

export interface Alternative {
  stationId: string;
  name: string;
  distanceKm: number | null;
  /** Minutes saved versus the nearest station. Positive means faster. */
  savingMinutes: number;
  effectiveMinutes: number;
}

export interface RecommendationResult {
  /** Null when nothing is trustworthy enough to recommend. */
  recommendedStationId: string | null;
  /** The nearest station, always reported so clients can contrast the two. */
  nearestStationId: string | null;
  /** True when the recommendation is not simply the nearest station. */
  differsFromNearest: boolean;
  /** Approximate minutes saved by taking the recommendation. */
  savingMinutes: number | null;
  reason: string | null;
  alternatives: Alternative[];
  scores: ScoredStation[];
}

/**
 * Approximate travel time. No routing API is wired up, so this is a
 * straight-line estimate at an assumed city speed plus fixed overhead — good
 * enough to compare two stations, and always labelled approximate.
 */
export function approximateTravelMinutes(distanceM: number | null): number {
  if (distanceM === null) return 0;

  const km = distanceM / 1000;
  const driving = (km / RECOMMENDATION.averageSpeedKmh) * 60;

  return Math.round(driving + RECOMMENDATION.fixedTravelOverheadMinutes);
}

/**
 * Wait to assume for a station.
 *
 * Uses the range's MAXIMUM: when choosing where to drive, the pessimistic end
 * is the honest basis for comparison, and it keeps a wide, uncertain range from
 * looking better than a narrow confident one.
 */
function expectedWaitMinutes(station: StationView): number | null {
  const { min, max } = station.status.wait;
  if (min === null && max === null) return null;
  return max ?? min;
}

/** Risk penalties for supply state and missing information. */
function penaltiesFor(station: StationView): number {
  let penalty = 0;

  if (station.status.availability === Availability.LOW_SUPPLY) {
    penalty += RECOMMENDATION.lowSupplyPenaltyMinutes;
  }
  if (station.status.availability === Availability.TEMPORARILY_INTERRUPTED) {
    penalty += RECOMMENDATION.interruptedPenaltyMinutes;
  }

  // No queue information is a risk, not a neutral fact.
  if (station.status.queue.min === null && station.status.queue.max === null) {
    penalty += RECOMMENDATION.unknownQueuePenaltyMinutes;
  }

  // Critically low pressure means a slow or incomplete fill even once served.
  if (station.status.pressure.status === PressureStatus.CRITICAL) {
    penalty += RECOMMENDATION.lowSupplyPenaltyMinutes;
  }

  return penalty;
}

/**
 * Whether a station may be recommended as the BEST choice.
 *
 * Stricter than being listed: appearing in a list is informational, whereas a
 * recommendation actively sends someone across town. Unavailable stations are
 * never recommended, and stale or low-confidence data cannot carry a
 * recommendation on its own.
 */
function eligibility(station: StationView): { eligible: boolean; reason: string | null } {
  if (!station.active) {
    return { eligible: false, reason: 'station is not active' };
  }

  if (
    station.status.availability === Availability.UNAVAILABLE ||
    station.status.availability === Availability.TEMPORARILY_INTERRUPTED
  ) {
    return { eligible: false, reason: `availability is ${station.status.availability}` };
  }

  if (station.status.availability === Availability.UNKNOWN) {
    return { eligible: false, reason: 'availability is unknown' };
  }

  if (
    !(RECOMMENDATION.acceptableFreshness as readonly string[]).includes(
      station.status.freshness,
    )
  ) {
    return { eligible: false, reason: `data is ${station.status.freshness}` };
  }

  if (station.status.confidence < RECOMMENDATION.minConfidenceToRecommend) {
    return {
      eligible: false,
      reason: `confidence ${station.status.confidence} is below ${RECOMMENDATION.minConfidenceToRecommend}`,
    };
  }

  return { eligible: true, reason: null };
}

function scoreStation(station: StationView): ScoredStation {
  const travelMinutes = approximateTravelMinutes(station.distanceM);
  const waitMinutes = expectedWaitMinutes(station);
  const penaltyMinutes = penaltiesFor(station);
  const { eligible, reason } = eligibility(station);

  return {
    stationId: station.id,
    travelMinutes,
    waitMinutes,
    // An unknown wait already draws a penalty; treating it as zero here would
    // make the least-known station look like the fastest.
    effectiveMinutes: travelMinutes + (waitMinutes ?? 0) + penaltyMinutes,
    penaltyMinutes,
    eligible,
    ineligibleReason: reason,
  };
}

export const recommendationService = {
  /**
   * Picks a recommendation from an ALREADY-ORDERED list.
   *
   * The input order (nearest-first from discovery) is never mutated or
   * reordered. Only the annotation is produced here.
   */
  recommend(stations: StationView[]): RecommendationResult {
    const empty: RecommendationResult = {
      recommendedStationId: null,
      nearestStationId: null,
      differsFromNearest: false,
      savingMinutes: null,
      reason: null,
      alternatives: [],
      scores: [],
    };

    if (stations.length === 0) return empty;

    const scores = stations.map(scoreStation);
    const scoreById = new Map(scores.map((score) => [score.stationId, score]));

    // "Nearest" is taken from actual distance rather than list position, so the
    // result is correct even if a caller passes a differently-sorted list.
    const withDistance = stations.filter((station) => station.distanceM !== null);
    const nearest =
      withDistance.length > 0
        ? withDistance.reduce((closest, station) =>
            station.distanceM! < closest.distanceM! ? station : closest,
          )
        : stations[0];

    const eligible = scores.filter((score) => score.eligible);

    if (eligible.length === 0) {
      return {
        ...empty,
        nearestStationId: nearest.id,
        reason: 'No station has data reliable enough to recommend',
        scores,
      };
    }

    const best = eligible.reduce((fastest, score) =>
      score.effectiveMinutes < fastest.effectiveMinutes ? score : fastest,
    );

    const nearestScore = scoreById.get(nearest.id)!;
    const nearestEligible = nearestScore.eligible;

    /**
     * Prefer the nearest station unless a farther one saves meaningful time.
     *
     * Without this bar, a one-minute modelled difference would send a driver
     * past a perfectly good station — the estimate is not precise enough to
     * justify that.
     */
    let recommended = best;
    let saving = nearestScore.effectiveMinutes - best.effectiveMinutes;

    if (nearestEligible && saving < RECOMMENDATION.minMeaningfulSavingMinutes) {
      recommended = nearestScore;
      saving = 0;
    }

    const differsFromNearest = recommended.stationId !== nearest.id;

    const alternatives: Alternative[] = eligible
      .filter((score) => score.stationId !== recommended.stationId)
      .sort((a, b) => a.effectiveMinutes - b.effectiveMinutes)
      .slice(0, RECOMMENDATION.maxAlternatives)
      .map((score) => {
        const station = stations.find((s) => s.id === score.stationId)!;
        return {
          stationId: score.stationId,
          name: station.name,
          distanceKm: station.distanceKm,
          savingMinutes: nearestScore.effectiveMinutes - score.effectiveMinutes,
          effectiveMinutes: score.effectiveMinutes,
        };
      });

    const recommendedStation = stations.find((s) => s.id === recommended.stationId)!;

    return {
      recommendedStationId: recommended.stationId,
      nearestStationId: nearest.id,
      differsFromNearest,
      savingMinutes: differsFromNearest ? saving : null,
      reason: differsFromNearest
        ? `${recommendedStation.name} is further but should save roughly ${saving} min overall`
        : `${recommendedStation.name} is both nearest and the fastest option`,
      alternatives,
      scores,
    };
  },

  /** Exposed so clients can label the estimate honestly. */
  travelAssumptions() {
    return {
      averageSpeedKmh: RECOMMENDATION.averageSpeedKmh,
      fixedOverheadMinutes: RECOMMENDATION.fixedTravelOverheadMinutes,
      approximate: true,
      note: 'Straight-line distance at an assumed city speed; not a routed ETA',
    };
  },
};

/** Re-exported so tests and callers can assert against the configured bands. */
export { Freshness };
