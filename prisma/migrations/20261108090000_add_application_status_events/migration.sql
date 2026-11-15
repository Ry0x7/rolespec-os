-- Application status history. Additive only: a new append-only table, its
-- cascade link to job_applications, and one starting event per existing row so
-- the timeline is not blank for applications created before this migration.

CREATE TABLE IF NOT EXISTS "application_status_events" (
    "id" TEXT NOT NULL,
    "jobApplicationId" TEXT NOT NULL,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus" NOT NULL,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "application_status_events_jobApplicationId_createdAt_idx"
    ON "application_status_events"("jobApplicationId", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'application_status_events_jobApplicationId_fkey'
    ) THEN
        ALTER TABLE "application_status_events"
            ADD CONSTRAINT "application_status_events_jobApplicationId_fkey"
            FOREIGN KEY ("jobApplicationId") REFERENCES "job_applications"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- The status an application was created with is a real starting point, even
-- though the old rows never recorded the transition. `MIGRATION` marks it as
-- reconstructed, not user-entered. `migrated_` + the application id is unique
-- and cannot collide with a cuid.
INSERT INTO "application_status_events"
    ("id", "jobApplicationId", "fromStatus", "toStatus", "note", "source", "createdAt")
SELECT
    'migrated_' || a."id",
    a."id",
    NULL,
    a."status",
    NULL,
    'MIGRATION',
    a."createdAt"
FROM "job_applications" a
WHERE NOT EXISTS (
    SELECT 1 FROM "application_status_events" e WHERE e."jobApplicationId" = a."id"
);
