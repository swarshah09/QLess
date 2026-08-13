import { VisitOutcome } from '@prisma/client';
import { z } from 'zod';
import {
  latitudeSchema,
  longitudeSchema,
  paginationSchema,
  uuidSchema,
} from './common.validators';

export const visitIdParamSchema = z.object({
  stationId: uuidSchema,
  visitId: uuidSchema,
});

/**
 * "I'm Here". Coordinates are required — a visit is a claim about physical
 * presence, so there is nothing to record without them. `.strict()` rejects a
 * client-supplied `locationVerified`; verification is computed server-side.
 */
export const checkInSchema = z
  .object({
    latitude: latitudeSchema,
    longitude: longitudeSchema,
  })
  .strict();

/**
 * Ending a visit. `outcome` is optional and defaults to UNKNOWN — leaving the
 * station is explicitly NOT treated as a successful refuel.
 */
export const completeVisitSchema = z
  .object({ outcome: z.nativeEnum(VisitOutcome).optional() })
  .strict();

export const visitHistoryQuerySchema = paginationSchema;

/** Recommendations are computed over a nearby search, so they share its inputs. */
export const recommendationQuerySchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radius: z.coerce.number().positive().max(50_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
