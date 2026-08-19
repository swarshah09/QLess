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
  const count = await Station.countDocuments({
    active: true,
    location: {
      $geoWithin: {
        $centerSphere: [[longitude, latitude], radiusM / 6378100],
      },
    },
  });
  return count >= PLACES.minCachedStationsToSkipLookup;
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
 */
async function ensureCoverage({ latitude, longitude, radiusM }) {
  if (!placesService.isConfigured()) return { discovered: 0, skipped: 'not-configured' };

  try {
    if (await hasSufficientCoverage(latitude, longitude, radiusM)) {
      return { discovered: 0, skipped: 'cached' };
    }

    const seeds = await placesService.searchNearby({ latitude, longitude, radiusM });
    if (seeds.length === 0) return { discovered: 0, skipped: 'no-results' };

    const saved = await upsertDiscovered(seeds);
    logger.info('Discovered stations from place provider', {
      requested: seeds.length,
      persisted: saved.length,
    });
    return { discovered: saved.length };
  } catch (error) {
    logger.warn('Station discovery failed', { error: error.message });
    return { discovered: 0, skipped: 'error' };
  }
}

module.exports = { ensureCoverage, hasSufficientCoverage, upsertDiscovered };
