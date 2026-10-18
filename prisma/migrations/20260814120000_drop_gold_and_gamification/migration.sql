/*
  Warnings:

  - The `achievements`, `user_achievements`, `referrals` and `gold_transactions`
    tables are dropped, along with every row in them.
  - The `xp`, `level`, `rank` and `totalXP` columns on `player_profiles` and the
    `gold` column on `users` are dropped, along with all their data.

  Covers two schema changes at once: the gamification/referral removal (no
  migration was written when the Prisma models went) and the removal of the gold
  economy and PayMongo billing. AI features are no longer metered, so there is
  nothing to migrate the balances onto.
*/

-- DropTable
-- user_achievements first: it has FKs onto achievements and player_profiles.
DROP TABLE IF EXISTS "user_achievements";

-- DropTable
DROP TABLE IF EXISTS "achievements";

-- DropTable
DROP TABLE IF EXISTS "referrals";

-- DropTable
DROP TABLE IF EXISTS "gold_transactions";

-- AlterTable
ALTER TABLE "player_profiles" DROP COLUMN IF EXISTS "xp",
DROP COLUMN IF EXISTS "level",
DROP COLUMN IF EXISTS "rank",
DROP COLUMN IF EXISTS "totalXP";

-- AlterTable
ALTER TABLE "users" DROP COLUMN IF EXISTS "gold";

-- DropEnum
DROP TYPE IF EXISTS "Rank";

-- DropEnum
DROP TYPE IF EXISTS "AchievementCategory";

-- DropEnum
DROP TYPE IF EXISTS "AchievementRarity";

-- DropEnum
DROP TYPE IF EXISTS "ReferralStatus";

-- DropEnum
DROP TYPE IF EXISTS "GoldTxType";
