-- CreateEnum
CREATE TYPE "SalaryPeriod" AS ENUM ('HOURLY', 'MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "job_applications" ADD COLUMN     "salaryPeriod" "SalaryPeriod";
