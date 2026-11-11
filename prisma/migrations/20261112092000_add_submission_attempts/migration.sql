CREATE TYPE "SubmissionSource" AS ENUM ('WORKFLOW', 'EXTENSION', 'MANUAL');
CREATE TYPE "SubmissionAttemptStatus" AS ENUM ('STAGED', 'SUBMITTED', 'NOT_SUBMITTED', 'ABANDONED');

CREATE TABLE "submission_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobApplicationId" TEXT,
    "workflowRunId" TEXT,
    "atsPreparationId" TEXT,
    "resumeId" TEXT,
    "source" "SubmissionSource" NOT NULL DEFAULT 'WORKFLOW',
    "status" "SubmissionAttemptStatus" NOT NULL DEFAULT 'STAGED',
    "jobTitle" TEXT,
    "companyName" TEXT,
    "sourceUrl" TEXT,
    "evidence" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "confirmationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "submission_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "submission_attempts_workflowRunId_key" ON "submission_attempts"("workflowRunId");
CREATE UNIQUE INDEX "submission_attempts_atsPreparationId_key" ON "submission_attempts"("atsPreparationId");
CREATE INDEX "submission_attempts_userId_status_idx" ON "submission_attempts"("userId", "status");
CREATE INDEX "submission_attempts_jobApplicationId_createdAt_idx" ON "submission_attempts"("jobApplicationId", "createdAt");

ALTER TABLE "submission_attempts"
  ADD CONSTRAINT "submission_attempts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "submission_attempts"
  ADD CONSTRAINT "submission_attempts_jobApplicationId_userId_fkey"
  FOREIGN KEY ("jobApplicationId", "userId") REFERENCES "job_applications"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "submission_attempts"
  ADD CONSTRAINT "submission_attempts_workflowRunId_fkey"
  FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "submission_attempts"
  ADD CONSTRAINT "submission_attempts_atsPreparationId_fkey"
  FOREIGN KEY ("atsPreparationId") REFERENCES "ats_preparations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
