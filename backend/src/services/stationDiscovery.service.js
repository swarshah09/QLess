'use strict';

const Station = require('../models/Station');
const logger = require('../config/logger');
const placesService = require('./places.service');
const { PLACES } = require('../config/constants');

/**
 * Station discovery — the bridge between the external place provider and our
 * own data layer.
 *
 * MongoDB is the system of record. The provider is used only to LEARN THAT A
 * STATION EXISTS; once learned, the station is persisted here and served from
 * MongoDB thereafter. Repeated lookups over an already-known area therefore
 * cost nothing.
 *
 * Live status (queue, availability, pressure, wait) is never written by this
 * module. Discovered stations begin with the schema's UNKNOWN defaults and only
 * gain a status once real Reports arrive.
 */

/**
 * True when we already know enough about an area to skip the provider.
 *
 * Deliberately based on how many stations we have nearby rather than a global
 * timestamp: a user in a newly-opened city must still trigger discovery even
 * though we synced somewhere else five minutes ago.
 */
async function hasSufficientCoverage(latitude, longitude, radiusM) {
  const count = await Station.countDocuments(
    {
      active: true,
      location: {
        $geoWithin: {
          $centerSphere: [[longitude, latitude], radiusM / 6378100],
        },
      },
    },
    // Only "at least N" matters, so stop counting there. The hint matters too:
    // left alone, the planner picks the `active` index and scans every active
    // station nationwide rather than just the ones inside the circle.
    { limit: PLACES.minCachedStationsToSkipLookup, hint: { location: '2dsphere' } },
  );
  return count >= PLACES.minCachedStationsToSkipLookup;
}

/**
 * Areas the provider was asked about recently, so a sparse region does not
 * re-query it on every request.
 *
 * Without this, an area where the provider has fewer than the threshold
 * number of stations stays "thin" forever, and every request from it pays for
 * — and is delayed by — another identical provider call. Only the fact that an
 * area was searched is remembered here; station identity is persisted in
 * MongoDB as before, and live status is never involved.
 *
 * In-memory and per-instance on purpose: losing it on restart costs at most
 * one extra provider call per area, which does not justify shared storage.
 */
const recentSearches = new Map();
const inFlightSearches = new Map();

/** Grid cell scaled to the radius, so nearby origins share one search. */
function areaKey(latitude, longitude, radiusM) {
  const cellDeg = Math.max(0.01, radiusM / 4 / 111000);
  return `${Math.floor(latitude / cellDeg)}:${Math.floor(longitude / cellDeg)}:${radiusM}`;
}

function searchedRecently(key, now = Date.now()) {
  const expiresAt = recentSearches.get(key);
  if (expiresAt === undefined) return false;
  if (now < expiresAt) return true;
  recentSearches.delete(key);
  return false;
}

/**
 * An empty answer is remembered only briefly: the provider resolves [] for an
 * outage as well as for a genuinely empty area, and an outage should not hide
 * an area for hours. A short memo still spares users from waiting on a
 * failing provider request after request.
 */
function rememberSearch(key, foundAny, now = Date.now()) {
  // Map iteration order is insertion order, so the first key is the oldest.
  if (recentSearches.size >= PLACES.maxRememberedAreas) {
    recentSearches.delete(recentSearches.keys().next().value);
  }
  recentSearches.set(key, now + (foundAny ? PLACES.areaSearchTtlMs : PLACES.emptyAreaSearchTtlMs));
}

async function searchAndPersist(latitude, longitude, radiusM, key) {
  const seeds = await placesService.searchNearby({ latitude, longitude, radiusM });
  if (seeds.length === 0) {
    rememberSearch(key, false);
    return { discovered: 0, skipped: 'no-results' };
  }

  const saved = await upsertDiscovered(seeds);
  rememberSearch(key, true);
  logger.info('Discovered stations from place provider', {
    requested: seeds.length,
    persisted: saved.length,
  });
  return { discovered: saved.length };
}

/**
 * Persists provider results, updating existing records rather than duplicating.
 *
 * Matching is by placeId first, then by proximity — the same physical station
 * can appear under a new placeId, and a station we seeded manually should be
 * ADOPTED (gain its placeId) rather than cloned a few metres away.
 */
async function upsertDiscovered(seeds) {
  const saved = [];

  for (const seed of seeds) {
    try {
      let station = await Station.findOne({ placeId: seed.placeId });

      if (!station) {
        // No placeId match — look for an existing station at the same spot.
        const nearby = await Station.find({
          location: {
            $near: {
              $geometry: { type: 'Point', coordinates: [seed.longitude, seed.latitude] },
              $maxDistance: PLACES.dedupeDistanceM,
            },
          },
        }).limit(1);
        station = nearby[0] ?? null;
      }

      if (station) {
        // Refresh identity/location only. Status and QLess-owned configuration
        // are left untouched — this method must never overwrite our own data.
        station.placeId = seed.placeId;
        station.placeSyncedAt = new Date();
        station.placeData = seed.placeData;
        if (!station.city) station.city = seed.city;
        if (!station.state) station.state = seed.state;
        if (!station.pincode) station.pincode = seed.pincode;
        await station.save();
        saved.push(station);
        continue;
      }

      saved.push(
        await Station.create({
          name: seed.name,
          address: seed.address,
          city: seed.city,
          state: seed.state,
          pincode: seed.pincode,
          location: { type: 'Point', coordinates: [seed.longitude, seed.latitude] },
          source: 'PLACES',
          placeId: seed.placeId,
          placeSyncedAt: new Date(),
          placeData: seed.placeData,
          // No status is supplied: a station nobody has reported on has no live
          // information, and the schema's UNKNOWN defaults say exactly that.
        }),
      );
    } catch (error) {
      // A duplicate key here means a concurrent request won the race, which is
      // fine — skip it rather than failing the whole discovery pass.
      if (error.code !== 11000) {
        logger.warn('Failed to persist discovered station', {
          placeId: seed.placeId,
          error: error.message,
        });
      }
    }
  }

  return saved;
}

/**
 * Ensures the area around a point is populated, querying the provider only when
 * our own coverage is thin.
 *
 * Always resolves — never throws — so a provider problem degrades discovery to
 * whatever MongoDB already holds instead of failing the user's request.
 *
 * `knownCount` lets a caller that has just read the area pass the number of
 * ACTIVE stations it found inside the radius (with no other filter applied),
 * which answers the coverage question without a second query.
 */
async function ensureCoverage({ latitude, longitude, radiusM, knownCount }) {
  if (!placesService.isConfigured()) return { discovered: 0, skipped: 'not-configured' };

  try {
    const sufficient =
      knownCount !== undefined
        ? knownCount >= PLACES.minCachedStationsToSkipLookup
        : await hasSufficientCoverage(latitude, longitude, radiusM);
    if (sufficient) return { discovered: 0, skipped: 'cached' };

    const key = areaKey(latitude, longitude, radiusM);
    if (searchedRecently(key)) return { discovered: 0, skipped: 'searched-recently' };

    // Concurrent requests for the same area share a single provider call.
    let search = inFlightSearches.get(key);
    if (!search) {
      search = searchAndPersist(latitude, longitude, radiusM, key).finally(() =>
        inFlightSearches.delete(key),
      );
      inFlightSearches.set(key, search);
    }
    return await search;
  } catch (error) {
    logger.warn('Station discovery failed', { error: error.message });
    return { discovered: 0, skipped: 'error' };
  }
}

module.exports = { ensureCoverage, hasSufficientCoverage, upsertDiscovered };
