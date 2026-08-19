'use strict';

const https = require('node:https');

const env = require('../config/env');
const logger = require('../config/logger');
const { PLACES } = require('../config/constants');

/**
 * External place provider (Google Places API — New).
 *
 * SCOPE, deliberately narrow: this module resolves the IDENTITY and LOCATION of
 * real-world stations — name, coordinates, address, place id, navigation link.
 *
 * It must NEVER produce queue length, CNG availability, gas pressure or wait
 * time. Those are QLess observations that come only from Report documents. A
 * station discovered here starts with no live status at all, and the API
 * reports it as UNKNOWN until a human actually reports something.
 */

/**
 * Text search, not Nearby Search.
 *
 * Nearby Search can only filter by place TYPE, and CNG outlets share the
 * `gas_station` type with every petrol pump. Filtering those by name missed
 * whole regions: around Banswara, Google returns 20 fuel stations and not one
 * carries "CNG" in its name, so discovery found nothing. A text query for CNG
 * matches on Google's own place understanding instead of our spelling guesses.
 */
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

/**
 * Field mask is mandatory for the New Places API and is also the cost control:
 * we request only identity/location fields, nothing behavioural.
 */
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.addressComponents',
].join(',');

/** What we ask Google for. Kept broad; relevance is Google's job here. */
const TEXT_QUERY = 'CNG pump';

/**
 * Rejects results the text search returns for context rather than as matches —
 * CNG kit fitters, workshops and spare-part shops are not refuelling stations.
 */
const NOT_A_STATION =
  /\b(kit|fitting|fitment|workshop|garage|spare|repair|showroom|service centre|service center)\b/i;

const isConfigured = () => env.GOOGLE_PLACES_API_KEY.length > 0;

/** Pulls a named component (city/state/pincode) out of the provider payload. */
function component(place, type) {
  const hit = (place.addressComponents ?? []).find((c) => (c.types ?? []).includes(type));
  return hit?.longText ?? null;
}

/**
 * Maps a provider result into the subset of our Station shape that discovery is
 * allowed to populate. Note the absence of any status field — that is the whole
 * point of this boundary.
 */
function toStationSeed(place) {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const name = place.displayName?.text?.trim();
  if (!name || !place.id) return null;

  return {
    placeId: place.id,
    name,
    address: place.formattedAddress?.trim() || name,
    city: component(place, 'locality'),
    state: component(place, 'administrative_area_level_1'),
    pincode: component(place, 'postal_code'),
    latitude: lat,
    longitude: lng,
    placeData: {
      types: place.types ?? [],
      rating: typeof place.rating === 'number' ? place.rating : null,
      userRatingCount:
        typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
      googleMapsUri: place.googleMapsUri ?? null,
      businessStatus: place.businessStatus ?? null,
    },
  };
}

/**
 * POSTs to the provider over IPv4.
 *
 * `family: 4` is the load-bearing part. Node resolves this host to an IPv6
 * address when one is available, so the call leaves from the machine's IPv6
 * address — which on a residential connection is a rotating SLAAC address that
 * cannot practically be added to a Google API key's IP allowlist. Pinning to
 * IPv4 gives the key one stable address to authorise.
 *
 * Uses `node:https` rather than global fetch because fetch cannot select an
 * address family without pulling in undici as a dependency.
 */
function postJson(payload) {
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = https.request(
      ENDPOINT,
      {
        method: 'POST',
        family: 4,
        timeout: PLACES.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': FIELD_MASK,
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode, text }));
      },
    );

    request.on('timeout', () => {
      // `timeout` does not abort the request on its own.
      request.destroy(new Error(`Place provider timed out after ${PLACES.timeoutMs}ms`));
    });
    request.on('error', reject);
    request.end(body);
  });
}

/**
 * Finds real fuel/CNG stations around a point.
 *
 * Resolves to [] rather than throwing on any provider failure: discovery is an
 * enrichment step, and a provider outage must degrade to the stations we
 * already have in MongoDB instead of breaking the nearby endpoint.
 */
async function searchNearby({ latitude, longitude, radiusM }) {
  if (!isConfigured()) return [];

  // The provider caps its own radius well below our 100 km search ceiling.
  const radius = Math.min(radiusM ?? PLACES.maxSearchRadiusM, PLACES.maxSearchRadiusM);

  try {
    const response = await postJson({
      textQuery: TEXT_QUERY,
      maxResultCount: PLACES.maxResults,
      // Bias, not restriction: near a region's edge the closest real station can
      // sit just outside the circle, and excluding it would leave the user with
      // an empty list while a usable pump was minutes away.
      locationBias: {
        circle: {
          center: { latitude, longitude },
          radius,
        },
      },
    });

    if (response.status !== 200) {
      logger.warn('Place provider rejected the request', {
        status: response.status,
        detail: response.text.slice(0, 300),
      });
      return [];
    }

    const body = JSON.parse(response.text);
    const places = Array.isArray(body.places) ? body.places : [];

    return places
      .map(toStationSeed)
      .filter((seed) => seed !== null)
      .filter((seed) => !NOT_A_STATION.test(seed.name));
  } catch (error) {
    logger.warn('Place provider lookup failed', { error: error.message });
    return [];
  }
}

module.exports = { searchNearby, isConfigured, toStationSeed };
