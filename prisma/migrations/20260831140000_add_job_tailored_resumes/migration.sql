-- AlterEnum: additive only; existing rows keep their variant.
ALTER TYPE "ResumeVariant" ADD VALUE 'JOB_TAILORED';

-- AlterTable: nullable association; no backfill required.
ALTER TABLE "resumes"
ADD COLUMN "jobApplicationId" TEXT;

-- CreateIndex: target of the composite ownership FK below.
CREATE UNIQUE INDEX "job_applications_id_userId_key" ON "job_applications"("id", "userId");

-- CreateIndex
CREATE INDEX "resumes_jobApplicationId_userId_idx" ON "resumes"("jobApplicationId", "userId");

-- AddForeignKey: the composite key requires a tailored resume's application to
-- belong to the resume's owner. Deleting the application detaches the optional
-- association while preserving the resume: PostgreSQL's column list limits
-- SET NULL to the nullable application id, since "userId" is required and is
-- owned by the separate user FK and its user-delete cascade (same pattern as
-- resumes_roleFamilyId_careerProfileId_fkey).
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_jobApplicationId_userId_fkey" FOREIGN KEY ("jobApplicationId", "userId") REFERENCES "job_applications"("id", "userId") ON DELETE SET NULL ("jobApplicationId") ON UPDATE CASCADE;
