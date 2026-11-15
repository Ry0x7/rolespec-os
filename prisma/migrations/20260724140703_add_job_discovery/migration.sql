-- CreateEnum
CREATE TYPE "JobDiscoveryRunStatus" AS ENUM ('PENDING', 'DERIVING_QUERIES', 'SEARCHING', 'SCRAPING', 'SCORING', 'GENERATING_LETTERS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobDiscoveryVerdict" AS ENUM ('APPLY', 'REVIEW', 'SKIP');

-- CreateTable
CREATE TABLE "job_discovery_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "status" "JobDiscoveryRunStatus" NOT NULL DEFAULT 'PENDING',
    "searchQueries" JSONB,
    "sourcesUsed" JSONB,
    "scoreThreshold" INTEGER NOT NULL DEFAULT 70,
    "totalFound" INTEGER NOT NULL DEFAULT 0,
    "totalScored" INTEGER NOT NULL DEFAULT 0,
    "totalApply" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_discovery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovered_job_postings" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceHost" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT,
    "location" TEXT,
    "postedAt" TIMESTAMP(3),
    "description" TEXT,
    "rawSnippet" TEXT,
    "extractionOk" BOOLEAN NOT NULL DEFAULT true,
    "score" INTEGER,
    "verdict" "JobDiscoveryVerdict",
    "scoreReasons" JSONB,
    "coverLetterId" TEXT,
    "jobApplicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovered_job_postings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_discovery_runs_userId_idx" ON "job_discovery_runs"("userId");

-- CreateIndex
CREATE INDEX "job_discovery_runs_userId_status_idx" ON "job_discovery_runs"("userId", "status");

-- CreateIndex
CREATE INDEX "job_discovery_runs_userId_createdAt_idx" ON "job_discovery_runs"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_job_postings_coverLetterId_key" ON "discovered_job_postings"("coverLetterId");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_job_postings_jobApplicationId_key" ON "discovered_job_postings"("jobApplicationId");

-- CreateIndex
CREATE INDEX "discovered_job_postings_userId_idx" ON "discovered_job_postings"("userId");

-- CreateIndex
CREATE INDEX "discovered_job_postings_runId_verdict_idx" ON "discovered_job_postings"("runId", "verdict");

-- CreateIndex
CREATE INDEX "discovered_job_postings_runId_score_idx" ON "discovered_job_postings"("runId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_job_postings_runId_canonicalUrl_key" ON "discovered_job_postings"("runId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "cover_letters_jobApplicationId_idx" ON "cover_letters"("jobApplicationId");

-- CreateIndex
CREATE INDEX "job_applications_userId_createdAt_idx" ON "job_applications"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "job_discovery_runs" ADD CONSTRAINT "job_discovery_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_discovery_runs" ADD CONSTRAINT "job_discovery_runs_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_job_postings" ADD CONSTRAINT "discovered_job_postings_runId_fkey" FOREIGN KEY ("runId") REFERENCES "job_discovery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_job_postings" ADD CONSTRAINT "discovered_job_postings_coverLetterId_fkey" FOREIGN KEY ("coverLetterId") REFERENCES "cover_letters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_job_postings" ADD CONSTRAINT "discovered_job_postings_jobApplicationId_fkey" FOREIGN KEY ("jobApplicationId") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
