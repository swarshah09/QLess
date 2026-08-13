import type { Request, Response } from 'express';
import {
  notificationRuleService,
  pushSubscriptionService,
} from '../services/notificationRule.service';
import { publicVapidKey } from '../notifications/webPush.transport';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/apiResponse';

export const notificationController = {
  async listRules(req: Request, res: Response): Promise<void> {
    const rules = await notificationRuleService.list(req.user!.id);
    sendSuccess(res, { rules });
  },

  async createRule(req: Request, res: Response): Promise<void> {
    const rule = await notificationRuleService.create(req.user!.id, req.body);
    sendCreated(res, { rule });
  },

  async updateRule(req: Request, res: Response): Promise<void> {
    const rule = await notificationRuleService.update(
      req.params.id,
      req.user!.id,
      req.body,
    );
    sendSuccess(res, { rule });
  },

  async deleteRule(req: Request, res: Response): Promise<void> {
    await notificationRuleService.remove(req.params.id, req.user!.id);
    sendSuccess(res, { deleted: true });
  },

  /** Public: clients need this key before they can create a subscription. */
  async vapidKey(_req: Request, res: Response): Promise<void> {
    const key = publicVapidKey();
    sendSuccess(res, { publicKey: key, configured: key !== null });
  },

  async listSubscriptions(req: Request, res: Response): Promise<void> {
    const subscriptions = await pushSubscriptionService.list(req.user!.id);
    sendSuccess(res, { subscriptions });
  },

  async subscribe(req: Request, res: Response): Promise<void> {
    const { endpoint, keys } = req.body;
    const subscription = await pushSubscriptionService.subscribe(req.user!.id, {
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.get('user-agent')?.slice(0, 400),
    });
    sendCreated(res, { subscription });
  },

  async unsubscribe(req: Request, res: Response): Promise<void> {
    await pushSubscriptionService.unsubscribe(req.user!.id, req.body.endpoint);
    sendSuccess(res, { removed: true });
  },

  async history(req: Request, res: Response): Promise<void> {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const { items, total } = await pushSubscriptionService.history(req.user!.id, {
      page,
      limit,
    });
    sendPaginated(res, items, page, limit, total);
  },
};
