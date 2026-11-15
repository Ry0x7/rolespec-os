-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "provider" TEXT,
    "model" TEXT,
    "temperature" DOUBLE PRECISION,
    "maxOutputTokens" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);
