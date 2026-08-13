import { apiRequest, ApiError } from '@/lib/api/client';
import { VAPID_PUBLIC_KEY } from '@/lib/api/config';
import { mapRule, toRulePayload, type ApiNotificationRule } from '@/lib/api/mappers';
import type { NotificationConditions, NotificationRule } from '@/types';

export type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

/** Web Push keys are base64url; the browser needs a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

let cachedVapidKey: string | null = VAPID_PUBLIC_KEY || null;

async function resolveVapidKey(): Promise<string | null> {
  if (cachedVapidKey) return cachedVapidKey;
  try {
    // Falls back to the backend so a deployment only configures the key once.
    const result = await apiRequest<{ publicKey: string | null; configured: boolean }>(
      '/notifications/vapid-public-key',
      { auth: false },
    );
    cachedVapidKey = result.publicKey;
    return cachedVapidKey;
  } catch {
    return null;
  }
}

// NotificationService — alert rules plus the browser push lifecycle.
export const NotificationService = {
  async listRules(): Promise<NotificationRule[]> {
    const result = await apiRequest<{ rules: ApiNotificationRule[] }>(
      '/notifications/rules',
    );
    return result.rules.map((rule) => mapRule(rule));
  },

  async createRule(
    stationId: string,
    stationName: string,
    conditions: NotificationConditions,
  ): Promise<NotificationRule> {
    try {
      const result = await apiRequest<{ rule: ApiNotificationRule }>(
        '/notifications/rules',
        {
          method: 'POST',
          body: { stationId, ...toRulePayload(conditions) },
        },
      );
      return mapRule(result.rule, stationName);
    } catch (error) {
      // One alert per station is a backend constraint; updating the existing
      // rule is what the user actually meant.
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        const existing = (await this.listRules()).find((r) => r.stationId === stationId);
        if (existing) {
          await this.updateRule(existing.id, conditions);
          return { ...existing, conditions, status: 'ACTIVE' };
        }
      }
      throw error;
    }
  },

  async updateRule(id: string, conditions: NotificationConditions): Promise<void> {
    await apiRequest<unknown>(`/notifications/rules/${id}`, {
      method: 'PATCH',
      body: { ...toRulePayload(conditions), enabled: true },
    });
  },

  async setStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
    await apiRequest<unknown>(`/notifications/rules/${id}`, {
      method: 'PATCH',
      body: { enabled: status === 'ACTIVE' },
    });
  },

  async deleteRule(id: string): Promise<void> {
    await apiRequest<unknown>(`/notifications/rules/${id}`, { method: 'DELETE' });
  },

  getPermissionState(): PermissionState {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission as PermissionState;
  },

  /** Only ever called after the user explicitly creates an alert. */
  async requestPermission(): Promise<PermissionState> {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    try {
      return (await Notification.requestPermission()) as PermissionState;
    } catch {
      return 'denied';
    }
  },

  /**
   * Registers this device for Web Push and stores the subscription on the
   * backend. Idempotent — re-subscribing the same endpoint just refreshes it.
   *
   * Returns false rather than throwing when push is unavailable: an alert rule
   * is still useful without it (the condition is evaluated either way), so a
   * missing service worker must not block rule creation.
   */
  async ensurePushSubscription(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (Notification.permission !== 'granted') return false;

    const key = await resolveVapidKey();
    if (!key) return false;

    try {
      const registration = await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // A subscription created under a different VAPID key cannot receive
        // our pushes, so it is replaced rather than reused.
        const currentKey = subscription.options.applicationServerKey;
        const expected = urlBase64ToUint8Array(key);
        const matches =
          currentKey !== null &&
          new Uint8Array(currentKey).length === expected.length &&
          new Uint8Array(currentKey).every((byte, i) => byte === expected[i]);

        if (!matches) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        });
      }

      const payload = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };

      if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) return false;

      await apiRequest<unknown>('/notifications/subscriptions', {
        method: 'POST',
        body: {
          endpoint: payload.endpoint,
          keys: { p256dh: payload.keys.p256dh, auth: payload.keys.auth },
        },
      });

      return true;
    } catch {
      return false;
    }
  },

  /** Registers the service worker that receives and displays pushes. */
  async registerServiceWorker(): Promise<boolean> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      return true;
    } catch {
      return false;
    }
  },

  async listSubscriptions(): Promise<
    Array<{ id: string; endpointSuffix: string; userAgent: string | null }>
  > {
    const result = await apiRequest<{
      subscriptions: Array<{ id: string; endpointSuffix: string; userAgent: string | null }>;
    }>('/notifications/subscriptions');
    return result.subscriptions;
  },

  /** Unregisters this device, both in the browser and on the backend. */
  async removePushSubscription(): Promise<void> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;

      await apiRequest<unknown>('/notifications/subscriptions', {
        method: 'DELETE',
        body: { endpoint: subscription.endpoint },
      }).catch(() => undefined);

      await subscription.unsubscribe();
    } catch {
      /* ignore */
    }
  },

  /** Delivery history for the signed-in user. */
  async listEvents(): Promise<
    Array<{ id: string; title: string; body: string; status: string; createdAt: string }>
  > {
    const result = await apiRequest<{
      items: Array<{
        id: string;
        title: string;
        body: string;
        status: string;
        createdAt: string;
      }>;
    }>('/notifications/events', { query: { limit: 25 } });
    return result.items;
  },
};
