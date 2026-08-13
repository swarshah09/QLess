import { Availability, PressureUnit, StationOperatorRole, UserRole } from '@prisma/client';
import { z } from 'zod';
import {
  latitudeSchema,
  longitudeSchema,
  paginationSchema,
  uuidSchema,
} from './common.validators';

export const listUsersQuerySchema = paginationSchema.extend({
  role: z.nativeEnum(UserRole).optional(),
});

export const userIdParamSchema = z.object({ userId: uuidSchema });

export const updateUserRoleSchema = z
  .object({ role: z.nativeEnum(UserRole) })
  .strict();

export const setUserActiveSchema = z.object({ active: z.boolean() }).strict();

export const stationIdParamSchema = z.object({ stationId: uuidSchema });

export const assignOperatorParamsSchema = z.object({ stationId: uuidSchema });

export const assignOperatorSchema = z
  .object({
    userId: uuidSchema,
    role: z.nativeEnum(StationOperatorRole).default(StationOperatorRole.STAFF),
  })
  .strict();

export const revokeOperatorParamsSchema = z.object({
  stationId: uuidSchema,
  userId: uuidSchema,
});

export const auditLogQuerySchema = paginationSchema;

// --- Station management (Part 7) -------------------------------------------

/** A reason is mandatory wherever an admin action is user-visible. */
const reasonSchema = z
  .string()
  .trim()
  .min(5, 'Provide a reason of at least 5 characters')
  .max(500);

export const listStationsAdminQuerySchema = paginationSchema.extend({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .default('true'),
  search: z.string().trim().min(1).max(120).optional(),
});

const operatingHoursSchema = z.record(z.unknown()).nullable();

export const createStationSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    address: z.string().trim().min(2).max(400),
    city: z.string().trim().max(120).nullable().optional(),
    state: z.string().trim().max(120).nullable().optional(),
    pincode: z.string().trim().max(12).nullable().optional(),
    // Mandatory: distance-based discovery is a core feature, so a station
    // without coordinates cannot be found at all.
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    numberOfDispensers: z.coerce.number().int().min(1).max(100).optional(),
    operatingHours: operatingHoursSchema.optional(),
    pressureThresholdLow: z.coerce.number().min(0).max(500).nullable().optional(),
    pressureThresholdNormal: z.coerce.number().min(0).max(500).nullable().optional(),
    defaultPressureUnit: z.nativeEnum(PressureUnit).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const updateStationAdminSchema = createStationSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const setStationActiveSchema = z
  .object({ active: z.boolean(), reason: reasonSchema })
  .strict();

/**
 * Manual status override. `reason` is required by the schema, not just the
 * service, so an unreasoned override cannot even reach the business logic.
 */
export const overrideStatusSchema = z
  .object({
    availability: z.nativeEnum(Availability).optional(),
    queueMin: z.coerce.number().int().min(0).max(500).nullable().optional(),
    queueMax: z.coerce.number().int().min(0).max(500).nullable().optional(),
    pressureValue: z.coerce.number().min(0).max(5000).nullable().optional(),
    pressureUnit: z.nativeEnum(PressureUnit).optional(),
    activeDispensers: z.coerce.number().int().min(0).max(100).optional(),
    reason: reasonSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.availability !== undefined ||
      value.queueMin !== undefined ||
      value.pressureValue !== undefined ||
      value.activeDispensers !== undefined,
    { message: 'An override must change at least one value' },
  )
  .refine(
    (value) =>
      value.queueMin == null || value.queueMax == null || value.queueMin <= value.queueMax,
    { message: 'queueMin must be less than or equal to queueMax', path: ['queueMin'] },
  );

export const statsQuerySchema = z.object({
  sinceHours: z.coerce.number().int().min(1).max(720).default(24),
});

export const suspiciousReportsQuerySchema = paginationSchema.extend({
  sinceHours: z.coerce.number().int().min(1).max(720).default(168),
});

export const auditLogFilterSchema = paginationSchema.extend({
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(80).optional(),
});
