CREATE TYPE "OutreachSequenceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "OutreachTouchStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED', 'CANCELLED');

CREATE TABLE "outreach_contacts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "company" TEXT,
    "email" TEXT,
    "linkedinUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outreach_contacts_id_userId_key"
  ON "outreach_contacts"("id", "userId");
CREATE INDEX "outreach_contacts_userId_createdAt_idx"
  ON "outreach_contacts"("userId", "createdAt");

CREATE TABLE "outreach_sequences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OutreachSequenceStatus" NOT NULL DEFAULT 'DRAFT',
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outreach_sequences_userId_idempotencyKey_key"
  ON "outreach_sequences"("userId", "idempotencyKey");
CREATE INDEX "outreach_sequences_userId_status_createdAt_idx"
  ON "outreach_sequences"("userId", "status", "createdAt");

CREATE TABLE "outreach_touches" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "channel" "FollowUpChannel" NOT NULL,
    "status" "OutreachTouchStatus" NOT NULL DEFAULT 'PENDING',
    "dueOn" DATE NOT NULL,
    "note" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_touches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outreach_touches_sequenceId_order_key"
  ON "outreach_touches"("sequenceId", "order");
CREATE INDEX "outreach_touches_sequenceId_status_dueOn_idx"
  ON "outreach_touches"("sequenceId", "status", "dueOn");

ALTER TABLE "outreach_contacts"
  ADD CONSTRAINT "outreach_contacts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outreach_sequences"
  ADD CONSTRAINT "outreach_sequences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outreach_sequences"
  ADD CONSTRAINT "outreach_sequences_contactId_userId_fkey"
  FOREIGN KEY ("contactId", "userId") REFERENCES "outreach_contacts"("id", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outreach_touches"
  ADD CONSTRAINT "outreach_touches_sequenceId_fkey"
  FOREIGN KEY ("sequenceId") REFERENCES "outreach_sequences"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
