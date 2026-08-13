import { ReportSource, UserRole } from '@prisma/client';
import { env } from '../config/env';
import { haversineDistanceM, type Coordinates } from '../utils/geo';

/**
 * Server-side location verification.
 *
 * The client sends coordinates; it does NOT get to say whether those
 * coordinates count as verified. Any `locationVerified` field arriving in a
 * request body is ignored — the value stored is always the one computed here
 * from the submitted coordinates and the station's own position.
 */

export interface VerificationOutcome {
  /** Always computed here, never taken from the request. */
  locationVerified: boolean;
  source: ReportSource;
  distanceToStationM: number | null;
  latitude: number | null;
  longitude: number | null;
}

export const locationVerificationService = {
  /**
   * Decides the trust level of a report.
   *
   * Operators and admins are trusted by role — an operator standing in the
   * station office is authoritative whether or not their phone reports GPS.
   * For normal users, physical proximity is what upgrades a second-hand report
   * to a first-hand observation.
   */
  verify(params: {
    reporterRole: UserRole;
    /** True when acting through an operator endpoint for an assigned station. */
    actingAsOperator: boolean;
    coordinates?: Coordinates | null;
    station: Coordinates;
    radiusM?: number;
  }): VerificationOutcome {
    const distanceToStationM = params.coordinates
      ? Math.round(haversineDistanceM(params.coordinates, params.station))
      : null;

    if (params.actingAsOperator) {
      return {
        locationVerified: true,
        source: ReportSource.OPERATOR,
        distanceToStationM,
        latitude: params.coordinates?.latitude ?? null,
        longitude: params.coordinates?.longitude ?? null,
      };
    }

    if (params.reporterRole === UserRole.ADMIN) {
      return {
        locationVerified: true,
        source: ReportSource.ADMIN,
        distanceToStationM,
        latitude: params.coordinates?.latitude ?? null,
        longitude: params.coordinates?.longitude ?? null,
      };
    }

    // No coordinates supplied: the report is still accepted and stored, but it
    // cannot be treated as a first-hand sighting.
    if (!params.coordinates || distanceToStationM === null) {
      return {
        locationVerified: false,
        source: ReportSource.NORMAL_USER,
        distanceToStationM: null,
        latitude: null,
        longitude: null,
      };
    }

    const radius = params.radiusM ?? env.LOCATION_VERIFICATION_RADIUS_M;
    const withinGeofence = distanceToStationM <= radius;

    return {
      locationVerified: withinGeofence,
      source: withinGeofence ? ReportSource.VERIFIED_NEARBY_USER : ReportSource.NORMAL_USER,
      distanceToStationM,
      latitude: params.coordinates.latitude,
      longitude: params.coordinates.longitude,
    };
  },
};
