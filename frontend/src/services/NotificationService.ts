import { SEED_ALERTS } from '@/mocks';
import { delay, readJSON, uid, writeJSON } from '@/lib/storage';
import type { NotificationConditions, NotificationRule } from '@/types';

const KEY = 'qless.alerts';

function load(): NotificationRule[] {
  return readJSON<NotificationRule[]>(KEY, SEED_ALERTS);
}
function save(rules: NotificationRule[]): void {
  writeJSON(KEY, rules);
}

export type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

// NotificationService — wraps alert-rule persistence (mocked) and the
// browser push-permission flow behind one abstraction.
export const NotificationService = {
  async listRules(): Promise<NotificationRule[]> {
    return delay(load(), 350);
  },

  async createRule(
    stationId: string,
    stationName: string,
    conditions: NotificationConditions,
  ): Promise<NotificationRule> {
    const rule: NotificationRule = {
      id: uid('alert'),
      stationId,
      stationName,
      conditions,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      triggeredAt: null,
    };
    const rules = load();
    save([rule, ...rules]);
    return delay(rule, 300);
  },

  async updateRule(
    id: string,
    conditions: NotificationConditions,
  ): Promise<void> {
    const rules = load().map((r) =>
      r.id === id ? { ...r, conditions, status: 'ACTIVE' as const } : r,
    );
    save(rules);
    return delay(undefined, 250);
  },

  async setStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
    const rules = load().map((r) => (r.id === id ? { ...r, status } : r));
    save(rules);
    return delay(undefined, 200);
  },

  async deleteRule(id: string): Promise<void> {
    save(load().filter((r) => r.id !== id));
    return delay(undefined, 200);
  },

  getPermissionState(): PermissionState {
    if (typeof window === 'undefined' || !('Notification' in window))
      return 'unsupported';
    return Notification.permission as PermissionState;
  },

  // Only ever called after the user explicitly creates an alert.
  async requestPermission(): Promise<PermissionState> {
    if (typeof window === 'undefined' || !('Notification' in window))
      return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    try {
      const result = await Notification.requestPermission();
      return result as PermissionState;
    } catch {
      return 'denied';
    }
  },
};
