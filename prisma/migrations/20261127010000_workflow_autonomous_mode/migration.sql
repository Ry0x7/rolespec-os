-- Fully autonomous preparation runs. Additive: existing runs keep their mode.
ALTER TYPE "WorkflowMode" ADD VALUE IF NOT EXISTS 'AUTONOMOUS';
