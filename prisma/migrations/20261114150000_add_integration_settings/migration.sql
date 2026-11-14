-- Optional third-party connections saved from the in-app Settings screen.
-- The Firecrawl key is encrypted by the application before it reaches this
-- table, so this column is ciphertext, never a plaintext credential.
CREATE TABLE "integration_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "firecrawlApiKeyEnc" TEXT,
    "firecrawlBaseUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_settings_pkey" PRIMARY KEY ("id")
);
