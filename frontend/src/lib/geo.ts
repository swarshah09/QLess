import type { Coordinates } from '@/types';

// Haversine distance between two lat/lng points, in kilometres.
// Single source of truth — do not duplicate this logic in components.
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // earth radius km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function distanceFrom(origin: Coordinates, lat: number, lng: number): number {
  return calculateDistance(origin.lat, origin.lng, lat, lng);
}
