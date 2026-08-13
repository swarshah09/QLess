import { Availability, PressureUnit, SupplyEventType } from '@prisma/client';
import { z } from 'zod';
import { GEO } from '../config/constants';
import {
  latitudeSchema,
  longitudeSchema,
  paginationSchema,
  pressureValueSchema,
  uuidSchema,
} from './common.validators';
import { QUEUE_RANGE_LABELS } from '../utils/queue';

export const stationIdParamSchema = z.object({ stationId: uuidSchema });

/**
 * Queue is submitted as a human range label rather than a raw count, matching
 * how a driver actually perceives a forecourt. "UNKNOWN" is a first-class,
 * valid answer — it is stored as null bounds, never as zero.
 */
export const queueRangeSchema = z.enum(QUEUE_RANGE_LABELS);

/**
 * Coordinates must be supplied together. A latitude without a longitude is
 * meaningless, and silently ignoring the stray half would quietly downgrade a
 * report that the user believed was location-verified.
 */
const coordinatePairRefinement = <T extends { latitude?: number; longitude?: number }>(
  value: T,
) => (value.latitude === undefined) === (value.longitude === undefined);

/**
 * A crowd report from a normal user.
 *
 * Every observable field is optional so partial reporting works — someone can
 * see the queue without knowing the pressure. `.strict()` rejects unknown keys,
 * which is what stops a client from submitting `locationVerified: true` and
 * having it silently accepted; verification is computed server-side regardless.
 */
export const submitReportSchema = z
  .object({
    queueRange: queueRangeSchema.optional(),
    availability: z.nativeEnum(Availability).optional(),
    pressureValue: pressureValueSchema.optional(),
    pressureUnit: z.nativeEnum(PressureUnit).optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(coordinatePairRefinement, {
    message: 'latitude and longitude must be provided together',
    path: ['latitude'],
  })
  .refine(
    (value) =>
      value.queueRange !== undefined ||
      value.availability !== undefined ||
      value.pressureValue !== undefined,
    { message: 'Provide at least one of queueRange, availability or pressureValue' },
  );

/** An operator's update for an assigned station. */
export const operatorUpdateSchema = z
  .object({
    queueRange: queueRangeSchema.optional(),
    availability: z.nativeEnum(Availability).optional(),
    pressureValue: pressureValueSchema.optional(),
    pressureUnit: z.nativeEnum(PressureUnit).optional(),
    activeDispensers: z.coerce.number().int().min(0).max(100).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.queueRange !== undefined ||
      value.availability !== undefined ||
      value.pressureValue !== undefined ||
      value.activeDispensers !== undefined,
    { message: 'Provide at least one value to update' },
  );

export const supplyEventSchema = z
  .object({
    type: z.nativeEnum(SupplyEventType),
    /** Overrides the availability the event type would otherwise imply. */
    availability: z.nativeEnum(Availability).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const supplyEventParamsSchema = z.object({
  stationId: uuidSchema,
  eventId: uuidSchema,
});

// --- Discovery ------------------------------------------------------------

export const sortSchema = z.enum(['distance', 'wait', 'queue', 'recent']);

/** Comma-separated availabilities, e.g. `?availability=AVAILABLE,LOW_SUPPLY`. */
const availabilityListSchema = z
  .string()
  .transform((value) => value.split(',').map((part) => part.trim().toUpperCase()))
  .pipe(z.array(z.nativeEnum(Availability)).min(1));

export const nearbyQuerySchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radius: z.coerce.number().positive().max(GEO.maxSearchRadiusM).optional(),
  /** Nearest first unless the caller asks otherwise. */
  sort: sortSchema.default('distance'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  availability: availabilityListSchema.optional(),
  maxQueue: z.coerce.number().int().min(0).optional(),
  maxWait: z.coerce.number().int().min(0).optional(),
  minPressure: z.coerce.number().min(0).optional(),
});

/** Optional coordinates on a detail request, used only to compute distance. */
export const stationDetailQuerySchema = z
  .object({
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
  })
  .refine(coordinatePairRefinement, {
    message: 'latitude and longitude must be provided together',
    path: ['latitude'],
  });

export const reportHistoryQuerySchema = paginationSchema;
export const supplyEventListQuerySchema = paginationSchema;

// --- Saved stations -------------------------------------------------------

export const saveStationSchema = z
  .object({ label: z.string().trim().max(80).nullable().optional() })
  .strict();

export const savedStationsQuerySchema = z
  .object({
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
  })
  .refine(coordinatePairRefinement, {
    message: 'latitude and longitude must be provided together',
    path: ['latitude'],
  });
