-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('MANUAL', 'EXTENSION', 'DISCOVERY');

-- AlterTable
ALTER TABLE "job_applications" ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "discoveredAt" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "source" "JobSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "sourceProvider" TEXT;

-- CreateIndex
CREATE INDEX "job_applications_userId_canonicalUrl_idx" ON "job_applications"("userId", "canonicalUrl");
