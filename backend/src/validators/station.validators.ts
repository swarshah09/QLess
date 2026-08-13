import { z } from 'zod';
import { paginationSchema, uuidSchema } from './common.validators';

export const stationIdParamSchema = z.object({ stationId: uuidSchema });

export const listStationsQuerySchema = paginationSchema.extend({
  // Honoured only for admins; the service ignores it for everyone else.
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/**
 * Fields an operator may change on an assigned station.
 *
 * Identity and location (name, address, latitude, longitude) are deliberately
 * absent — those are platform data an operator must not be able to rewrite.
 * `.strict()` rejects unknown keys outright so a client cannot smuggle in a
 * field that a future schema change might start honouring.
 */
export const updateStationSchema = z
  .object({
    active: z.boolean().optional(),
    numberOfDispensers: z.coerce.number().int().min(1).max(100).optional(),
    operatingHours: z.record(z.unknown()).nullable().optional(),
    pressureThresholdLow: z.coerce.number().min(0).max(500).nullable().optional(),
    pressureThresholdNormal: z.coerce.number().min(0).max(500).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateStationInput = z.infer<typeof updateStationSchema>;
