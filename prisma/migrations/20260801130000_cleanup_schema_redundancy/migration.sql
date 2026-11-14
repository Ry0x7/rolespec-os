-- ── Data migrations (must run before the schema changes below) ──────────────

-- The portfolio critique feature was removed; its 5 historical debits are
-- remapped onto GENERATE_COST, which is what the surviving portfolio flow
-- debits, so the enum value can be dropped.
UPDATE "gold_transactions" SET "type" = 'GENERATE_COST' WHERE "type" = 'PORTFOLIO_CRITIQUE';

-- Legacy exports predate the per-template URL map and only carry the flat
-- pdfUrl/docxUrl pair. The app already surfaced those under the MINIMAL key,
-- so backfill them the same way before the columns are dropped.
UPDATE "resume_exports"
SET "templateUrls" = jsonb_build_object(
  'MINIMAL', jsonb_build_object('pdfUrl', "pdfUrl", 'docxUrl', "docxUrl")
)
WHERE "templateUrls" IS NULL AND "pdfUrl" IS NOT NULL AND "docxUrl" IS NOT NULL;

-- Null out any dangling author reference before the FK is added.
UPDATE "ai_settings"
SET "updatedById" = NULL
WHERE "updatedById" IS NOT NULL
  AND "updatedById" NOT IN (SELECT "id" FROM "users");

-- ── Schema changes ─────────────────────────────────────────────────────────

-- AlterEnum
BEGIN;
CREATE TYPE "AchievementCategory_new" AS ENUM ('RESUME', 'ATS', 'MILESTONE');
ALTER TABLE "achievements" ALTER COLUMN "category" TYPE "AchievementCategory_new" USING ("category"::text::"AchievementCategory_new");
ALTER TYPE "AchievementCategory" RENAME TO "AchievementCategory_old";
ALTER TYPE "AchievementCategory_new" RENAME TO "AchievementCategory";
DROP TYPE "public"."AchievementCategory_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "GoldTxType_new" AS ENUM ('PURCHASE', 'UPLOAD_COST', 'GENERATE_COST', 'REFERRAL_REWARD', 'SIGNUP_BONUS', 'ADMIN_GRANT', 'COVER_LETTER', 'LINKEDIN_ASSIST');
ALTER TABLE "gold_transactions" ALTER COLUMN "type" TYPE "GoldTxType_new" USING ("type"::text::"GoldTxType_new");
ALTER TYPE "GoldTxType" RENAME TO "GoldTxType_old";
ALTER TYPE "GoldTxType_new" RENAME TO "GoldTxType";
DROP TYPE "public"."GoldTxType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "daily_missions" DROP CONSTRAINT "daily_missions_userId_fkey";

-- DropForeignKey
ALTER TABLE "resume_versions" DROP CONSTRAINT "resume_versions_resumeId_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_userId_fkey";

-- DropForeignKey
ALTER TABLE "usage_records" DROP CONSTRAINT "usage_records_userId_fkey";

-- DropIndex
DROP INDEX "ats_analyses_userId_idx";

-- DropIndex
DROP INDEX "gold_transactions_userId_idx";

-- DropIndex
DROP INDEX "job_applications_userId_idx";

-- DropIndex
DROP INDEX "referrals_code_idx";

-- DropIndex
DROP INDEX "resume_section_items_sectionId_idx";

-- DropIndex
DROP INDEX "resume_sections_resumeId_idx";

-- DropIndex
DROP INDEX "resumes_userId_idx";

-- DropIndex
DROP INDEX "todos_userId_idx";

-- AlterTable
ALTER TABLE "resume_exports" DROP COLUMN "docxUrl",
DROP COLUMN "pdfUrl";

-- DropTable
DROP TABLE "daily_missions";

-- DropTable
DROP TABLE "resume_versions";

-- DropTable
DROP TABLE "subscriptions";

-- DropTable
DROP TABLE "usage_records";

-- DropEnum
DROP TYPE "SubscriptionStatus";

-- DropEnum
DROP TYPE "UsageFeature";

-- DropEnum
DROP TYPE "UsagePeriod";

-- CreateIndex
CREATE INDEX "notes_jobApplicationId_idx" ON "notes"("jobApplicationId");

-- CreateIndex
CREATE INDEX "todos_jobApplicationId_idx" ON "todos"("jobApplicationId");

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

