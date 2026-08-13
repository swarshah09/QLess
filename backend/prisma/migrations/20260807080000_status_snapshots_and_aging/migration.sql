-- AGING sits between RECENT and STALE. Added with ADD VALUE so existing rows
-- keep their current freshness rather than needing a type rewrite.
ALTER TYPE "Freshness" ADD VALUE IF NOT EXISTS 'AGING' AFTER 'RECENT';

-- Append-only history of what the platform actually told drivers. StationStatus
-- is overwritten on every recomputation; without this there is no record.
CREATE TABLE "station_status_snapshots" (
    "id" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "availability" "Availability" NOT NULL,
    "queueMin" INTEGER,
    "queueMax" INTEGER,
    "queueBucket" "QueueBucket" NOT NULL DEFAULT 'UNKNOWN',
    "waitMin" INTEGER,
    "waitMax" INTEGER,
    "pressureValue" DOUBLE PRECISION,
    "pressureUnit" "PressureUnit" NOT NULL DEFAULT 'BAR',
    "pressureStatus" "PressureStatus" NOT NULL DEFAULT 'UNKNOWN',
    "activeDispensers" INTEGER,
    "confidence" INTEGER NOT NULL,
    "freshness" "Freshness" NOT NULL,
    "queueSampleCount" INTEGER NOT NULL DEFAULT 0,
    "availabilitySampleCount" INTEGER NOT NULL DEFAULT 0,
    "pressureSampleCount" INTEGER NOT NULL DEFAULT 0,
    "outlierCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "station_status_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "station_status_snapshots_stationId_computedAt_idx"
    ON "station_status_snapshots"("stationId", "computedAt");

ALTER TABLE "station_status_snapshots"
    ADD CONSTRAINT "station_status_snapshots_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
