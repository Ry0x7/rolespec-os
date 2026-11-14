-- CreateEnum
CREATE TYPE "InterviewQuestionSource" AS ENUM ('SCRAPED', 'AI_GENERATED');

-- CreateTable
CREATE TABLE "interview_questions" (
    "id" TEXT NOT NULL,
    "jobApplicationId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "source" "InterviewQuestionSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interview_questions_jobApplicationId_idx" ON "interview_questions"("jobApplicationId");

-- AddForeignKey
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_jobApplicationId_fkey" FOREIGN KEY ("jobApplicationId") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
