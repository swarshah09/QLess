import { GEO } from '../config/constants';
import { env } from '../config/env';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in metres between two coordinates. */
export function haversineDistanceM(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * GEO.earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A report is location-verified when the reporter was physically close enough
 * to the station to have actually seen it.
 */
export function isWithinVerificationRadius(
  reporter: Coordinates,
  station: Coordinates,
  radiusM: number = env.LOCATION_VERIFICATION_RADIUS_M,
): boolean {
  return haversineDistanceM(reporter, station) <= radiusM;
}

/** Metres to kilometres, rounded to 100 m — finer precision is not meaningful. */
export function metresToKm(metres: number): number {
  return Math.round(metres / 100) / 10;
}

/**
 * Latitude/longitude deltas covering `radiusM`, for cheaply pre-filtering
 * candidate stations in SQL before the exact haversine pass.
 */
export function boundingBox(center: Coordinates, radiusM: number) {
  const latDelta = (radiusM / GEO.earthRadiusM) * (180 / Math.PI);
  const cosLat = Math.cos(toRadians(center.latitude));
  // Near the poles the longitude delta blows up; clamp to the whole range.
  const lonDelta =
    Math.abs(cosLat) < 1e-6 ? 180 : latDelta / Math.abs(cosLat);

  return {
    minLatitude: center.latitude - latDelta,
    maxLatitude: center.latitude + latDelta,
    minLongitude: Math.max(-180, center.longitude - lonDelta),
    maxLongitude: Math.min(180, center.longitude + lonDelta),
  };
}
