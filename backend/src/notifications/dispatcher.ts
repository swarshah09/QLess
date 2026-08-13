import type { NotificationEvent } from '@prisma/client';
import { logger } from '../config/logger';

/**
 * Delivery hand-off seam.
 *
 * The evaluator's job ends once a NotificationEvent row exists; something then
 * has to deliver it. That "something" is behind this interface so the same
 * evaluation code works whether delivery happens inline (today) or on a
 * BullMQ/Redis worker (later).
 *
 * Swapping in a queue means writing a `RedisDispatcher` that enqueues the event
 * id and changing the one line in `index.ts` that selects the dispatcher. No
 * changes to rule evaluation, the API, or the persisted shape — the event row
 * is already the durable job record, complete with `attempts`, `scheduledAt`
 * and `status`.
 */
export interface NotificationDispatcher {
  readonly mode: 'inline' | 'queue';
  /**
   * Hands an event off for delivery. Resolving does NOT mean delivered — only
   * that the event has been accepted for processing.
   */
  dispatch(event: NotificationEvent): Promise<void>;
}

/**
 * Delivers in-process, immediately.
 *
 * Adequate at current volume and keeps the deployment to one service. Failures
 * are recorded on the event row, so a queue worker introduced later can pick up
 * anything left PENDING without a migration.
 */
export function createInlineDispatcher(
  deliver: (event: NotificationEvent) => Promise<void>,
): NotificationDispatcher {
  return {
    mode: 'inline',
    async dispatch(event: NotificationEvent): Promise<void> {
      try {
        await deliver(event);
      } catch (error) {
        // Never allowed to propagate: a delivery failure must not roll back the
        // status recomputation that triggered it.
        logger.error({ err: error, eventId: event.id }, 'Notification delivery failed');
      }
    },
  };
}
