-- AlterEnum
ALTER TYPE "ObservationCategory" ADD VALUE 'therapy';

-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "personal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "therapyPlanId" TEXT;

-- AlterTable
ALTER TABLE "CareEpisode" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "expectedEnd" TIMESTAMP(3),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'stay',
ADD COLUMN     "unitId" TEXT;

-- AlterTable
ALTER TABLE "Medication" ADD COLUMN     "atc" TEXT,
ADD COLUMN     "confirmDueAt" TIMESTAMP(3),
ADD COLUMN     "confirmEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "gtin" TEXT,
ADD COLUMN     "orderSource" TEXT NOT NULL DEFAULT 'written',
ADD COLUMN     "orderedById" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "modules" TEXT[] DEFAULT ARRAY['schedule', 'chat', 'docs', 'learn', 'medication', 'visit', 'therapy', 'dictation', 'quality', 'insights', 'ai', 'portals']::TEXT[],
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- AlterTable
ALTER TABLE "ResidentFile" ADD COLUMN     "portalShared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portalSharedAt" TIMESTAMP(3),
ADD COLUMN     "portalSharedById" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "autoClosed" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'staff',
ADD COLUMN     "platformRole" TEXT;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "physicianId" TEXT;

-- CreateTable
CREATE TABLE "TaskGeneration" (
    "unitId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskGeneration_pkey" PRIMARY KEY ("unitId","day")
);

-- CreateTable
CREATE TABLE "ResidentPhysician" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "until" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResidentPhysician_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapyPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "perWeek" INTEGER NOT NULL DEFAULT 1,
    "sessionMin" INTEGER NOT NULL DEFAULT 30,
    "orderId" TEXT,
    "therapistId" TEXT,
    "careInstructions" TEXT,
    "careTemplateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" DATE,
    "reviewAt" DATE,
    "outcome" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TherapyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationStockEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT,
    "orderId" TEXT,
    "batch" TEXT,
    "expiry" DATE,
    "note" TEXT,
    "stockAfter" INTEGER,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationStockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'de',
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mfaPassed" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAccess" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'relative',
    "grants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inviteEmail" TEXT NOT NULL,
    "inviteName" TEXT NOT NULL,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "consentBy" TEXT NOT NULL,
    "consentName" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consentNote" TEXT,
    "consentById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalThread" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "accessId" TEXT,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigneeId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staffReadAt" TIMESTAMP(3),
    "familyReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "accountId" TEXT,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "observationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalUpdate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "unitId" TEXT,
    "residentId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "fileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authorId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "accessId" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "visitors" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "assigneeId" TEXT,
    "reply" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "appointmentId" TEXT,
    "staffReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyAccess" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "sessionId" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EmergencyAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResidentPhysician_userId_idx" ON "ResidentPhysician"("userId");

-- CreateIndex
CREATE INDEX "ResidentPhysician_orgId_idx" ON "ResidentPhysician"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ResidentPhysician_residentId_userId_key" ON "ResidentPhysician"("residentId", "userId");

-- CreateIndex
CREATE INDEX "TherapyPlan_orgId_unitId_status_idx" ON "TherapyPlan"("orgId", "unitId", "status");

-- CreateIndex
CREATE INDEX "TherapyPlan_residentId_idx" ON "TherapyPlan"("residentId");

-- CreateIndex
CREATE INDEX "MedicationStockEntry_orgId_unitId_kind_status_idx" ON "MedicationStockEntry"("orgId", "unitId", "kind", "status");

-- CreateIndex
CREATE INDEX "MedicationStockEntry_medicationId_at_idx" ON "MedicationStockEntry"("medicationId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccount_orgId_email_key" ON "PortalAccount"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSession_tokenHash_key" ON "PortalSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalSession_accountId_idx" ON "PortalSession"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccess_inviteTokenHash_key" ON "PortalAccess"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "PortalAccess_orgId_residentId_idx" ON "PortalAccess"("orgId", "residentId");

-- CreateIndex
CREATE INDEX "PortalAccess_accountId_idx" ON "PortalAccess"("accountId");

-- CreateIndex
CREATE INDEX "PortalThread_orgId_status_lastMessageAt_idx" ON "PortalThread"("orgId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "PortalThread_residentId_idx" ON "PortalThread"("residentId");

-- CreateIndex
CREATE INDEX "PortalMessage_threadId_createdAt_idx" ON "PortalMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "PortalUpdate_orgId_publishedAt_idx" ON "PortalUpdate"("orgId", "publishedAt");

-- CreateIndex
CREATE INDEX "VisitRequest_orgId_status_start_idx" ON "VisitRequest"("orgId", "status", "start");

-- CreateIndex
CREATE INDEX "VisitRequest_residentId_idx" ON "VisitRequest"("residentId");

-- CreateIndex
CREATE INDEX "EmergencyAccess_orgId_startedAt_idx" ON "EmergencyAccess"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "EmergencyAccess_userId_expiresAt_idx" ON "EmergencyAccess"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "ApiToken_createdById_idx" ON "ApiToken"("createdById");

-- CreateIndex
CREATE INDEX "CareEpisode_residentId_end_idx" ON "CareEpisode"("residentId", "end");

-- AddForeignKey
ALTER TABLE "ResidentPhysician" ADD CONSTRAINT "ResidentPhysician_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentPhysician" ADD CONSTRAINT "ResidentPhysician_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapyPlan" ADD CONSTRAINT "TherapyPlan_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationStockEntry" ADD CONSTRAINT "MedicationStockEntry_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccount" ADD CONSTRAINT "PortalAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PortalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccess" ADD CONSTRAINT "PortalAccess_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccess" ADD CONSTRAINT "PortalAccess_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PortalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccess" ADD CONSTRAINT "PortalAccess_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalThread" ADD CONSTRAINT "PortalThread_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalThread" ADD CONSTRAINT "PortalThread_accessId_fkey" FOREIGN KEY ("accessId") REFERENCES "PortalAccess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalMessage" ADD CONSTRAINT "PortalMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "PortalThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalUpdate" ADD CONSTRAINT "PortalUpdate_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRequest" ADD CONSTRAINT "VisitRequest_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRequest" ADD CONSTRAINT "VisitRequest_accessId_fkey" FOREIGN KEY ("accessId") REFERENCES "PortalAccess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

