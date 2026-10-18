-- RoleSpec is a one-time purchase now: there is no FREE/PRO split to record.
-- Table is "users" and the enum type is "Plan" (see 20260714000423_testing).
ALTER TABLE "users" DROP COLUMN IF EXISTS "plan";
DROP TYPE IF EXISTS "Plan";
