-- CreateEnum
CREATE TYPE "TaskRhythm" AS ENUM ('daily', 'weekly', 'monthly');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "supersedesId" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "audienceRoles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "audienceRoles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Resident" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationPrefs" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "phoneShared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "workPhone" TEXT;

-- AlterTable
ALTER TABLE "VitalSign" ADD COLUMN     "extra" JSONB,
ADD COLUMN     "reviewKind" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "supersedesId" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- AlterTable
ALTER TABLE "WoundAssessment" ADD COLUMN     "supersedesId" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "residentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "rhythm" "TaskRhythm" NOT NULL DEFAULT 'daily',
    "every" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[],
    "monthDay" INTEGER,
    "times" TEXT[],
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "durationMin" INTEGER NOT NULL DEFAULT 10,
    "priority" "Priority" NOT NULL DEFAULT 'routine',
    "assigneeId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "shiftCode" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "residentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SecurityAlert" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "userId" TEXT,
    "subject" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "note" TEXT,
    "incidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityIncident" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "risk" TEXT NOT NULL DEFAULT 'medium',
    "dataCategories" TEXT[],
    "affectedCount" INTEGER,
    "measures" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "authorityRequired" BOOLEAN,
    "authorityNotifiedAt" TIMESTAMP(3),
    "subjectsRequired" BOOLEAN,
    "subjectsNotifiedAt" TIMESTAMP(3),
    "reportedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "actorId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "records" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "IntegrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResult" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "integrationId" TEXT,
    "externalId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "numeric" DOUBLE PRECISION,
    "unit" TEXT,
    "refRange" TEXT,
    "flag" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "LabResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "rating" INTEGER,
    "text" TEXT,
    "path" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "routeType" TEXT NOT NULL,
    "method" TEXT,
    "digest" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskTemplate_unitId_active_idx" ON "TaskTemplate"("unitId", "active");

-- CreateIndex
CREATE INDEX "ShiftAssignment_unitId_date_shiftCode_idx" ON "ShiftAssignment"("unitId", "date", "shiftCode");

-- CreateIndex
CREATE INDEX "ShiftAssignment_userId_date_idx" ON "ShiftAssignment"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_unitId_shiftCode_date_residentId_userId_key" ON "ShiftAssignment"("unitId", "shiftCode", "date", "residentId", "userId");

-- CreateIndex
CREATE INDEX "RateLimit_resetAt_idx" ON "RateLimit"("resetAt");

-- CreateIndex
CREATE INDEX "SecurityAlert_orgId_status_createdAt_idx" ON "SecurityAlert"("orgId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAlert_orgId_rule_subject_windowStart_key" ON "SecurityAlert"("orgId", "rule", "subject", "windowStart");

-- CreateIndex
CREATE INDEX "SecurityIncident_orgId_status_idx" ON "SecurityIncident"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityIncident_orgId_number_key" ON "SecurityIncident"("orgId", "number");

-- CreateIndex
CREATE INDEX "IntegrationRun_integrationId_startedAt_idx" ON "IntegrationRun"("integrationId", "startedAt");

-- CreateIndex
CREATE INDEX "IntegrationRun_orgId_startedAt_idx" ON "IntegrationRun"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "LabResult_residentId_collectedAt_idx" ON "LabResult"("residentId", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LabResult_orgId_integrationId_externalId_key" ON "LabResult"("orgId", "integrationId", "externalId");

-- CreateIndex
CREATE INDEX "Feedback_orgId_createdAt_idx" ON "Feedback"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorEvent_lastAt_idx" ON "ErrorEvent"("lastAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorEvent_day_fingerprint_key" ON "ErrorEvent"("day", "fingerprint");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "Observation_supersedesId_idx" ON "Observation"("supersedesId");

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

