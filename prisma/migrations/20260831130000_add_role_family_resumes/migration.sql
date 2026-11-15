-- CreateEnum
CREATE TYPE "ResumeVariant" AS ENUM ('MASTER', 'ROLE_FAMILY');

-- AlterTable: the default keeps every existing resume master-compatible without
-- a data backfill; the ownership relation columns remain nullable for masters.
ALTER TABLE "resumes"
ADD COLUMN "careerProfileId" TEXT,
ADD COLUMN "roleFamilyId" TEXT,
ADD COLUMN "variant" "ResumeVariant" NOT NULL DEFAULT 'MASTER';

-- CreateIndex
CREATE UNIQUE INDEX "career_profiles_id_userId_key" ON "career_profiles"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "career_role_families_id_careerProfileId_key" ON "career_role_families"("id", "careerProfileId");

-- CreateIndex
CREATE INDEX "resumes_careerProfileId_userId_idx" ON "resumes"("careerProfileId", "userId");

-- CreateIndex
CREATE INDEX "resumes_roleFamilyId_careerProfileId_idx" ON "resumes"("roleFamilyId", "careerProfileId");

-- AddForeignKey: together, these composite keys require a role-family resume's
-- profile, family, and existing resume owner to belong to the same user.
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_careerProfileId_userId_fkey" FOREIGN KEY ("careerProfileId", "userId") REFERENCES "career_profiles"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: deleting a family detaches the optional association while
-- preserving the reusable resume and its profile attachment. PostgreSQL's
-- column list limits SET NULL to the nullable family id; the profile id remains
-- available to the separate ownership FK and its profile-delete cascade.
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_roleFamilyId_careerProfileId_fkey" FOREIGN KEY ("roleFamilyId", "careerProfileId") REFERENCES "career_role_families"("id", "careerProfileId") ON DELETE SET NULL ("roleFamilyId") ON UPDATE CASCADE;
