'use strict';

const mongoose = require('mongoose');
const {
  AVAILABILITY,
  FRESHNESS_LEVELS,
  PRESSURE_STATUSES,
  PRESSURE_UNITS,
  QUEUE_LABELS,
} = require('../config/constants');

/**
 * The COMPUTED current state of a station.
 *
 * Embedded rather than a separate collection: it is read on every discovery
 * query and always alongside its station, so embedding removes a join from the
 * hottest path. It is derived data — the Report collection remains the
 * append-only source of truth, and this is recomputed from it.
 */
const statusSchema = new mongoose.Schema(
  {
    availability: { type: String, enum: AVAILABILITY, default: 'UNKNOWN' },

    /** Both null means UNKNOWN. Never store 0 to mean "we don't know". */
    queueMin: { type: Number, default: null },
    queueMax: { type: Number, default: null },
    queueLabel: { type: String, enum: QUEUE_LABELS, default: 'UNKNOWN' },

    /** Estimated wait in minutes. Null means unknown, not zero. */
    waitMin: { type: Number, default: null },
    waitMax: { type: Number, default: null },

    pressureValue: { type: Number, default: null },
    pressureUnit: { type: String, enum: PRESSURE_UNITS, default: 'BAR' },
    pressureStatus: { type: String, enum: PRESSURE_STATUSES, default: 'UNKNOWN' },

    activeDispensers: { type: Number, default: null },

    confidence: { type: Number, default: 0, min: 0, max: 100 },
    freshness: { type: String, enum: FRESHNESS_LEVELS, default: 'UNKNOWN' },

    computedAt: { type: Date, default: null },
    lastOperatorUpdateAt: { type: Date, default: null },
    lastUserUpdateAt: { type: Date, default: null },
  },
  { _id: false },
);

const stationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160, index: true },
    address: { type: String, required: true, trim: true, maxlength: 400 },
    city: { type: String, trim: true, maxlength: 120, default: null },
    state: { type: String, trim: true, maxlength: 120, default: null },
    pincode: { type: String, trim: true, maxlength: 12, default: null },

    /**
     * GeoJSON Point, [longitude, latitude] — note the order, which is the
     * reverse of how humans say it and the usual source of bugs here.
     * Required because distance-based discovery is a core product feature.
     */
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (value) =>
            Array.isArray(value) &&
            value.length === 2 &&
            value[0] >= -180 &&
            value[0] <= 180 &&
            value[1] >= -90 &&
            value[1] <= 90,
          message: 'coordinates must be [longitude, latitude] within valid ranges',
        },
      },
    },

    /** Weekly hours, e.g. { mon: [{ open: "06:00", close: "22:00" }] }. */
    operatingHours: { type: mongoose.Schema.Types.Mixed, default: null },

    active: { type: Boolean, default: true, index: true },
    numberOfDispensers: { type: Number, default: 1, min: 1, max: 100 },

    /**
     * Per-station pressure thresholds. Null falls back to the platform default
     * — what counts as good pressure varies by equipment, so there is no
     * universal constant.
     */
    pressureThresholdLow: { type: Number, default: null },
    pressureThresholdNormal: { type: Number, default: null },
    defaultPressureUnit: { type: String, enum: PRESSURE_UNITS, default: 'BAR' },

    status: { type: statusSchema, default: () => ({}) },

    /**
     * Where this station record came from.
     *
     * SEED/MANUAL records are curated by us; PLACES records were discovered via
     * the external place provider. Discovery only ever establishes a station's
     * IDENTITY and LOCATION — never its live status, which comes exclusively
     * from Report documents.
     */
    source: {
      type: String,
      enum: ['SEED', 'MANUAL', 'PLACES'],
      default: 'MANUAL',
      index: true,
    },

    /**
     * Provider place identifier. Unique when present, so re-running discovery
     * over the same area updates the existing station instead of duplicating
     * it. `sparse` is required: most seeded stations have no placeId, and a
     * plain unique index would reject all but one null.
     */
    placeId: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      trim: true,
    },

    /** Cache bookkeeping so we can refresh stale place details selectively. */
    placeSyncedAt: { type: Date, default: null },

    /** Provider-reported metadata, kept for navigation and disambiguation. */
    placeData: {
      types: { type: [String], default: undefined },
      rating: { type: Number, default: null },
      userRatingCount: { type: Number, default: null },
      googleMapsUri: { type: String, default: null },
      businessStatus: { type: String, default: null },
    },
  },
  { timestamps: true },
);

/**
 * 2dsphere powers $geoNear / $nearSphere — the whole point of using MongoDB
 * here. Without it, nearest-first discovery cannot run at all.
 */
stationSchema.index({ location: '2dsphere' });

// Discovery filters on `active` and sorts by distance; the compound index lets
// the common "active stations near me" query be served efficiently.
stationSchema.index({ active: 1, 'status.availability': 1 });
stationSchema.index({ 'status.computedAt': -1 });
stationSchema.index({ city: 1, active: 1 });

/** Convenience accessors so callers never juggle the GeoJSON array order. */
stationSchema.virtual('latitude').get(function () {
  return this.location?.coordinates?.[1] ?? null;
});
stationSchema.virtual('longitude').get(function () {
  return this.location?.coordinates?.[0] ?? null;
});

stationSchema.set('toJSON', { virtuals: true });
stationSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Station', stationSchema);
