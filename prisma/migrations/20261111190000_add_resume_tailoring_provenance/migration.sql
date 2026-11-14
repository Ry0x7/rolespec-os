-- CreateEnum
CREATE TYPE "ResumeTailoringStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResumeValidationStatus" AS ENUM ('PASS', 'NEEDS_REVIEW', 'FAIL');

-- CreateEnum
CREATE TYPE "ResumeEditKind" AS ENUM ('TAILORING_APPLIED', 'MANUAL_EDIT', 'ROLLBACK', 'RESTORE');

-- CreateTable
CREATE TABLE "resume_tailoring_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resumeId" TEXT,
    "sourceResumeId" TEXT NOT NULL,
    "jobApplicationId" TEXT,
    "status" "ResumeTailoringStatus" NOT NULL DEFAULT 'PENDING',
    "mode" TEXT NOT NULL DEFAULT 'MANUAL',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "sourceVersion" INTEGER NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "requirementMap" JSONB,
    "validation" JSONB,
    "snapshot" JSONB NOT NULL,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resume_tailoring_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_snapshots" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceResumeId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    "restoreCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "resume_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_validations" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tailoringRunId" TEXT,
    "status" "ResumeValidationStatus" NOT NULL,
    "sourceHash" TEXT,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_edit_events" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ResumeEditKind" NOT NULL,
    "versionBefore" INTEGER NOT NULL,
    "versionAfter" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_edit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resume_tailoring_runs_userId_createdAt_idx" ON "resume_tailoring_runs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "resume_tailoring_runs_resumeId_idx" ON "resume_tailoring_runs"("resumeId");

-- CreateIndex
CREATE INDEX "resume_tailoring_runs_sourceResumeId_idx" ON "resume_tailoring_runs"("sourceResumeId");

-- CreateIndex
CREATE INDEX "resume_tailoring_runs_jobApplicationId_idx" ON "resume_tailoring_runs"("jobApplicationId");

-- CreateIndex
CREATE INDEX "resume_snapshots_resumeId_capturedAt_idx" ON "resume_snapshots"("resumeId", "capturedAt");

-- CreateIndex
CREATE INDEX "resume_snapshots_sourceResumeId_idx" ON "resume_snapshots"("sourceResumeId");

-- CreateIndex
CREATE INDEX "resume_validations_resumeId_createdAt_idx" ON "resume_validations"("resumeId", "createdAt");

-- CreateIndex
CREATE INDEX "resume_validations_userId_createdAt_idx" ON "resume_validations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "resume_edit_events_resumeId_createdAt_idx" ON "resume_edit_events"("resumeId", "createdAt");

-- AddForeignKey
ALTER TABLE "resume_tailoring_runs" ADD CONSTRAINT "resume_tailoring_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_tailoring_runs" ADD CONSTRAINT "resume_tailoring_runs_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "resumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_tailoring_runs" ADD CONSTRAINT "resume_tailoring_runs_sourceResumeId_fkey" FOREIGN KEY ("sourceResumeId") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_tailoring_runs" ADD CONSTRAINT "resume_tailoring_runs_jobApplicationId_userId_fkey" FOREIGN KEY ("jobApplicationId", "userId") REFERENCES "job_applications"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_snapshots" ADD CONSTRAINT "resume_snapshots_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_snapshots" ADD CONSTRAINT "resume_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_validations" ADD CONSTRAINT "resume_validations_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_validations" ADD CONSTRAINT "resume_validations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_validations" ADD CONSTRAINT "resume_validations_tailoringRunId_fkey" FOREIGN KEY ("tailoringRunId") REFERENCES "resume_tailoring_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_edit_events" ADD CONSTRAINT "resume_edit_events_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_edit_events" ADD CONSTRAINT "resume_edit_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
