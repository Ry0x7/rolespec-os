-- CreateEnum
CREATE TYPE "SalaryCurrency" AS ENUM ('USD', 'PHP');

-- AlterTable
ALTER TABLE "job_applications" ADD COLUMN     "salaryCurrency" "SalaryCurrency" NOT NULL DEFAULT 'USD';
