'use strict';

const { NOTIFICATIONS } = require('../config/constants');

/**
 * Builds the user-facing notification text.
 *
 * Follows the same honesty rules as the rest of the platform: ranges are
 * described as approximations, and anything unknown is left out rather than
 * filled with a guess.
 */

const deepLinkFor = (stationId) =>
  NOTIFICATIONS.deepLinkPattern.replace('{stationId}', stationId);

function describeQueue(status) {
  if (status.queueMin === null && status.queueMax === null) return null;
  const max = status.queueMax ?? status.queueMin;
  if (max <= 3) return 'a short queue';
  if (max <= 7) return 'a moderate queue';
  if (max <= 15) return 'a busy queue';
  return 'a long queue';
}

function describeWait(status) {
  if (status.waitMin === null && status.waitMax === null) return null;
  const min = status.waitMin ?? status.waitMax;
  const max = status.waitMax ?? status.waitMin;
  // "~" so the number reads as the estimate it is, not a countdown.
  return `~${Math.round((min + max) / 2)} min wait`;
}

function describeAvailability(availability) {
  switch (availability) {
    case 'AVAILABLE':
      return 'CNG is available';
    case 'LOW_SUPPLY':
      return 'CNG is running low';
    case 'TEMPORARILY_INTERRUPTED':
      return 'supply is temporarily interrupted';
    case 'UNAVAILABLE':
      return 'CNG is unavailable';
    default:
      return null;
  }
}

const joinNaturally = (parts) =>
  parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

function composeMessage(station, status) {
  // Only the parts we actually know are mentioned.
  const fragments = [
    describeQueue(status),
    describeWait(status),
    describeAvailability(status.availability),
  ].filter(Boolean);

  const body =
    fragments.length > 0
      ? `${station.name} now has ${joinNaturally(fragments)}.`
      : `${station.name} now matches your alert.`;

  return {
    title: 'Good time to refuel ⛽',
    body: body.slice(0, 500),
    payload: {
      url: deepLinkFor(String(station._id)),
      stationId: String(station._id),
      // Collapses older alerts for the same station on the device.
      tag: `station-${String(station._id)}`,
      availability: status.availability,
      queue: { min: status.queueMin ?? null, max: status.queueMax ?? null },
      wait: { min: status.waitMin ?? null, max: status.waitMax ?? null },
      confidence: status.confidence,
    },
  };
}

module.exports = { composeMessage, deepLinkFor };
