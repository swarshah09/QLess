'use strict';

const { z } = require('zod');
const {
  AVAILABILITY,
  GEO,
  NOTIFICATIONS,
  PAGINATION,
  PRESSURE_UNITS,
  QUEUE_LABELS,
  ROLES,
  SUPPLY_EVENT_TYPES,
  VISIT_OUTCOMES,
} = require('../config/constants');

/**
 * Reusable primitives. Feature schemas compose these rather than redefining
 * rules, so validation stays consistent across the API.
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

const latitude = z.coerce.number().min(-90, 'Latitude must be >= -90').max(90, 'Latitude must be <= 90');
const longitude = z.coerce
  .number()
  .min(-180, 'Longitude must be >= -180')
  .max(180, 'Longitude must be <= 180');

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.defaultPage),
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
});

/**
 * Coordinates must be supplied together — a latitude without a longitude is
 * meaningless, and silently ignoring the stray half would quietly downgrade a
 * report the user believed was location-verified.
 */
const coordinatePair = (value) =>
  (value.latitude === undefined) === (value.longitude === undefined);

// --- Auth -------------------------------------------------------------------

const email = z.string().trim().toLowerCase().email('Must be a valid email address').max(255);

// Length dominates resistance to guessing, so a generous minimum beats a
// character-class maze that mostly produces "Password1!".
const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  // bcrypt silently ignores input past 72 bytes; reject rather than truncate.
  .max(72, 'Password must be at most 72 characters');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  phone: z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'Must be a valid phone number').optional(),
  password,
  // `role` is intentionally absent: self-registration always creates a USER.
});

const loginSchema = z.object({
  email,
  // Not held to the policy — an existing password predating a change must work.
  password: z.string().min(1, 'Password is required').max(72),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1).max(500).optional() });

// --- Stations ---------------------------------------------------------------

const stationIdParam = z.object({ stationId: objectId });
const idParam = z.object({ id: objectId });

const availabilityList = z
  .string()
  .transform((value) => value.split(',').map((p) => p.trim().toUpperCase()))
  .pipe(z.array(z.enum(AVAILABILITY)).min(1));

const nearbyQuerySchema = z.object({
  latitude,
  longitude,
  radius: z.coerce.number().positive().max(GEO.maxSearchRadiusM).optional(),
  /** Nearest first unless the caller asks otherwise. */
  sort: z.enum(['distance', 'wait', 'queue', 'recent']).default('distance'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  availability: availabilityList.optional(),
  maxQueue: z.coerce.number().int().min(0).optional(),
  maxWait: z.coerce.number().int().min(0).optional(),
  minPressure: z.coerce.number().min(0).optional(),
});

const stationDetailQuerySchema = z
  .object({ latitude: latitude.optional(), longitude: longitude.optional() })
  .refine(coordinatePair, {
    message: 'latitude and longitude must be provided together',
    path: ['latitude'],
  });

const listStationsQuerySchema = pagination.extend({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const recommendationQuerySchema = z.object({
  latitude,
  longitude,
  radius: z.coerce.number().positive().max(GEO.maxSearchRadiusM).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// --- Reports ----------------------------------------------------------------

/**
 * A crowd report. Every field optional so partial reporting works — someone can
 * see the queue without knowing the pressure. `.strict()` rejects unknown keys,
 * which is what stops a client submitting `locationVerified: true`; verification
 * is computed server-side regardless.
 */
const submitReportSchema = z
  .object({
    queueRange: z.enum(QUEUE_LABELS).optional(),
    availability: z.enum(AVAILABILITY).optional(),
    pressureValue: z.coerce.number().min(0).max(5000).optional(),
    pressureUnit: z.enum(PRESSURE_UNITS).optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(coordinatePair, {
    message: 'latitude and longitude must be provided together',
    path: ['latitude'],
  })
  .refine(
    (v) =>
      v.queueRange !== undefined || v.availability !== undefined || v.pressureValue !== undefined,
    { message: 'Provide at least one of queueRange, availability or pressureValue' },
  );

const operatorUpdateSchema = z
  .object({
    queueRange: z.enum(QUEUE_LABELS).optional(),
    availability: z.enum(AVAILABILITY).optional(),
    pressureValue: z.coerce.number().min(0).max(5000).optional(),
    pressureUnit: z.enum(PRESSURE_UNITS).optional(),
    activeDispensers: z.coerce.number().int().min(0).max(100).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.queueRange !== undefined ||
      v.availability !== undefined ||
      v.pressureValue !== undefined ||
      v.activeDispensers !== undefined,
    { message: 'Provide at least one value to update' },
  );

const supplyEventSchema = z
  .object({
    type: z.enum(SUPPLY_EVENT_TYPES),
    availability: z.enum(AVAILABILITY).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

const updateStationConfigSchema = z
  .object({
    active: z.boolean().optional(),
    numberOfDispensers: z.coerce.number().int().min(1).max(100).optional(),
    operatingHours: z.record(z.unknown()).nullable().optional(),
    pressureThresholdLow: z.coerce.number().min(0).max(500).nullable().optional(),
    pressureThresholdNormal: z.coerce.number().min(0).max(500).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });

// --- Visits & saved ---------------------------------------------------------

/** Coordinates required: a visit is a claim about physical presence. */
const checkInSchema = z.object({ latitude, longitude }).strict();

const completeVisitSchema = z.object({ outcome: z.enum(VISIT_OUTCOMES).optional() }).strict();

const visitIdParam = z.object({ stationId: objectId, visitId: objectId });

const saveStationSchema = z
  .object({ label: z.string().trim().max(80).nullable().optional() })
  .strict();

const savedStationsQuerySchema = z
  .object({ latitude: latitude.optional(), longitude: longitude.optional() })
  .refine(coordinatePair, {
    message: 'latitude and longitude must be provided together',
    path: ['latitude'],
  });

// --- Notifications ----------------------------------------------------------

const cooldown = z.coerce
  .number()
  .int()
  .min(NOTIFICATIONS.minCooldownMinutes)
  .max(NOTIFICATIONS.maxCooldownMinutes);

const createRuleSchema = z
  .object({
    stationId: objectId,
    /** Empty means "any availability" rather than "none". */
    requiredAvailability: z.array(z.enum(AVAILABILITY)).max(5).optional(),
    maxQueue: z.coerce.number().int().min(0).max(500).nullable().optional(),
    maxWaitMinutes: z.coerce.number().int().min(0).max(600).nullable().optional(),
    minPressure: z.coerce.number().min(0).max(500).nullable().optional(),
    pressureUnit: z.enum(PRESSURE_UNITS).optional(),
    enabled: z.boolean().optional(),
    cooldownMinutes: cooldown.optional(),
  })
  .strict();

const updateRuleSchema = z
  .object({
    requiredAvailability: z.array(z.enum(AVAILABILITY)).max(5).optional(),
    maxQueue: z.coerce.number().int().min(0).max(500).nullable().optional(),
    maxWaitMinutes: z.coerce.number().int().min(0).max(600).nullable().optional(),
    minPressure: z.coerce.number().min(0).max(500).nullable().optional(),
    pressureUnit: z.enum(PRESSURE_UNITS).optional(),
    enabled: z.boolean().optional(),
    cooldownMinutes: cooldown.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });

/** Matches the shape `PushSubscription.toJSON()` produces. */
const subscribeSchema = z
  .object({
    endpoint: z.string().url().max(1000),
    keys: z.object({
      p256dh: z.string().min(1).max(255),
      auth: z.string().min(1).max(255),
    }),
  })
  .strict();

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(1000) }).strict();

// --- Admin ------------------------------------------------------------------

/** Mandatory wherever an admin action is user-visible. */
const reason = z.string().trim().min(5, 'Provide a reason of at least 5 characters').max(500);

const userIdParam = z.object({ userId: objectId });

const listUsersQuerySchema = pagination.extend({ role: z.enum(Object.values(ROLES)).optional() });

const updateUserRoleSchema = z.object({ role: z.enum(Object.values(ROLES)) }).strict();
const setUserActiveSchema = z.object({ active: z.boolean() }).strict();

const createStationSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    address: z.string().trim().min(2).max(400),
    city: z.string().trim().max(120).nullable().optional(),
    state: z.string().trim().max(120).nullable().optional(),
    pincode: z.string().trim().max(12).nullable().optional(),
    // Mandatory: a station without coordinates cannot be discovered at all.
    latitude,
    longitude,
    numberOfDispensers: z.coerce.number().int().min(1).max(100).optional(),
    operatingHours: z.record(z.unknown()).nullable().optional(),
    pressureThresholdLow: z.coerce.number().min(0).max(500).nullable().optional(),
    pressureThresholdNormal: z.coerce.number().min(0).max(500).nullable().optional(),
    defaultPressureUnit: z.enum(PRESSURE_UNITS).optional(),
    active: z.boolean().optional(),
  })
  .strict();

const updateStationAdminSchema = createStationSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });

const setStationActiveSchema = z.object({ active: z.boolean(), reason }).strict();

/** `reason` is required by the schema, so an unreasoned override never reaches the service. */
const overrideStatusSchema = z
  .object({
    availability: z.enum(AVAILABILITY).optional(),
    queueMin: z.coerce.number().int().min(0).max(500).nullable().optional(),
    queueMax: z.coerce.number().int().min(0).max(500).nullable().optional(),
    pressureValue: z.coerce.number().min(0).max(5000).nullable().optional(),
    pressureUnit: z.enum(PRESSURE_UNITS).optional(),
    activeDispensers: z.coerce.number().int().min(0).max(100).optional(),
    reason,
  })
  .strict()
  .refine(
    (v) =>
      v.availability !== undefined ||
      v.queueMin !== undefined ||
      v.pressureValue !== undefined ||
      v.activeDispensers !== undefined,
    { message: 'An override must change at least one value' },
  )
  .refine((v) => v.queueMin == null || v.queueMax == null || v.queueMin <= v.queueMax, {
    message: 'queueMin must be less than or equal to queueMax',
    path: ['queueMin'],
  });

const assignOperatorSchema = z
  .object({ userId: objectId, role: z.enum(['MANAGER', 'STAFF']).default('STAFF') })
  .strict();

const revokeOperatorParams = z.object({ stationId: objectId, userId: objectId });

const statsQuerySchema = z.object({
  sinceHours: z.coerce.number().int().min(1).max(720).default(24),
});

const suspiciousQuerySchema = pagination.extend({
  sinceHours: z.coerce.number().int().min(1).max(720).default(168),
});

const auditLogQuerySchema = pagination.extend({
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(80).optional(),
});

const adminStationsQuerySchema = pagination.extend({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .default('true'),
  search: z.string().trim().min(1).max(120).optional(),
});

module.exports = {
  objectId,
  pagination,
  idParam,
  stationIdParam,
  userIdParam,
  visitIdParam,
  revokeOperatorParams,
  registerSchema,
  loginSchema,
  refreshSchema,
  nearbyQuerySchema,
  stationDetailQuerySchema,
  listStationsQuerySchema,
  recommendationQuerySchema,
  submitReportSchema,
  operatorUpdateSchema,
  supplyEventSchema,
  updateStationConfigSchema,
  checkInSchema,
  completeVisitSchema,
  saveStationSchema,
  savedStationsQuerySchema,
  createRuleSchema,
  updateRuleSchema,
  subscribeSchema,
  unsubscribeSchema,
  listUsersQuerySchema,
  updateUserRoleSchema,
  setUserActiveSchema,
  createStationSchema,
  updateStationAdminSchema,
  setStationActiveSchema,
  overrideStatusSchema,
  assignOperatorSchema,
  statsQuerySchema,
  suspiciousQuerySchema,
  auditLogQuerySchema,
  adminStationsQuerySchema,
};
