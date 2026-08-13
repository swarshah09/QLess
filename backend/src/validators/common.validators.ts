import { Availability, PressureUnit, QueueBucket, ReportSource } from '@prisma/client';
import { z } from 'zod';
import { GEO, MAX_QUEUE_SIZE, PAGINATION, PRESSURE_DEFAULTS } from '../config/constants';

/**
 * Reusable Zod primitives. Feature validators in later phases compose these
 * rather than redefining rules, so validation stays consistent everywhere.
 */

export const uuidSchema = z.string().uuid('Must be a valid UUID');

export const latitudeSchema = z.coerce
  .number()
  .min(-90, 'Latitude must be >= -90')
  .max(90, 'Latitude must be <= 90');

export const longitudeSchema = z.coerce
  .number()
  .min(-180, 'Longitude must be >= -180')
  .max(180, 'Longitude must be <= 180');

export const coordinatesSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

export const radiusMetresSchema = z.coerce
  .number()
  .positive('Radius must be positive')
  .max(GEO.maxSearchRadiusM, `Radius must be <= ${GEO.maxSearchRadiusM}m`)
  .default(GEO.defaultSearchRadiusM);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.defaultPage),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.maxLimit)
    .default(PAGINATION.defaultLimit),
});

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export const availabilitySchema = z.nativeEnum(Availability);
export const reportSourceSchema = z.nativeEnum(ReportSource);
export const queueBucketSchema = z.nativeEnum(QueueBucket);
export const pressureUnitSchema = z.nativeEnum(PressureUnit);

const queueBoundSchema = z.coerce.number().int().min(0).max(MAX_QUEUE_SIZE);

/**
 * A queue range. Both bounds omitted means "unknown" and is valid — unknown
 * must never be submitted or stored as 0.
 */
export const queueRangeSchema = z
  .object({
    queueMin: queueBoundSchema.nullish(),
    queueMax: queueBoundSchema.nullish(),
  })
  .refine(
    (v) =>
      (v.queueMin === null || v.queueMin === undefined) ===
      (v.queueMax === null || v.queueMax === undefined),
    { message: 'Provide both queueMin and queueMax, or neither for an unknown queue' },
  )
  .refine((v) => v.queueMin == null || v.queueMax == null || v.queueMin <= v.queueMax, {
    message: 'queueMin must be less than or equal to queueMax',
    path: ['queueMin'],
  });

export const pressureValueSchema = z.coerce
  .number()
  .min(PRESSURE_DEFAULTS.minAccepted, 'Pressure cannot be negative')
  .max(
    PRESSURE_DEFAULTS.maxAccepted / 0.0689476,
    'Pressure value is outside the plausible range',
  );

/**
 * A pressure reading with its unit. Plausibility against the unit-converted
 * bounds is enforced in the service layer, where station context is available.
 */
export const pressureReadingSchema = z.object({
  pressureValue: pressureValueSchema,
  pressureUnit: pressureUnitSchema.default(PressureUnit.BAR),
});

export const isoDateSchema = z.coerce.date();

export const dateRangeSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: '`from` must be before or equal to `to`',
    path: ['from'],
  });

/** Path params of the common `/:id` shape. */
export const idParamSchema = z.object({ id: uuidSchema });

/** Path params of the common `/:stationId` shape. */
export const stationIdParamSchema = z.object({ stationId: uuidSchema });

export type PaginationInput = z.infer<typeof paginationSchema>;
export type CoordinatesInput = z.infer<typeof coordinatesSchema>;
export type QueueRangeInput = z.infer<typeof queueRangeSchema>;
