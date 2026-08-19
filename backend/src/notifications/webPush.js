'use strict';

const webpush = require('web-push');
const env = require('../config/env');
const logger = require('../config/logger');

/**
 * Web Push transport, isolated so the notification service never imports
 * `web-push` directly. That keeps delivery swappable (FCM, APNs) and lets tests
 * substitute a recording transport instead of hitting the network.
 */

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;

  // A mailto: subject is required by the VAPID spec so push services have a
  // contact for abuse reports.
  webpush.setVapidDetails(
    `mailto:${env.VAPID_SUBJECT}`,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  configured = true;
  return true;
}

const webPushTransport = {
  get configured() {
    return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  },

  async send(target, payload) {
    if (!ensureConfigured()) {
      // Not retryable: waiting does not supply missing keys.
      return { ok: false, retryable: false, gone: false, error: 'VAPID keys are not configured' };
    }

    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { TTL: 1800, urgency: 'high' },
      );
      return { ok: true };
    } catch (error) {
      const statusCode = error?.statusCode;
      const message = error?.message ?? String(error);

      // 404/410 mean the browser discarded the subscription for good.
      if (statusCode === 404 || statusCode === 410) {
        return { ok: false, retryable: false, gone: true, error: message, statusCode };
      }
      // 4xx (other than 429) means a malformed subscription or bad credentials
      // — an identical retry cannot help.
      if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        return { ok: false, retryable: false, gone: false, error: message, statusCode };
      }

      logger.warn('Push delivery failed, will retry', { statusCode, error: message });
      return { ok: false, retryable: true, error: message, statusCode };
    }
  },
};

/** Swappable for tests. */
let active = webPushTransport;
const getTransport = () => active;
const setTransport = (next) => {
  active = next;
};

const publicVapidKey = () => env.VAPID_PUBLIC_KEY || null;

module.exports = { webPushTransport, getTransport, setTransport, publicVapidKey };
