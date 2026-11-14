-- The application-level pre-check is not enough: two simultaneous creates can
-- both pass it. This partial unique index makes PostgreSQL the arbiter while
-- still allowing a new run after the previous one reaches a terminal state.
CREATE UNIQUE INDEX "workflow_runs_one_active_per_application"
ON "workflow_runs" ("userId", "jobApplicationId")
WHERE "jobApplicationId" IS NOT NULL
  AND state IN ('MANUAL', 'ASSISTED', 'AWAITING_REVIEW', 'PAUSED');
