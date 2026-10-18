"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/features/auth/config"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"
import { enhanceProfileText } from "../services/enhance-profile"
import { CAREER_PROFILE_PATH, resolveOwnProfileId } from "./shared"

const log = logger("career-profile-enhance")

/** Sliding window for the per-user enhance rate limit. */
const ENHANCE_RATE_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 }

const RATE_LIMITED_ERROR =
  "Too many enhance runs. Please wait a few minutes and try again."
const AI_FAILED_ERROR = "Enhance failed. Please try again."

/** How many active target roles are passed to the model as tone context. */
const CONTEXT_TARGET_ROLES = 5

export interface EnhanceResult {
  success: true
  /** The text as it was before the run — lets the UI say what changed. */
  previous: string
  /** What is now stored. Equal to `previous` when `unchanged` is true. */
  enhanced: string
  /** True when the text was already clear, or too thin to improve. Nothing written. */
  unchanged: boolean
}

/**
 * Runs the enhance service and turns the provider-specific failures into the
 * `{ error }` shape every action in this feature returns.
 */
async function runEnhance(
  input: Parameters<typeof enhanceProfileText>[0]
): Promise<{ improved: string; unchanged: boolean } | { error: string }> {
  try {
    return await enhanceProfileText(input)
  } catch (err) {
    log.error("Profile enhance failed", { err, field: input.field })
    // The key and daily-limit messages are actionable and safe to show; anything
    // else could carry provider detail, so it stays in the log above.
    return {
      error:
        err instanceof AiKeyRequiredError || err instanceof AiDailyLimitError
          ? err.message
          : AI_FAILED_ERROR,
    }
  }
}

/**
 * Sharpens the career-goals text and writes it straight back.
 *
 * Applying immediately is the point: the button click is the consent, and the
 * service is constrained to rewording what the user already wrote, so there is
 * nothing new to approve. The previous text comes back with the result so the
 * UI can show what changed.
 */
export async function enhanceCareerGoals(): Promise<EnhanceResult | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  const userId = session.user.id

  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }

  const profile = await prisma.careerProfile.findUnique({
    where: { id: owner.profileId },
    select: {
      careerGoals: true,
      targetRoles: {
        where: { active: true },
        select: { title: true },
        orderBy: { priority: "asc" },
        take: CONTEXT_TARGET_ROLES,
      },
    },
  })
  if (!profile) return { error: "Not found" }

  const previous = profile.careerGoals?.trim() ?? ""
  if (!previous) {
    return { error: "Write your career goals first, then enhance them." }
  }

  // Checked last, so a request that was going to fail validation never spends
  // an attempt.
  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.AI_PROFILE_ENHANCE,
    userId,
    ENHANCE_RATE_LIMIT
  )
  if (!allowed) return { error: RATE_LIMITED_ERROR }

  const result = await runEnhance({
    userId,
    field: "careerGoals",
    text: previous,
    context: { targetRoles: profile.targetRoles.map((role) => role.title) },
  })
  if ("error" in result) return { error: result.error }

  if (result.unchanged) {
    return { success: true, previous, enhanced: previous, unchanged: true }
  }

  await prisma.careerProfile.update({
    where: { id: owner.profileId },
    data: { careerGoals: result.improved },
  })

  revalidatePath(CAREER_PROFILE_PATH)
  return { success: true, previous, enhanced: result.improved, unchanged: false }
}

/**
 * Sharpens one evidence row's `details` and writes it straight back.
 *
 * Only `details` is rewritten. `title`, `organization` and `outcome` are handed
 * to the model as read-only context and never overwritten: a title is a factual
 * label and an outcome is where an invented metric would do the most damage.
 * Provenance (`source`, `status`, `confirmedAt`) is untouched, so wording up a
 * candidate row does not promote it.
 */
export async function enhanceEvidence(
  evidenceId: string
): Promise<EnhanceResult | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  const userId = session.user.id

  const owner = await resolveOwnProfileId()
  if ("error" in owner) return { error: owner.error }
  if (!evidenceId) return { error: "Not found" }

  const evidence = await prisma.careerEvidence.findFirst({
    where: { id: evidenceId, careerProfileId: owner.profileId },
    select: { id: true, kind: true, title: true, organization: true, details: true },
  })
  if (!evidence) return { error: "Not found" }

  const previous = evidence.details?.trim() ?? ""
  if (!previous) {
    return { error: "Add some details first, then enhance them." }
  }

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.AI_PROFILE_ENHANCE,
    userId,
    ENHANCE_RATE_LIMIT
  )
  if (!allowed) return { error: RATE_LIMITED_ERROR }

  const result = await runEnhance({
    userId,
    field: "evidenceDetails",
    text: previous,
    context: {
      evidenceKind: evidence.kind,
      evidenceTitle: evidence.title,
      evidenceOrganization: evidence.organization ?? undefined,
    },
  })
  if ("error" in result) return { error: result.error }

  if (result.unchanged) {
    return { success: true, previous, enhanced: previous, unchanged: true }
  }

  const written = await prisma.careerEvidence.updateMany({
    where: { id: evidenceId, careerProfileId: owner.profileId },
    data: { details: result.improved },
  })
  if (written.count === 0) return { error: "Not found" }

  revalidatePath(CAREER_PROFILE_PATH)
  return { success: true, previous, enhanced: result.improved, unchanged: false }
}
