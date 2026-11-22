-- Universal salary normalization.
--
-- Additive first: every existing USD/PHP row keeps its value, and the new
-- columns are filled from the legacy `jobs.salary` integer before it is
-- dropped in the next migration.

-- ISO 4217 codes. ADD VALUE is additive and idempotent.
ALTER TYPE "SalaryCurrency" ADD VALUE IF NOT EXISTS 'EUR';
ALTER TYPE "SalaryCurrency" ADD VALUE IF NOT EXISTS 'GBP';
ALTER TYPE "SalaryCurrency" ADD VALUE IF NOT EXISTS 'AUD';
ALTER TYPE "SalaryCurrency" ADD VALUE IF NOT EXISTS 'CAD';
ALTER TYPE "SalaryCurrency" ADD VALUE IF NOT EXISTS 'SGD';
ALTER TYPE "SalaryCurrency" ADD VALUE IF NOT EXISTS 'JPY';
ALTER TYPE "SalaryCurrency" ADD VALUE IF NOT EXISTS 'INR';
ALTER TYPE "SalaryCurrency" ADD VALUE IF NOT EXISTS 'AED';
ALTER TYPE "SalaryCurrency" ADD VALUE IF NOT EXISTS 'SAR';
ALTER TYPE "SalaryCurrency" ADD VALUE IF NOT EXISTS 'NZD';
ALTER TYPE "SalaryCurrency" ADD VALUE IF NOT EXISTS 'CHF';

-- Pay periods. DAILY/WEEKLY are calendar rates; CONTRACT is a total and needs
-- a term length before it can be annualized.
ALTER TYPE "SalaryPeriod" ADD VALUE IF NOT EXISTS 'DAILY';
ALTER TYPE "SalaryPeriod" ADD VALUE IF NOT EXISTS 'WEEKLY';
ALTER TYPE "SalaryPeriod" ADD VALUE IF NOT EXISTS 'CONTRACT';

CREATE TYPE "SalaryProvenance" AS ENUM ('USER_ENTERED', 'POSTING_TEXT', 'PROVIDER_STRUCTURED');

-- Career profile target range: Int -> Decimal keeps every value and lets an
-- hourly preference be fractional. The USD default goes away: an unset
-- currency must stay unset rather than silently mean dollars.
ALTER TABLE "career_profiles"
  ALTER COLUMN "salaryMin" TYPE DECIMAL(14, 2) USING "salaryMin"::numeric,
  ALTER COLUMN "salaryMax" TYPE DECIMAL(14, 2) USING "salaryMax"::numeric;

ALTER TABLE "career_profiles" ALTER COLUMN "salaryCurrency" DROP DEFAULT;
ALTER TABLE "career_profiles" ALTER COLUMN "salaryCurrency" DROP NOT NULL;

-- Job: the original figure(s), the raw posting line, provenance and the
-- period-normalized bounds ranking reads.
ALTER TABLE "jobs"
  ADD COLUMN "salaryMin" DECIMAL(14, 2),
  ADD COLUMN "salaryMax" DECIMAL(14, 2),
  ADD COLUMN "salaryTermMonths" INTEGER,
  ADD COLUMN "salaryText" TEXT,
  ADD COLUMN "salaryProvenance" "SalaryProvenance",
  ADD COLUMN "salaryAnnualMin" DECIMAL(14, 2),
  ADD COLUMN "salaryAnnualMax" DECIMAL(14, 2),
  ADD COLUMN "salaryNormalizedAt" TIMESTAMP(3);

ALTER TABLE "jobs" ALTER COLUMN "salaryCurrency" DROP DEFAULT;
ALTER TABLE "jobs" ALTER COLUMN "salaryCurrency" DROP NOT NULL;

-- Backfill before anything is dropped. A legacy single figure is a point
-- range. Its period and currency are already on the row, so the annual
-- figure is arithmetic, not an assumption; a NULL period stays NULL rather
-- than being read as yearly.
UPDATE "jobs"
SET
  "salaryMin" = "salary"::numeric,
  "salaryMax" = "salary"::numeric,
  "salaryProvenance" = 'USER_ENTERED',
  "salaryNormalizedAt" = CASE WHEN "salary" IS NULL THEN NULL ELSE NOW() END,
  "salaryAnnualMin" = CASE "salaryPeriod"
    WHEN 'HOURLY' THEN "salary"::numeric * 2080
    WHEN 'MONTHLY' THEN "salary"::numeric * 12
    WHEN 'YEARLY' THEN "salary"::numeric
    ELSE NULL
  END,
  "salaryAnnualMax" = CASE "salaryPeriod"
    WHEN 'HOURLY' THEN "salary"::numeric * 2080
    WHEN 'MONTHLY' THEN "salary"::numeric * 12
    WHEN 'YEARLY' THEN "salary"::numeric
    ELSE NULL
  END
WHERE "salary" IS NOT NULL;

-- Range sanity at the database, not only in the form.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_salary_range_check"
  CHECK (
    "salaryMin" IS NULL
    OR "salaryMax" IS NULL
    OR ("salaryMin" >= 0 AND "salaryMax" >= "salaryMin")
  );

ALTER TABLE "jobs" ADD CONSTRAINT "jobs_salary_term_check"
  CHECK ("salaryTermMonths" IS NULL OR "salaryTermMonths" > 0);

ALTER TABLE "career_profiles" ADD CONSTRAINT "career_profiles_salary_range_check"
  CHECK (
    "salaryMin" IS NULL
    OR "salaryMax" IS NULL
    OR ("salaryMin" >= 0 AND "salaryMax" >= "salaryMin")
  );

-- Last accepted rate set per base currency. Exact decimal strings live in the
-- payload; nothing here is a rate the app invented.
CREATE TABLE "fx_rate_snapshots" (
  "id" TEXT NOT NULL,
  "base" "SalaryCurrency" NOT NULL,
  "source" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fx_rate_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fx_rate_snapshots_base_key" ON "fx_rate_snapshots"("base");
