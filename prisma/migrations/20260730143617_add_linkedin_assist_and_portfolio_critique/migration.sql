-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GoldTxType" ADD VALUE 'LINKEDIN_ASSIST';
ALTER TYPE "GoldTxType" ADD VALUE 'PORTFOLIO_CRITIQUE';

-- CreateTable
CREATE TABLE "linkedin_suggestions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "suggestions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "linkedin_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_critiques" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "screenshotUrl" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "overallScore" INTEGER,
    "annotations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_critiques_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "linkedin_suggestions_userId_createdAt_idx" ON "linkedin_suggestions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "portfolio_critiques_userId_createdAt_idx" ON "portfolio_critiques"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "linkedin_suggestions" ADD CONSTRAINT "linkedin_suggestions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_critiques" ADD CONSTRAINT "portfolio_critiques_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
