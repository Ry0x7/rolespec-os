-- AlterTable
ALTER TABLE "job_applications" ADD COLUMN     "matchCheckedAt" TIMESTAMP(3),
ADD COLUMN     "matchResult" JSONB,
ADD COLUMN     "matchResumeId" TEXT,
ADD COLUMN     "matchScore" INTEGER,
ADD COLUMN     "requirementFlags" JSONB;
