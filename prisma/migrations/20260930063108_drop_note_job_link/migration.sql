-- DropForeignKey
ALTER TABLE "notes" DROP CONSTRAINT "notes_jobApplicationId_fkey";

-- DropIndex
DROP INDEX "notes_jobApplicationId_idx";

-- AlterTable
ALTER TABLE "notes" DROP COLUMN "jobApplicationId";

