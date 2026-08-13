import webpush, { type PushSubscription as WebPushSubscription } from 'web-push';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Web Push transport.
 *
 * Isolated behind `PushTransport` so the notification service never imports
 * `web-push` directly — that keeps delivery swappable (FCM, APNs) and lets
 * tests substitute a recording transport instead of hitting the network.
 */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushOutcome =
  | { ok: true }
  /** Transient: worth retrying (network blip, 429, 5xx). */
  | { ok: false; retryable: true; error: string; statusCode?: number }
  /**
   * Permanent: the subscription is dead (404/410) or malformed. The caller
   * deactivates it rather than retrying forever.
   */
  | { ok: false; retryable: false; error: string; statusCode?: number; gone: boolean };

export interface PushTransport {
  readonly configured: boolean;
  send(target: PushTarget, payload: unknown): Promise<PushOutcome>;
}

let vapidConfigured = false;

function configureVapid(): boolean {
  if (vapidConfigured) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;

  webpush.setVapidDetails(
    // A mailto: subject is required by the VAPID spec so push services have a
    // contact for abuse reports.
    `mailto:${env.VAPID_SUBJECT}`,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  vapidConfigured = true;
  return true;
}

export const webPushTransport: PushTransport = {
  get configured(): boolean {
    return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  },

  async send(target: PushTarget, payload: unknown): Promise<PushOutcome> {
    if (!configureVapid()) {
      // Not retryable: no amount of waiting supplies missing keys.
      return {
        ok: false,
        retryable: false,
        gone: false,
        error: 'VAPID keys are not configured',
      };
    }

    const subscription: WebPushSubscription = {
      endpoint: target.endpoint,
      keys: { p256dh: target.p256dh, auth: target.auth },
    };

    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: 60 * 30,
        urgency: 'high',
      });
      return { ok: true };
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      const message = error instanceof Error ? error.message : String(error);

      // 404/410 mean the browser has discarded the subscription for good.
      if (statusCode === 404 || statusCode === 410) {
        return { ok: false, retryable: false, gone: true, error: message, statusCode };
      }

      // 400/401/403 indicate a malformed subscription or bad credentials —
      // retrying an identical request cannot help.
      if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        return { ok: false, retryable: false, gone: false, error: message, statusCode };
      }

      logger.warn({ statusCode, err: message }, 'Push delivery failed, will retry');
      return { ok: false, retryable: true, error: message, statusCode };
    }
  },
};

/** VAPID public key for clients to subscribe with. */
export function publicVapidKey(): string | null {
  return env.VAPID_PUBLIC_KEY || null;
}
