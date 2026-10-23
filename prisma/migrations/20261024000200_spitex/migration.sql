-- CreateEnum
CREATE TYPE "HomeCareVisitStatus" AS ENUM ('planned', 'started', 'done', 'missed', 'cancelled');

-- AlterTable
ALTER TABLE "Resident" ADD COLUMN     "accessNote" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "street" TEXT;

-- CreateTable
CREATE TABLE "HomeCareVisit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "templateId" TEXT,
    "date" DATE NOT NULL,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3) NOT NULL,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "status" "HomeCareVisitStatus" NOT NULL DEFAULT 'planned',
    "note" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "observationId" TEXT,
    "startedById" TEXT,
    "doneById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeCareVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeCareService" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "klv" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "plannedMin" INTEGER NOT NULL,
    "actualMin" INTEGER,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HomeCareService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeCareTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "services" JSONB NOT NULL DEFAULT '[]',
    "preferredUserId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeCareTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeCareGeneration" (
    "unitId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeCareGeneration_pkey" PRIMARY KEY ("unitId","day")
);

-- CreateIndex
CREATE INDEX "HomeCareVisit_unitId_date_idx" ON "HomeCareVisit"("unitId", "date");

-- CreateIndex
CREATE INDEX "HomeCareVisit_assigneeId_date_idx" ON "HomeCareVisit"("assigneeId", "date");

-- CreateIndex
CREATE INDEX "HomeCareVisit_residentId_date_idx" ON "HomeCareVisit"("residentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HomeCareVisit_templateId_date_key" ON "HomeCareVisit"("templateId", "date");

-- CreateIndex
CREATE INDEX "HomeCareService_visitId_idx" ON "HomeCareService"("visitId");

-- CreateIndex
CREATE INDEX "HomeCareTemplate_orgId_active_idx" ON "HomeCareTemplate"("orgId", "active");

-- CreateIndex
CREATE INDEX "HomeCareTemplate_residentId_idx" ON "HomeCareTemplate"("residentId");

-- AddForeignKey
ALTER TABLE "HomeCareVisit" ADD CONSTRAINT "HomeCareVisit_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeCareService" ADD CONSTRAINT "HomeCareService_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "HomeCareVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeCareTemplate" ADD CONSTRAINT "HomeCareTemplate_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Daten: neue Spitex-Rechte in bestehenden Systemrollen (entspricht DEFAULT_ROLES) ──
-- Das Modul «spitex» bleibt für bestehende Organisationen aus (nicht im Standard von Organization.modules);
-- die Rechte wirken erst, wenn die Organisation es unter Admin → Klinische Konfiguration → Module einschaltet.
UPDATE "Role" SET "permissions" = "permissions" || ARRAY(SELECT unnest(ARRAY['spitex.read', 'spitex.document']) EXCEPT SELECT unnest("permissions"))
 WHERE "system" AND "key" IN ('care_assistant', 'nurse', 'specialist');
UPDATE "Role" SET "permissions" = "permissions" || ARRAY(SELECT unnest(ARRAY['spitex.read', 'spitex.plan', 'spitex.document']) EXCEPT SELECT unnest("permissions"))
 WHERE "system" AND "key" IN ('ward_lead', 'nursing_director');

