-- CreateEnum
CREATE TYPE "WorkflowKind" AS ENUM ('APPLICATION', 'DISCOVERY', 'RESEARCH', 'TAILOR', 'AUTOFILL', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "WorkflowMode" AS ENUM ('MANUAL', 'AGENT_ASSISTED');

-- CreateEnum
CREATE TYPE "WorkflowState" AS ENUM ('MANUAL', 'ASSISTED', 'AWAITING_REVIEW', 'PAUSED', 'FAILED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowStepStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_FOR_USER', 'COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WorkflowEventType" AS ENUM ('RUN_CREATED', 'RUN_STARTED', 'STEP_STARTED', 'STEP_COMPLETED', 'STEP_FAILED', 'STEP_SKIPPED', 'STEP_WAITING_FOR_USER', 'REVIEW_REQUESTED', 'REVIEW_RESOLVED', 'RUN_PAUSED', 'RUN_RESUMED', 'RUN_CANCELLED', 'RUN_COMPLETED', 'LEASE_RECLAIMED', 'RETRY_SCHEDULED');

-- CreateEnum
CREATE TYPE "ReviewTaskStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReviewTaskKind" AS ENUM ('SENSITIVE_ANSWER', 'UNKNOWN_FIELD', 'MISSING_PROFILE_FACT', 'RESTRICTED_ACCESS', 'AMBIGUOUS_TAILORING', 'SUBMISSION_CONFIRMATION');

-- CreateEnum

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobApplicationId" TEXT,
    "kind" "WorkflowKind" NOT NULL DEFAULT 'APPLICATION',
    "mode" "WorkflowMode" NOT NULL DEFAULT 'AGENT_ASSISTED',
    "state" "WorkflowState" NOT NULL DEFAULT 'MANUAL',
    "input" JSONB,
    "idempotencyKey" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "WorkflowStepStatus" NOT NULL DEFAULT 'PENDING',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "dependsOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "idempotencyKey" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_events" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT,
    "type" "WorkflowEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "stepId" TEXT,
    "jobApplicationId" TEXT,
    "kind" "ReviewTaskKind" NOT NULL,
    "status" "ReviewTaskStatus" NOT NULL DEFAULT 'OPEN',
    "question" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "category" TEXT,
    "fallback" TEXT,
    "suggestedValue" JSONB,
    "answer" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_runs_userId_createdAt_idx" ON "workflow_runs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_runs_state_leaseExpiresAt_idx" ON "workflow_runs"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_userId_idempotencyKey_key" ON "workflow_runs"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "workflow_steps_runId_status_idx" ON "workflow_steps"("runId", "status");

-- CreateIndex
CREATE INDEX "workflow_steps_status_nextAttemptAt_idx" ON "workflow_steps"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_runId_name_key" ON "workflow_steps"("runId", "name");

-- CreateIndex
CREATE INDEX "workflow_events_runId_createdAt_idx" ON "workflow_events"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "review_tasks_userId_status_idx" ON "review_tasks"("userId", "status");

-- CreateIndex
CREATE INDEX "review_tasks_runId_status_idx" ON "review_tasks"("runId", "status");

ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_jobApplicationId_userId_fkey" FOREIGN KEY ("jobApplicationId", "userId") REFERENCES "job_applications"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "workflow_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_runId_fkey" FOREIGN KEY ("runId") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_jobApplicationId_userId_fkey" FOREIGN KEY ("jobApplicationId", "userId") REFERENCES "job_applications"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

