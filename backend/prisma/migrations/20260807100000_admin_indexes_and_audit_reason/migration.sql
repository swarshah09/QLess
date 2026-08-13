-- Manual admin overrides must record WHY. Nullable because most audited
-- actions are self-explanatory; the service requires it for overrides.
ALTER TABLE "admin_audit_logs" ADD COLUMN "reason" VARCHAR(500);

-- Nearby discovery filters active + lat/lng bounding box in one query.
CREATE INDEX "stations_active_latitude_longitude_idx"
    ON "stations"("active", "latitude", "longitude");

-- "Which stations may this operator act on?" — the authorization hot path.
CREATE INDEX "station_operators_userId_active_idx"
    ON "station_operators"("userId", "active");

-- Suspicious-report review scans by source over a recent window.
CREATE INDEX "queue_reports_source_createdAt_idx" ON "queue_reports"("source", "createdAt");
CREATE INDEX "availability_reports_source_createdAt_idx" ON "availability_reports"("source", "createdAt");
CREATE INDEX "pressure_reports_source_createdAt_idx" ON "pressure_reports"("source", "createdAt");

-- Audit log listing is newest-first across all admins.
CREATE INDEX "admin_audit_logs_createdAt_idx" ON "admin_audit_logs"("createdAt");
