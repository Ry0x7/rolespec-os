-- CreateEnum
CREATE TYPE "ATSAnalysisMode" AS ENUM ('QUALITY', 'JOB_MATCH');

-- AlterTable: added nullable so existing rows can be backfilled before the
-- NOT NULL constraint is applied.
ALTER TABLE "ats_analyses" ADD COLUMN     "mode" "ATSAnalysisMode";

-- Backfill: a retained job description is exactly what distinguished a
-- job-match run from a quality one before the mode was persisted.
UPDATE "ats_analyses"
SET "mode" = CASE
  WHEN "jobDescription" IS NOT NULL THEN 'JOB_MATCH'::"ATSAnalysisMode"
  ELSE 'QUALITY'::"ATSAnalysisMode"
END
WHERE "mode" IS NULL;

ALTER TABLE "ats_analyses" ALTER COLUMN "mode" SET NOT NULL;

-- Backfill: legacy quality rows stored the model's placeholder keyword score
-- of 50; quality runs now store null because there is nothing to match against.
UPDATE "ats_analyses"
SET "scores" = jsonb_set("scores", '{keywords}', 'null'::jsonb)
WHERE "mode" = 'QUALITY' AND "scores"->>'keywords' = '50';
