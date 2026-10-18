/*
  Warnings:

  - You are about to drop the `discovered_job_postings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `job_discovery_runs` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "GoalPeriod" AS ENUM ('DAILY', 'WEEKLY');

-- DropForeignKey
ALTER TABLE "discovered_job_postings" DROP CONSTRAINT "discovered_job_postings_coverLetterId_fkey";

-- DropForeignKey
ALTER TABLE "discovered_job_postings" DROP CONSTRAINT "discovered_job_postings_jobApplicationId_fkey";

-- DropForeignKey
ALTER TABLE "discovered_job_postings" DROP CONSTRAINT "discovered_job_postings_runId_fkey";

-- DropForeignKey
ALTER TABLE "job_discovery_runs" DROP CONSTRAINT "job_discovery_runs_resumeId_fkey";

-- DropForeignKey
ALTER TABLE "job_discovery_runs" DROP CONSTRAINT "job_discovery_runs_userId_fkey";

-- AlterTable
ALTER TABLE "player_profiles" ADD COLUMN     "applicationGoalPeriod" "GoalPeriod" NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "applicationGoalTarget" INTEGER NOT NULL DEFAULT 10;

-- DropTable
DROP TABLE "discovered_job_postings";

-- DropTable
DROP TABLE "job_discovery_runs";

-- DropEnum
DROP TYPE "JobDiscoveryRunStatus";

-- DropEnum
DROP TYPE "JobDiscoveryVerdict";
