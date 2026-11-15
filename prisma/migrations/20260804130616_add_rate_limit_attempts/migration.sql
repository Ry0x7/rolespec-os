-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "rate_limit_attempts" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_limit_attempts_bucket_identifier_createdAt_idx" ON "rate_limit_attempts"("bucket", "identifier", "createdAt");
