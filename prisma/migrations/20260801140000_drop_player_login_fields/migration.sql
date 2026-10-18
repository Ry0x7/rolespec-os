-- The login streak was never implemented: no code reads or writes these two
-- columns, and every existing row still holds the column defaults
-- (loginStreak = 0, lastLoginAt = createdAt).

-- AlterTable
ALTER TABLE "player_profiles" DROP COLUMN "lastLoginAt",
DROP COLUMN "loginStreak";
