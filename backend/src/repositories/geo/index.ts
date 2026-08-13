import { haversineGeoQuery } from './haversineGeoQuery';
import type { StationGeoQuery } from './stationGeoQuery';

/**
 * The active proximity-search implementation.
 *
 * This is the single line to change when adopting PostGIS: point it at a
 * `postgisGeoQuery` honouring the same interface. Nothing above this module
 * knows which strategy is in use.
 */
export const stationGeoQuery: StationGeoQuery = haversineGeoQuery;

export type {
  NearbyFilters,
  NearbyQuery,
  StationGeoQuery,
  StationWithDistance,
} from './stationGeoQuery';
