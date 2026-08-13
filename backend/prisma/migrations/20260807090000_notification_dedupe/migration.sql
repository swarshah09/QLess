-- Idempotency for notification delivery.
--
-- The key is derived from the rule plus the transition that fired it, so
-- re-processing the same StationStatus change is a no-op: the second insert
-- violates this constraint and is swallowed rather than producing a duplicate
-- push. Existing rows get a unique backfill from their primary key.
ALTER TABLE "notification_events" ADD COLUMN "dedupeKey" VARCHAR(200);
UPDATE "notification_events" SET "dedupeKey" = 'legacy:' || "id"::text WHERE "dedupeKey" IS NULL;
ALTER TABLE "notification_events" ALTER COLUMN "dedupeKey" SET NOT NULL;

CREATE UNIQUE INDEX "notification_events_dedupeKey_key" ON "notification_events"("dedupeKey");
CREATE INDEX "notification_events_ruleId_createdAt_idx" ON "notification_events"("ruleId", "createdAt");
