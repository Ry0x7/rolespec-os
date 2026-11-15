CREATE TYPE "FollowUpChannel" AS ENUM ('EMAIL', 'LINKEDIN');
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'DONE', 'DISMISSED', 'CANCELLED');

CREATE TABLE "follow_up_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobApplicationId" TEXT NOT NULL,
    "channel" "FollowUpChannel" NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" DATE NOT NULL,
    "appliedOn" DATE,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AUTO',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "follow_up_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "follow_up_tasks_jobApplicationId_channel_key"
  ON "follow_up_tasks"("jobApplicationId", "channel");
CREATE INDEX "follow_up_tasks_userId_status_dueAt_idx"
  ON "follow_up_tasks"("userId", "status", "dueAt");
CREATE INDEX "follow_up_tasks_userId_jobApplicationId_idx"
  ON "follow_up_tasks"("userId", "jobApplicationId");

ALTER TABLE "follow_up_tasks"
  ADD CONSTRAINT "follow_up_tasks_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_tasks"
  ADD CONSTRAINT "follow_up_tasks_jobApplicationId_userId_fkey"
  FOREIGN KEY ("jobApplicationId", "userId")
  REFERENCES "job_applications"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
