-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'STATION_OPERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('AVAILABLE', 'LOW_SUPPLY', 'TEMPORARILY_INTERRUPTED', 'UNAVAILABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ReportSource" AS ENUM ('OPERATOR', 'VERIFIED_NEARBY_USER', 'NORMAL_USER', 'ADMIN', 'SYSTEM_ESTIMATE');

-- CreateEnum
CREATE TYPE "QueueBucket" AS ENUM ('RANGE_0_3', 'RANGE_4_7', 'RANGE_8_15', 'RANGE_16_25', 'RANGE_25_PLUS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PressureUnit" AS ENUM ('BAR', 'PSI', 'KPA');

-- CreateEnum
CREATE TYPE "PressureStatus" AS ENUM ('NORMAL', 'LOW', 'CRITICAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Freshness" AS ENUM ('LIVE', 'RECENT', 'STALE', 'EXPIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SupplyEventType" AS ENUM ('REFILL_RECEIVED', 'SUPPLY_INTERRUPTED', 'SUPPLY_RESTORED', 'MAINTENANCE_START', 'MAINTENANCE_END', 'STATION_CLOSED', 'STATION_REOPENED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WEB_PUSH', 'IN_APP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationEventStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "RuleConditionState" AS ENUM ('UNMET', 'MET', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "StationOperatorRole" AS ENUM ('MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "MetricInterval" AS ENUM ('HOURLY', 'DAILY');

-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('UNKNOWN', 'REFUELLED', 'ABANDONED_QUEUE', 'STATION_UNAVAILABLE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "passwordHash" VARCHAR(255),
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporter_reputations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 50,
    "totalReports" INTEGER NOT NULL DEFAULT 0,
    "verifiedReports" INTEGER NOT NULL DEFAULT 0,
    "rejectedReports" INTEGER NOT NULL DEFAULT 0,
    "lastReportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reporter_reputations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "address" VARCHAR(400) NOT NULL,
    "city" VARCHAR(120),
    "state" VARCHAR(120),
    "pincode" VARCHAR(12),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "operatingHours" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "numberOfDispensers" INTEGER NOT NULL DEFAULT 1,
    "pressureThresholdLow" DOUBLE PRECISION,
    "pressureThresholdNormal" DOUBLE PRECISION,
    "defaultPressureUnit" "PressureUnit" NOT NULL DEFAULT 'BAR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_operators" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "role" "StationOperatorRole" NOT NULL DEFAULT 'STAFF',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_statuses" (
    "id" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "availability" "Availability" NOT NULL DEFAULT 'UNKNOWN',
    "queueMin" INTEGER,
    "queueMax" INTEGER,
    "queueBucket" "QueueBucket" NOT NULL DEFAULT 'UNKNOWN',
    "waitMin" INTEGER,
    "waitMax" INTEGER,
    "pressureValue" DOUBLE PRECISION,
    "pressureUnit" "PressureUnit" NOT NULL DEFAULT 'BAR',
    "pressureStatus" "PressureStatus" NOT NULL DEFAULT 'UNKNOWN',
    "activeDispensers" INTEGER,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "freshness" "Freshness" NOT NULL DEFAULT 'UNKNOWN',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOperatorUpdateAt" TIMESTAMP(3),
    "lastUserUpdateAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_reports" (
    "id" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "userId" UUID,
    "queueMin" INTEGER,
    "queueMax" INTEGER,
    "queueBucket" "QueueBucket" NOT NULL DEFAULT 'UNKNOWN',
    "source" "ReportSource" NOT NULL,
    "locationVerified" BOOLEAN NOT NULL DEFAULT false,
    "reportedLatitude" DOUBLE PRECISION,
    "reportedLongitude" DOUBLE PRECISION,
    "distanceToStationM" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_reports" (
    "id" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "userId" UUID,
    "availability" "Availability" NOT NULL,
    "source" "ReportSource" NOT NULL,
    "note" VARCHAR(500),
    "locationVerified" BOOLEAN NOT NULL DEFAULT false,
    "reportedLatitude" DOUBLE PRECISION,
    "reportedLongitude" DOUBLE PRECISION,
    "distanceToStationM" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pressure_reports" (
    "id" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "userId" UUID,
    "pressureValue" DOUBLE PRECISION NOT NULL,
    "pressureUnit" "PressureUnit" NOT NULL DEFAULT 'BAR',
    "source" "ReportSource" NOT NULL,
    "locationVerified" BOOLEAN NOT NULL DEFAULT false,
    "reportedLatitude" DOUBLE PRECISION,
    "reportedLongitude" DOUBLE PRECISION,
    "distanceToStationM" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pressure_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_events" (
    "id" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "reportedByUserId" UUID,
    "type" "SupplyEventType" NOT NULL,
    "source" "ReportSource" NOT NULL,
    "note" VARCHAR(500),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_visits" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "locationVerified" BOOLEAN NOT NULL DEFAULT false,
    "arrivedAt" TIMESTAMP(3),
    "joinedQueueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "outcome" "VisitOutcome" NOT NULL DEFAULT 'UNKNOWN',
    "observedWaitMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_stations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "label" VARCHAR(80),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rules" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "requiredAvailability" "Availability"[] DEFAULT ARRAY[]::"Availability"[],
    "maxQueue" INTEGER,
    "maxWaitMinutes" INTEGER,
    "minPressure" DOUBLE PRECISION,
    "pressureUnit" "PressureUnit" NOT NULL DEFAULT 'BAR',
    "channel" "NotificationChannel" NOT NULL DEFAULT 'WEB_PUSH',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "currentConditionState" "RuleConditionState" NOT NULL DEFAULT 'UNKNOWN',
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastTriggeredAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" VARCHAR(1000) NOT NULL,
    "p256dh" VARCHAR(255) NOT NULL,
    "auth" VARCHAR(255) NOT NULL,
    "userAgent" VARCHAR(400),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ruleId" UUID,
    "stationId" UUID,
    "subscriptionId" UUID,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'WEB_PUSH',
    "status" "NotificationEventStatus" NOT NULL DEFAULT 'PENDING',
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "payload" JSONB,
    "triggerSnapshot" JSONB,
    "error" VARCHAR(1000),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_historical_metrics" (
    "id" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "interval" "MetricInterval" NOT NULL DEFAULT 'HOURLY',
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "hourOfDay" INTEGER NOT NULL,
    "avgQueueMin" DOUBLE PRECISION,
    "avgQueueMax" DOUBLE PRECISION,
    "avgWaitMinutes" DOUBLE PRECISION,
    "avgPressure" DOUBLE PRECISION,
    "pressureUnit" "PressureUnit" NOT NULL DEFAULT 'BAR',
    "availabilityRate" DOUBLE PRECISION,
    "dominantAvailability" "Availability" NOT NULL DEFAULT 'UNKNOWN',
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_historical_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "adminUserId" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(64),
    "before" JSONB,
    "after" JSONB,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(400),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reporter_reputations_userId_key" ON "reporter_reputations"("userId");

-- CreateIndex
CREATE INDEX "reporter_reputations_score_idx" ON "reporter_reputations"("score");

-- CreateIndex
CREATE INDEX "stations_active_idx" ON "stations"("active");

-- CreateIndex
CREATE INDEX "stations_latitude_longitude_idx" ON "stations"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "stations_city_idx" ON "stations"("city");

-- CreateIndex
CREATE INDEX "stations_name_idx" ON "stations"("name");

-- CreateIndex
CREATE INDEX "station_operators_stationId_active_idx" ON "station_operators"("stationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "station_operators_userId_stationId_key" ON "station_operators"("userId", "stationId");

-- CreateIndex
CREATE UNIQUE INDEX "station_statuses_stationId_key" ON "station_statuses"("stationId");

-- CreateIndex
CREATE INDEX "station_statuses_availability_idx" ON "station_statuses"("availability");

-- CreateIndex
CREATE INDEX "station_statuses_freshness_idx" ON "station_statuses"("freshness");

-- CreateIndex
CREATE INDEX "station_statuses_computedAt_idx" ON "station_statuses"("computedAt");

-- CreateIndex
CREATE INDEX "queue_reports_stationId_createdAt_idx" ON "queue_reports"("stationId", "createdAt");

-- CreateIndex
CREATE INDEX "queue_reports_userId_createdAt_idx" ON "queue_reports"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "queue_reports_source_idx" ON "queue_reports"("source");

-- CreateIndex
CREATE INDEX "availability_reports_stationId_createdAt_idx" ON "availability_reports"("stationId", "createdAt");

-- CreateIndex
CREATE INDEX "availability_reports_userId_createdAt_idx" ON "availability_reports"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "availability_reports_source_idx" ON "availability_reports"("source");

-- CreateIndex
CREATE INDEX "pressure_reports_stationId_createdAt_idx" ON "pressure_reports"("stationId", "createdAt");

-- CreateIndex
CREATE INDEX "pressure_reports_userId_createdAt_idx" ON "pressure_reports"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "pressure_reports_source_idx" ON "pressure_reports"("source");

-- CreateIndex
CREATE INDEX "supply_events_stationId_startedAt_idx" ON "supply_events"("stationId", "startedAt");

-- CreateIndex
CREATE INDEX "supply_events_type_idx" ON "supply_events"("type");

-- CreateIndex
CREATE INDEX "station_visits_userId_createdAt_idx" ON "station_visits"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "station_visits_stationId_createdAt_idx" ON "station_visits"("stationId", "createdAt");

-- CreateIndex
CREATE INDEX "station_visits_outcome_idx" ON "station_visits"("outcome");

-- CreateIndex
CREATE INDEX "saved_stations_userId_sortOrder_idx" ON "saved_stations"("userId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "saved_stations_userId_stationId_key" ON "saved_stations"("userId", "stationId");

-- CreateIndex
CREATE INDEX "notification_rules_stationId_enabled_idx" ON "notification_rules"("stationId", "enabled");

-- CreateIndex
CREATE INDEX "notification_rules_enabled_currentConditionState_idx" ON "notification_rules"("enabled", "currentConditionState");

-- CreateIndex
CREATE INDEX "notification_rules_cooldownUntil_idx" ON "notification_rules"("cooldownUntil");

-- CreateIndex
CREATE UNIQUE INDEX "notification_rules_userId_stationId_channel_key" ON "notification_rules"("userId", "stationId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_active_idx" ON "push_subscriptions"("userId", "active");

-- CreateIndex
CREATE INDEX "notification_events_userId_createdAt_idx" ON "notification_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_events_status_scheduledAt_idx" ON "notification_events"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "notification_events_stationId_createdAt_idx" ON "notification_events"("stationId", "createdAt");

-- CreateIndex
CREATE INDEX "station_historical_metrics_stationId_dayOfWeek_hourOfDay_idx" ON "station_historical_metrics"("stationId", "dayOfWeek", "hourOfDay");

-- CreateIndex
CREATE UNIQUE INDEX "station_historical_metrics_stationId_interval_bucketStart_key" ON "station_historical_metrics"("stationId", "interval", "bucketStart");

-- CreateIndex
CREATE INDEX "admin_audit_logs_adminUserId_createdAt_idx" ON "admin_audit_logs"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_entityType_entityId_idx" ON "admin_audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_idx" ON "admin_audit_logs"("action");

-- AddForeignKey
ALTER TABLE "reporter_reputations" ADD CONSTRAINT "reporter_reputations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_operators" ADD CONSTRAINT "station_operators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_operators" ADD CONSTRAINT "station_operators_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_statuses" ADD CONSTRAINT "station_statuses_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_reports" ADD CONSTRAINT "queue_reports_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_reports" ADD CONSTRAINT "queue_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_reports" ADD CONSTRAINT "availability_reports_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_reports" ADD CONSTRAINT "availability_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pressure_reports" ADD CONSTRAINT "pressure_reports_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pressure_reports" ADD CONSTRAINT "pressure_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_events" ADD CONSTRAINT "supply_events_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_events" ADD CONSTRAINT "supply_events_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_visits" ADD CONSTRAINT "station_visits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_visits" ADD CONSTRAINT "station_visits_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_stations" ADD CONSTRAINT "saved_stations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_stations" ADD CONSTRAINT "saved_stations_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "notification_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "push_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_historical_metrics" ADD CONSTRAINT "station_historical_metrics_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
