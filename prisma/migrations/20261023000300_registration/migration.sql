-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pendingSince" TIMESTAMP(3),
ADD COLUMN     "registration" JSONB;

