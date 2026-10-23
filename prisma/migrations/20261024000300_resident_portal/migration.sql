-- AlterTable
ALTER TABLE "PortalAccount" ADD COLUMN     "textSize" TEXT;

-- AlterTable
ALTER TABLE "PortalUpdate" ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'family';

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "VisitRequest" ADD COLUMN     "visitorName" TEXT;

