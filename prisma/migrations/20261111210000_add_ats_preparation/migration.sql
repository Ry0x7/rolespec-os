-- AlterEnum: ATS review questions get their own kinds so the review surface can
-- say what it is asking without borrowing a workflow failure label.
ALTER TYPE "ReviewTaskKind" ADD VALUE IF NOT EXISTS 'ESSAY_ANSWER';
ALTER TYPE "ReviewTaskKind" ADD VALUE IF NOT EXISTS 'RESUME_ATTACHMENT';
ALTER TYPE "ReviewTaskKind" ADD VALUE IF NOT EXISTS 'CONFLICTING_ANSWER';
ALTER TYPE "ReviewTaskKind" ADD VALUE IF NOT EXISTS 'UNSUPPORTED_FIELD';

-- CreateEnum
CREATE TYPE "AtsPreparationStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'READY_TO_SUBMIT', 'SUBMITTED', 'NOT_SUBMITTED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "AtsAnswerScope" AS ENUM ('APPLICATION', 'GLOBAL');

-- CreateEnum
CREATE TYPE "AtsAnswerSource" AS ENUM ('USER_APPROVED', 'PROFILE_ACCEPTED', 'CARRIED_FORWARD');

-- CreateTable
CREATE TABLE "ats_preparations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobApplicationId" TEXT,
    "workflowRunId" TEXT,
    "vendor" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "preparationKey" TEXT NOT NULL,
    "pageTitle" TEXT,
    "jobTitle" TEXT,
    "companyName" TEXT,
    "status" "AtsPreparationStatus" NOT NULL DEFAULT 'DRAFT',
    "resumeId" TEXT,
    "resumeTitle" TEXT,
    "plan" JSONB,
    "results" JSONB,
    "reviewTaskIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fieldsDetected" INTEGER NOT NULL DEFAULT 0,
    "fieldsFilled" INTEGER NOT NULL DEFAULT 0,
    "fieldsBlocked" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "filledAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "submissionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ats_preparations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ats_answers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preparationId" TEXT,
    "questionKey" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "scope" "AtsAnswerScope" NOT NULL DEFAULT 'APPLICATION',
    "source" "AtsAnswerSource" NOT NULL DEFAULT 'USER_APPROVED',
    "dedupeKey" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ats_answers_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "review_tasks" ADD COLUMN "atsPreparationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ats_preparations_userId_preparationKey_key" ON "ats_preparations"("userId", "preparationKey");

-- CreateIndex
CREATE INDEX "ats_preparations_userId_updatedAt_idx" ON "ats_preparations"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ats_preparations_jobApplicationId_userId_idx" ON "ats_preparations"("jobApplicationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ats_answers_userId_dedupeKey_key" ON "ats_answers"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ats_answers_userId_questionKey_idx" ON "ats_answers"("userId", "questionKey");

-- CreateIndex
CREATE INDEX "ats_answers_preparationId_revokedAt_idx" ON "ats_answers"("preparationId", "revokedAt");

-- CreateIndex
CREATE INDEX "review_tasks_atsPreparationId_status_idx" ON "review_tasks"("atsPreparationId", "status");

-- AddForeignKey
ALTER TABLE "ats_preparations" ADD CONSTRAINT "ats_preparations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ats_preparations" ADD CONSTRAINT "ats_preparations_jobApplicationId_userId_fkey" FOREIGN KEY ("jobApplicationId", "userId") REFERENCES "job_applications"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ats_answers" ADD CONSTRAINT "ats_answers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ats_answers" ADD CONSTRAINT "ats_answers_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "ats_preparations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_atsPreparationId_fkey" FOREIGN KEY ("atsPreparationId") REFERENCES "ats_preparations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
