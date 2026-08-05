import type { NotificationConditions } from '@/types';

export const DEFAULT_CONDITIONS: NotificationConditions = {
  onlyWhenAvailable: true,
  maxQueue: 5,
  maxWaitMinutes: 10,
  minPressure: undefined,
};

// Human-readable summary of an alert rule (used in Alerts list + confirmations).
export function ruleSummaryLines(c: NotificationConditions): string[] {
  const lines: string[] = [];
  if (c.onlyWhenAvailable) lines.push('CNG is available');
  if (c.maxQueue != null) lines.push(`Queue ≤ ${c.maxQueue}`);
  if (c.maxWaitMinutes != null) lines.push(`Wait ≤ ${c.maxWaitMinutes} min`);
  if (c.minPressure != null) lines.push(`Pressure ≥ ${c.minPressure} bar`);
  if (lines.length === 0) lines.push('Any change at this station');
  return lines;
}
