-- The legacy single figure was copied into "salaryMin"/"salaryMax" by
-- 20261122200000_salary_normalization. Dropping it removes the second source of
-- truth; the data itself is preserved in the new columns.
ALTER TABLE "jobs" DROP COLUMN "salary";
