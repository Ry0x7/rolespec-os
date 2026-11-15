-- Defensive backfill, in the spirit of the step-1 migration: `jobId` is about
-- to become NOT NULL, and step 1 already gave every application a posting, so
-- this should touch nothing. It exists so an application written before the
-- backfill (or restored from an older dump) cannot fail the constraint — it
-- gets the posting its own mirrored columns describe, reusing its id exactly as
-- step 1 did. After this phase the mirrored columns are gone, so a later
-- rescue would have nothing to rebuild the posting from.
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
WHERE a."jobId" IS NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE "job_applications" SET "jobId" = "id" WHERE "jobId" IS NULL;

-- DropIndex
DROP INDEX "job_applications_userId_canonicalUrl_idx";

-- AlterTable
ALTER TABLE "job_applications" DROP COLUMN "canonicalUrl",
DROP COLUMN "companyName",
DROP COLUMN "deadline",
DROP COLUMN "discoveredAt",
DROP COLUMN "externalId",
DROP COLUMN "jobDescription",
DROP COLUMN "jobLink",
DROP COLUMN "jobTitle",
DROP COLUMN "jobType",
DROP COLUMN "location",
DROP COLUMN "postedAt",
DROP COLUMN "requirementFlags",
DROP COLUMN "riskCheckedAt",
DROP COLUMN "riskLevel",
DROP COLUMN "riskReasons",
DROP COLUMN "riskSource",
DROP COLUMN "salary",
DROP COLUMN "salaryCurrency",
DROP COLUMN "salaryPeriod",
DROP COLUMN "source",
DROP COLUMN "sourceProvider",
DROP COLUMN "workType",
ALTER COLUMN "jobId" SET NOT NULL;
