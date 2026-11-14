-- AlterTable
ALTER TABLE "resumes" ADD COLUMN     "sourceResumeId" TEXT;

-- CreateIndex
CREATE INDEX "resumes_sourceResumeId_idx" ON "resumes"("sourceResumeId");

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_sourceResumeId_fkey" FOREIGN KEY ("sourceResumeId") REFERENCES "resumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

