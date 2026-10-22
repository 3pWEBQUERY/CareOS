-- CreateEnum
CREATE TYPE "VisitQuestionStatus" AS ENUM ('open', 'answered', 'withdrawn');

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "physician" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "observationId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitQuestion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "refLabel" TEXT,
    "status" "VisitQuestionStatus" NOT NULL DEFAULT 'open',
    "answer" TEXT,
    "visitId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "VisitQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitOrder" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "questionId" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visit_orgId_unitId_at_idx" ON "Visit"("orgId", "unitId", "at");

-- CreateIndex
CREATE INDEX "Visit_residentId_at_idx" ON "Visit"("residentId", "at");

-- CreateIndex
CREATE INDEX "VisitQuestion_orgId_status_idx" ON "VisitQuestion"("orgId", "status");

-- CreateIndex
CREATE INDEX "VisitQuestion_residentId_status_idx" ON "VisitQuestion"("residentId", "status");

-- CreateIndex
CREATE INDEX "VisitOrder_visitId_idx" ON "VisitOrder"("visitId");

-- CreateIndex
CREATE INDEX "VisitOrder_residentId_idx" ON "VisitOrder"("residentId");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitQuestion" ADD CONSTRAINT "VisitQuestion_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitQuestion" ADD CONSTRAINT "VisitQuestion_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitOrder" ADD CONSTRAINT "VisitOrder_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Neue Berechtigung für bestehende Systemrollen
UPDATE "Role" SET "permissions" = array_append("permissions", 'resident.visit.conduct')
WHERE "system" AND "key" IN ('nurse', 'specialist', 'ward_lead', 'nursing_director', 'physician', 'sysadmin')
  AND NOT ('resident.visit.conduct' = ANY("permissions"));
