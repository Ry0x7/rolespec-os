-- AlterTable
ALTER TABLE "job_applications" ADD COLUMN     "followUpAt" TIMESTAMP(3),
ADD COLUMN     "resumeId" TEXT;

-- CreateIndex
CREATE INDEX "job_applications_resumeId_userId_idx" ON "job_applications"("resumeId", "userId");

-- CreateIndex
-- `id` is the primary key, so this pair can never duplicate; it exists only as
-- the target of the composite FK below, which is what user-scopes it.
CREATE UNIQUE INDEX "resumes_id_userId_key" ON "resumes"("id", "userId");

-- AddForeignKey
-- Column-list SET NULL, exactly as `resumes_jobApplicationId_userId_fkey` does:
-- a plain `SET NULL` would also try to null the non-null `userId` and make
-- deleting a referenced resume fail.
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_resumeId_userId_fkey" FOREIGN KEY ("resumeId", "userId") REFERENCES "resumes"("id", "userId") ON DELETE SET NULL ("resumeId") ON UPDATE CASCADE;
