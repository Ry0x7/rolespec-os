-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_userId_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_userId_fkey";

-- DropIndex
DROP INDEX "notes_userId_idx";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "emailVerified",
DROP COLUMN "password",
DROP COLUMN "passwordChangedAt",
DROP COLUMN "sessionVersion";

-- DropTable
DROP TABLE "accounts";

-- admin_audit_logs and license_activation are intentionally left in place.
-- They are no longer modelled by Prisma and hold no credentials, so keeping the
-- rows preserves historical audit and activation records on existing installs.

-- DropTable
DROP TABLE "sessions";

-- DropTable
DROP TABLE "verification_tokens";
