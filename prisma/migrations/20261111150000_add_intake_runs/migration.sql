-- Unified candidate intake: six sources feed one review queue of validated
-- patches. Applied changes remain candidate profile facts until the user
-- confirms them through the existing career-profile actions.

-- The intake provenance value must be committed before any row can use it.
ALTER TYPE "CareerEvidenceSource" ADD VALUE IF NOT EXISTS 'INTAKE_IMPORT_CANDIDATE';

-- CreateEnum
CREATE TYPE "IntakeSource" AS ENUM ('RESUME', 'GITHUB', 'LINKEDIN', 'WEB', 'CHAT', 'VOICE');

-- CreateEnum
CREATE TYPE "IntakeRunStatus" AS ENUM ('PENDING', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IntakeSourceStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "IntakePatchKind" AS ENUM ('CONTACT', 'EVIDENCE', 'SKILL', 'TARGET_ROLE');

-- CreateEnum
CREATE TYPE "IntakePatchStatus" AS ENUM ('PENDING', 'APPLIED', 'CONFLICT', 'REJECTED');

-- CreateEnum
CREATE TYPE "IntakeConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "IntakeConflictResolution" AS ENUM ('KEEP_EXISTING', 'ACCEPT_INCOMING', 'KEEP_BOTH');

CREATE TABLE "intake_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "IntakeRunStatus" NOT NULL DEFAULT 'PENDING',
    "requestedSources" "IntakeSource"[] DEFAULT ARRAY[]::"IntakeSource"[],
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_source_runs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "source" "IntakeSource" NOT NULL,
    "status" "IntakeSourceStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "input" JSONB,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_source_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_patches" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "source" "IntakeSource" NOT NULL,
    "kind" "IntakePatchKind" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "payload" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "status" "IntakePatchStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "appliedTargetType" TEXT,
    "appliedTargetId" TEXT,
    "correctedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_patches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_conflicts" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "patchId" TEXT NOT NULL,
    "existingType" TEXT NOT NULL,
    "existingId" TEXT,
    "field" TEXT,
    "incoming" JSONB NOT NULL,
    "existing" JSONB NOT NULL,
    "status" "IntakeConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "IntakeConflictResolution",
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_corrections" (
    "id" TEXT NOT NULL,
    "patchId" TEXT NOT NULL,
    "previousPayload" JSONB NOT NULL,
    "correctedPayload" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_corrections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "intake_runs_userId_createdAt_idx" ON "intake_runs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "intake_runs_userId_status_idx" ON "intake_runs"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "intake_runs_userId_idempotencyKey_key" ON "intake_runs"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "intake_source_runs_runId_status_idx" ON "intake_source_runs"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "intake_source_runs_runId_source_key" ON "intake_source_runs"("runId", "source");

-- CreateIndex
CREATE INDEX "intake_patches_runId_status_idx" ON "intake_patches"("runId", "status");

-- CreateIndex
CREATE INDEX "intake_patches_runId_fingerprint_idx" ON "intake_patches"("runId", "fingerprint");

-- CreateIndex
CREATE INDEX "intake_patches_appliedTargetType_appliedTargetId_idx" ON "intake_patches"("appliedTargetType", "appliedTargetId");

-- CreateIndex
CREATE UNIQUE INDEX "intake_conflicts_patchId_key" ON "intake_conflicts"("patchId");

-- CreateIndex
CREATE INDEX "intake_conflicts_runId_status_idx" ON "intake_conflicts"("runId", "status");

-- CreateIndex
CREATE INDEX "intake_corrections_patchId_createdAt_idx" ON "intake_corrections"("patchId", "createdAt");

ALTER TABLE "intake_runs" ADD CONSTRAINT "intake_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_source_runs" ADD CONSTRAINT "intake_source_runs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "intake_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_patches" ADD CONSTRAINT "intake_patches_runId_fkey" FOREIGN KEY ("runId") REFERENCES "intake_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_patches" ADD CONSTRAINT "intake_patches_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "intake_source_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_conflicts" ADD CONSTRAINT "intake_conflicts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "intake_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_conflicts" ADD CONSTRAINT "intake_conflicts_patchId_fkey" FOREIGN KEY ("patchId") REFERENCES "intake_patches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_corrections" ADD CONSTRAINT "intake_corrections_patchId_fkey" FOREIGN KEY ("patchId") REFERENCES "intake_patches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

