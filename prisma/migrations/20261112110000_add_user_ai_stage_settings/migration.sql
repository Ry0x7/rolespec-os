CREATE TABLE "user_ai_stage_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "apiKeyEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_ai_stage_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_ai_stage_settings_userId_stage_key"
  ON "user_ai_stage_settings"("userId", "stage");

ALTER TABLE "user_ai_stage_settings"
  ADD CONSTRAINT "user_ai_stage_settings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
