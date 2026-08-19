'use strict';

const mongoose = require('mongoose');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 255,
    },
    phone: { type: String, trim: true, maxlength: 20, default: null },

    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.USER,
      index: true,
    },

    /**
     * `select: false` so the hash never leaves the database by accident — a
     * plain `User.find()` cannot leak it into an API response.
     */
    passwordHash: { type: String, required: true, select: false },

    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },

    /** Trust signal, moved gradually by the reputation service. */
    reputation: {
      score: { type: Number, default: 50, min: 0, max: 100 },
      totalReports: { type: Number, default: 0 },
      verifiedReports: { type: Number, default: 0 },
      rejectedReports: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

// Admin user listing is filtered by role and sorted newest-first.
userSchema.index({ role: 1, createdAt: -1 });

/** Shape returned to clients — never includes the hash. */
userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    active: this.active,
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt,
  };
};

module.exports = mongoose.model('User', userSchema);
