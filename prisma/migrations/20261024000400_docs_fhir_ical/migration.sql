-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "reviewDueAt" TIMESTAMP(3),
ADD COLUMN     "reviewEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "reviewerId" TEXT;

-- AlterTable
ALTER TABLE "ResidentFile" ADD COLUMN     "external" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receivedVia" TEXT,
ADD COLUMN     "reportDate" TIMESTAMP(3),
ADD COLUMN     "reportKind" TEXT;

-- AlterTable
ALTER TABLE "VisitQuestion" ADD COLUMN     "escalatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CalendarToken" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CalendarToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarToken_tokenHash_key" ON "CalendarToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CalendarToken_userId_idx" ON "CalendarToken"("userId");

