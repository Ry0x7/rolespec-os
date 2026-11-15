CREATE TABLE "ranking_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SAVED_JOBS',
    "topK" INTEGER,
    "minScore" INTEGER,
    "poolSize" INTEGER NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "reranked" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ranking_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ranking_snapshots_userId_createdAt_idx"
  ON "ranking_snapshots"("userId", "createdAt");

ALTER TABLE "ranking_snapshots"
  ADD CONSTRAINT "ranking_snapshots_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
