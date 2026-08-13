import { Availability, PressureUnit } from '@prisma/client';
import { z } from 'zod';
import { NOTIFICATIONS } from '../config/constants';
import { paginationSchema, uuidSchema } from './common.validators';

export const ruleIdParamSchema = z.object({ id: uuidSchema });

const cooldownSchema = z.coerce
  .number()
  .int()
  .min(NOTIFICATIONS.minCooldownMinutes)
  .max(NOTIFICATIONS.maxCooldownMinutes);

/**
 * Availability list. Empty means "any availability" rather than "none", so it
 * is a valid way to express a rule that only cares about queue or pressure.
 */
const availabilityListSchema = z.array(z.nativeEnum(Availability)).max(5);

export const createRuleSchema = z
  .object({
    stationId: uuidSchema,
    requiredAvailability: availabilityListSchema.optional(),
    maxQueue: z.coerce.number().int().min(0).max(500).nullable().optional(),
    maxWaitMinutes: z.coerce.number().int().min(0).max(600).nullable().optional(),
    minPressure: z.coerce.number().min(0).max(500).nullable().optional(),
    pressureUnit: z.nativeEnum(PressureUnit).optional(),
    enabled: z.boolean().optional(),
    cooldownMinutes: cooldownSchema.optional(),
  })
  .strict();

export const updateRuleSchema = z
  .object({
    requiredAvailability: availabilityListSchema.optional(),
    maxQueue: z.coerce.number().int().min(0).max(500).nullable().optional(),
    maxWaitMinutes: z.coerce.number().int().min(0).max(600).nullable().optional(),
    minPressure: z.coerce.number().min(0).max(500).nullable().optional(),
    pressureUnit: z.nativeEnum(PressureUnit).optional(),
    enabled: z.boolean().optional(),
    cooldownMinutes: cooldownSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * A browser PushSubscription, matching the shape
 * `PushSubscription.toJSON()` produces so clients can forward it directly.
 */
export const subscribeSchema = z
  .object({
    endpoint: z.string().url().max(1000),
    keys: z.object({
      p256dh: z.string().min(1).max(255),
      auth: z.string().min(1).max(255),
    }),
  })
  .strict();

export const unsubscribeSchema = z
  .object({ endpoint: z.string().url().max(1000) })
  .strict();

export const historyQuerySchema = paginationSchema;
