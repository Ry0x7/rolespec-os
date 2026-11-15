-- CreateEnum
CREATE TYPE "CareerEvidenceKind" AS ENUM ('EXPERIENCE', 'ACHIEVEMENT', 'PROJECT', 'EDUCATION', 'CERTIFICATION');

-- CreateEnum
CREATE TYPE "CareerEvidenceSource" AS ENUM ('USER_ENTERED', 'RESUME_IMPORT_CANDIDATE');

-- CreateEnum
CREATE TYPE "CareerEvidenceStatus" AS ENUM ('CANDIDATE', 'CONFIRMED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CareerCapabilityDepth" AS ENUM ('EXPOSURE', 'WORKING', 'DEEP');

-- CreateEnum
CREATE TYPE "CareerCapabilitySelfRating" AS ENUM ('LEARNING', 'COMPETENT', 'STRONG', 'EXPERT');

-- CreateTable
CREATE TABLE "career_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "experienceLevel" "ExperienceLevel",
    "locations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openToRelocation" BOOLEAN NOT NULL DEFAULT false,
    "workModes" "WorkType"[] DEFAULT ARRAY[]::"WorkType"[],
    "workAuthorization" TEXT,
    "requiresSponsorship" BOOLEAN,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryPeriod" "SalaryPeriod",
    "salaryCurrency" "SalaryCurrency" NOT NULL DEFAULT 'USD',
    "careerGoals" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_role_families" (
    "id" TEXT NOT NULL,
    "careerProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_role_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_target_roles" (
    "id" TEXT NOT NULL,
    "careerProfileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "roleFamilyId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_target_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_evidence" (
    "id" TEXT NOT NULL,
    "careerProfileId" TEXT NOT NULL,
    "kind" "CareerEvidenceKind" NOT NULL,
    "source" "CareerEvidenceSource" NOT NULL DEFAULT 'USER_ENTERED',
    "status" "CareerEvidenceStatus" NOT NULL DEFAULT 'CANDIDATE',
    "title" TEXT NOT NULL,
    "organization" TEXT,
    "details" TEXT,
    "outcome" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "metadata" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_capabilities" (
    "id" TEXT NOT NULL,
    "careerProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "selfAssessment" "CareerCapabilitySelfRating",
    "lastUsedAt" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_evidence_capabilities" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "depth" "CareerCapabilityDepth" NOT NULL DEFAULT 'WORKING',
    "hasMeasuredOutcome" BOOLEAN NOT NULL DEFAULT false,
    "outcomeNote" TEXT,
    "lastUsedAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_evidence_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "career_profiles_userId_key" ON "career_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "career_role_families_careerProfileId_name_key" ON "career_role_families"("careerProfileId", "name");

-- CreateIndex
CREATE INDEX "career_target_roles_careerProfileId_active_priority_idx" ON "career_target_roles"("careerProfileId", "active", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "career_target_roles_careerProfileId_title_key" ON "career_target_roles"("careerProfileId", "title");

-- CreateIndex
CREATE INDEX "career_evidence_careerProfileId_kind_idx" ON "career_evidence"("careerProfileId", "kind");

-- CreateIndex
CREATE INDEX "career_evidence_careerProfileId_status_idx" ON "career_evidence"("careerProfileId", "status");

-- CreateIndex
CREATE INDEX "career_capabilities_careerProfileId_confirmed_idx" ON "career_capabilities"("careerProfileId", "confirmed");

-- CreateIndex
CREATE UNIQUE INDEX "career_capabilities_careerProfileId_name_key" ON "career_capabilities"("careerProfileId", "name");

-- CreateIndex
CREATE INDEX "career_evidence_capabilities_capabilityId_idx" ON "career_evidence_capabilities"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "career_evidence_capabilities_evidenceId_capabilityId_key" ON "career_evidence_capabilities"("evidenceId", "capabilityId");

-- AddForeignKey
ALTER TABLE "career_profiles" ADD CONSTRAINT "career_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_role_families" ADD CONSTRAINT "career_role_families_careerProfileId_fkey" FOREIGN KEY ("careerProfileId") REFERENCES "career_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_target_roles" ADD CONSTRAINT "career_target_roles_careerProfileId_fkey" FOREIGN KEY ("careerProfileId") REFERENCES "career_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_target_roles" ADD CONSTRAINT "career_target_roles_roleFamilyId_fkey" FOREIGN KEY ("roleFamilyId") REFERENCES "career_role_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_evidence" ADD CONSTRAINT "career_evidence_careerProfileId_fkey" FOREIGN KEY ("careerProfileId") REFERENCES "career_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_capabilities" ADD CONSTRAINT "career_capabilities_careerProfileId_fkey" FOREIGN KEY ("careerProfileId") REFERENCES "career_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_evidence_capabilities" ADD CONSTRAINT "career_evidence_capabilities_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "career_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_evidence_capabilities" ADD CONSTRAINT "career_evidence_capabilities_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "career_capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: give every existing PlayerProfile owner an empty CareerProfile so the
-- new workspace has a row to edit. Deliberately conservative — only the profile
-- shell is created. Legacy `currentRole`/`experienceLevel` are NOT copied, and no
-- evidence or capability is inferred from legacy values or resumes; those must be
-- entered and confirmed by the user. The `locations`/`workModes` column defaults
-- supply empty arrays, so a backfilled row matches one Prisma would create and is
-- never SQL NULL. `ON CONFLICT DO NOTHING` on the unique `userId` makes this
-- rerun-safe and never overwrites an existing profile.
INSERT INTO "career_profiles" ("id", "userId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."userId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "player_profiles" p
ON CONFLICT ("userId") DO NOTHING;

-- Backfill: `targetRole` is the one legacy column that is genuinely a statement
-- of direction, so it becomes a target-role record. Blank/whitespace-only values
-- are skipped, no role family is invented, and the unique
-- (careerProfileId, title) makes a rerun a no-op.
INSERT INTO "career_target_roles" ("id", "careerProfileId", "title", "priority", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, cp."id", btrim(p."targetRole"), 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "player_profiles" p
JOIN "career_profiles" cp ON cp."userId" = p."userId"
WHERE p."targetRole" IS NOT NULL AND btrim(p."targetRole") <> ''
ON CONFLICT ("careerProfileId", "title") DO NOTHING;

