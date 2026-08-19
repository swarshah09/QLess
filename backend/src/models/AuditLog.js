'use strict';

const mongoose = require('mongoose');

/** Sensitive admin actions. Manual overrides must record WHO, WHY and WHEN. */
const auditLogSchema = new mongoose.Schema(
  {
    adminUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true, maxlength: 120 },
    entityType: { type: String, required: true, maxlength: 80 },
    entityId: { type: String, maxlength: 64, default: null },
    /** Required for overrides — an unreasoned action is not auditable later. */
    reason: { type: String, maxlength: 500, default: null },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    ipAddress: { type: String, maxlength: 64, default: null },
    userAgent: { type: String, maxlength: 400, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
