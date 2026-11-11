-- Consecutive worker crashes recovered for a step. Existing rows start at zero.
ALTER TABLE "workflow_steps" ADD COLUMN "recoveryCount" INTEGER NOT NULL DEFAULT 0;
