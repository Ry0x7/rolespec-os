-- CreateEnum
CREATE TYPE "JobRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "JobRiskSource" AS ENUM ('HEURISTIC', 'AI');

-- AlterTable
ALTER TABLE "job_applications" ADD COLUMN     "riskCheckedAt" TIMESTAMP(3),
ADD COLUMN     "riskLevel" "JobRiskLevel",
ADD COLUMN     "riskReasons" JSONB,
ADD COLUMN     "riskSource" "JobRiskSource";
