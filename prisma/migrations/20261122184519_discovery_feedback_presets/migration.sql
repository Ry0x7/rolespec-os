-- admin_audit_logs and license_activation are intentionally preserved.
-- They are no longer modelled by Prisma, but existing installs hold historical
-- audit and activation records there; dropping them would lose that data.

-- CreateEnum
CREATE TYPE "JobFeedbackVerdict" AS ENUM ('INTERESTED', 'IRRELEVANT', 'APPLIED', 'REJECTED', 'INTERVIEWED', 'OFFERED');

-- CreateEnum
CREATE TYPE "SearchAlertFrequency" AS ENUM ('OFF', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "CareerTargetRoleSource" AS ENUM ('USER', 'CAREER_PATH', 'INTAKE');

-- AlterTable
ALTER TABLE "career_target_roles" ADD COLUMN     "discoveryEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "source" "CareerTargetRoleSource" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "job_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postingKey" TEXT NOT NULL,
    "jobId" TEXT,
    "title" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "url" TEXT,
    "verdict" "JobFeedbackVerdict" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_search_presets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeCareerPathRoles" BOOLEAN NOT NULL DEFAULT false,
    "alertFrequency" "SearchAlertFrequency" NOT NULL DEFAULT 'OFF',
    "lastRunAt" TIMESTAMP(3),
    "lastRunCount" INTEGER,
    "lastAlertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_search_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_feedback_userId_verdict_updatedAt_idx" ON "job_feedback"("userId", "verdict", "updatedAt");

-- CreateIndex
CREATE INDEX "job_feedback_userId_jobId_idx" ON "job_feedback"("userId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "job_feedback_userId_postingKey_key" ON "job_feedback"("userId", "postingKey");

-- CreateIndex
CREATE INDEX "discovery_search_presets_userId_alertFrequency_idx" ON "discovery_search_presets"("userId", "alertFrequency");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_search_presets_userId_name_key" ON "discovery_search_presets"("userId", "name");

-- CreateIndex
CREATE INDEX "career_target_roles_careerProfileId_discoveryEnabled_idx" ON "career_target_roles"("careerProfileId", "discoveryEnabled");

-- AddForeignKey
ALTER TABLE "job_feedback" ADD CONSTRAINT "job_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_search_presets" ADD CONSTRAINT "discovery_search_presets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
