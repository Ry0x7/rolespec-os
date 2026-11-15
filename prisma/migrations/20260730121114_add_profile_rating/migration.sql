-- CreateEnum
CREATE TYPE "ProfileRatingKind" AS ENUM ('LINKEDIN', 'PORTFOLIO');

-- CreateTable
CREATE TABLE "profile_ratings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ProfileRatingKind" NOT NULL,
    "sourceUrl" TEXT,
    "overallScore" INTEGER NOT NULL,
    "scores" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "suggestions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_ratings_userId_kind_createdAt_idx" ON "profile_ratings"("userId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "profile_ratings" ADD CONSTRAINT "profile_ratings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
