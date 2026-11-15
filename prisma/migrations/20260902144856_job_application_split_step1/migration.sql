-- AlterTable
ALTER TABLE "job_applications" ADD COLUMN     "jobId" TEXT;

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "location" TEXT,
    "jobType" "JobType",
    "workType" "WorkType",
    "salary" INTEGER,
    "salaryPeriod" "SalaryPeriod",
    "salaryCurrency" "SalaryCurrency" NOT NULL DEFAULT 'USD',
    "description" TEXT,
    "deadline" DATE,
    "riskLevel" "JobRiskLevel",
    "riskReasons" JSONB,
    "riskSource" "JobRiskSource",
    "riskCheckedAt" TIMESTAMP(3),
    "requirementFlags" JSONB,
    "source" "JobSource" NOT NULL DEFAULT 'MANUAL',
    "sourceProvider" TEXT,
    "externalId" TEXT,
    "canonicalUrl" TEXT,
    "discoveredAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_userId_canonicalUrl_idx" ON "jobs"("userId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "jobs_userId_createdAt_idx" ON "jobs"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_id_userId_key" ON "jobs"("id", "userId");

-- CreateIndex
CREATE INDEX "job_applications_jobId_userId_idx" ON "job_applications"("jobId", "userId");

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_jobId_userId_fkey" FOREIGN KEY ("jobId", "userId") REFERENCES "jobs"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: exactly one job per existing application. The new job reuses the
-- application's own id, so the mapping is deterministic, re-runnable and
-- trivially auditable — these rows were literally one row until now.
INSERT INTO "jobs" (
    "id", "userId", "companyName", "title", "url", "location", "jobType",
    "workType", "salary", "salaryPeriod", "salaryCurrency", "description",
    "deadline", "riskLevel", "riskReasons", "riskSource", "riskCheckedAt",
    "requirementFlags", "source", "sourceProvider", "externalId",
    "canonicalUrl", "discoveredAt", "postedAt", "createdAt", "updatedAt"
)
SELECT
    a."id", a."userId", a."companyName", a."jobTitle", a."jobLink",
    a."location", a."jobType", a."workType", a."salary", a."salaryPeriod",
    a."salaryCurrency", a."jobDescription", a."deadline", a."riskLevel",
    a."riskReasons", a."riskSource", a."riskCheckedAt", a."requirementFlags",
    a."source", a."sourceProvider", a."externalId", a."canonicalUrl",
    a."discoveredAt", a."postedAt", a."createdAt", a."updatedAt"
FROM "job_applications" a
ON CONFLICT ("id") DO NOTHING;

UPDATE "job_applications" SET "jobId" = "id" WHERE "jobId" IS NULL;
