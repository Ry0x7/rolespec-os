"use server"

import { z } from "zod"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { rateLimited } from "@/shared/lib/errors"
import {
  RATE_LIMIT_BUCKETS,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"
import {
  MAX_ENHANCE_JOB_DESCRIPTION_LENGTH,
  MAX_ENHANCE_LABEL_LENGTH,
  MAX_ENHANCE_TARGET_TEXT_LENGTH,
  MAX_ENHANCE_TARGETS,
} from "../constants/enhance"
import { generateATSEnhanceSuggestions } from "../services/enhance-ats"
import { serializeSections } from "../lib/serialize-sections"
import { stripInternalRefs } from "../lib/enhance-reason"
import type { Section } from "../hooks/use-resume-store"
import {
  findIntroducedKeywords,
  groundKeywords,
  stripIntroducedSkills,
  type KeywordEvidence,
} from "@/shared/lib/evidence-grounding"
import { logger } from "@/shared/lib/logger"

const log = logger("resume-enhance")

/** Sliding window for the per-user enhance rate limit. */
const ENHANCE_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }

export type EnhanceResumeErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "VALIDATION"
  | "NO_ANALYSIS"
  | "RATE_LIMITED"
  | "AI_FAILED"

/** What the model proposes doing with a target: rewrite its text, or drop it. */
export type EnhanceSuggestionAction = "rewrite" | "remove"

/** One resolved suggestion, keyed by the targetId the caller supplied. */
export interface EnhanceSuggestionResult {
  targetId: string
  action: EnhanceSuggestionAction
  /** Present for a rewrite, absent for a removal. */
  suggested?: string
  reason: string
}

/** Bullet target ids look like `<sectionId>::<itemId>::b<index>`. */
const BULLET_TARGET_ID = /::b\d+$/

const MAX_TARGET_ID_LENGTH = 200
const MAX_ATS_FINDINGS = 40
const MAX_ATS_TEXT_LENGTH = 1000
const MAX_MISSING_KEYWORDS = 40
const MAX_MISSING_KEYWORD_LENGTH = 120
const MAX_REASON_LENGTH = 240

/** Mirrors the editor caps enforced in the prompt. */
const MAX_SUMMARY_LENGTH = 500
const MAX_BULLET_LENGTH = 220
const MAX_SKILLS_LENGTH = 600

const MAX_SUGGESTED_LENGTH: Record<"summary" | "bullet" | "skills", number> = {
  summary: MAX_SUMMARY_LENGTH,
  bullet: MAX_BULLET_LENGTH,
  skills: MAX_SKILLS_LENGTH,
}

/** Leading list glyphs the model sometimes prefixes bullets with. */
const LEADING_GLYPHS = /^[\s\-–—•*·▪◦]+/

const targetSchema = z.object({
  targetId: z.string().min(1).max(MAX_TARGET_ID_LENGTH),
  field: z.enum(["summary", "bullet", "skills"]),
  text: z.string().max(MAX_ENHANCE_TARGET_TEXT_LENGTH),
  label: z.string().max(MAX_ENHANCE_LABEL_LENGTH).optional(),
})

const atsIssueSchema = z.object({
  severity: z.enum(["critical", "warning", "info"]),
  category: z.string().max(120),
  message: z.string().max(MAX_ATS_TEXT_LENGTH),
  section: z.string().max(120).optional(),
  suggestion: z.string().max(MAX_ATS_TEXT_LENGTH).optional(),
})

const atsSuggestionSchema = z.object({
  category: z.string().max(120),
  title: z.string().max(300),
  description: z.string().max(MAX_ATS_TEXT_LENGTH),
  priority: z.enum(["high", "medium", "low"]),
})

const atsScoreSchema = z.number().min(0).max(100)

const atsScoresSchema = z.object({
  formatting: atsScoreSchema,
  // `null` when the analysis ran in quality mode — no job description, so no
  // keyword sub-score exists.
  keywords: atsScoreSchema.nullable(),
  impact: atsScoreSchema,
  completeness: atsScoreSchema,
  readability: atsScoreSchema,
})

const enhanceInputSchema = z.object({
  resumeId: z.string().min(1),
  targets: z.array(targetSchema).min(1).max(MAX_ENHANCE_TARGETS),
  ats: z.object({
    /** From the latest analysis — lets the prompt target the weakest categories. */
    overallScore: atsScoreSchema.optional(),
    scores: atsScoresSchema.optional(),
    issues: z.array(atsIssueSchema).max(MAX_ATS_FINDINGS),
    suggestions: z.array(atsSuggestionSchema).max(MAX_ATS_FINDINGS),
    missingKeywords: z
      .array(z.string().max(MAX_MISSING_KEYWORD_LENGTH))
      .max(MAX_MISSING_KEYWORDS)
      .optional(),
  }),
  jobDescription: z.string().max(MAX_ENHANCE_JOB_DESCRIPTION_LENGTH).optional(),
  /** Limits the run to one section of this resume, addressed by id. */
  focus: z
    .object({ sectionId: z.string().trim().min(1).max(MAX_TARGET_ID_LENGTH) })
    .optional(),
})

export type EnhanceResumeInput = z.input<typeof enhanceInputSchema>

/**
 * Single global enhance pass: rewrites the resume text that the latest ATS
 * analysis flags, and may propose removing bullets that do not align with the
 * target job. Nothing is applied here — applying or reverting an individual
 * suggestion afterwards is free of any further AI call.
 */
export async function enhanceResumeFromATS(input: EnhanceResumeInput): Promise<
  | {
      success: true
      suggestions: EnhanceSuggestionResult[]
      /**
       * Job requirements this resume could not back, with the reason. Only
       * `ambiguous` and `unsupported` verdicts appear here — a supported
       * requirement needs no explanation.
       */
      grounding: KeywordEvidence[]
    }
  | { success: false; error: string; code: EnhanceResumeErrorCode }
> {
  const session = await auth()
  if (!session?.user) {
    return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" }
  }

  const userId = session.user.id

  // ── Validate input ────────────────────────────────────────────────────────
  const parsed = enhanceInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION" }
  }
  const { resumeId, ats, jobDescription, focus } = parsed.data

  // Only text that actually exists can be rewritten.
  const targets = parsed.data.targets
    .map((target) => ({ ...target, text: target.text.trim() }))
    .filter((target) => target.text.length > 0)
  if (targets.length === 0) {
    return {
      success: false,
      error: "Nothing to enhance yet — write a summary or some bullets first.",
      code: "VALIDATION",
    }
  }

  // The whole point of this flow is to act on ATS findings, so require at least
  // one signal from the latest analysis.
  const missingKeywords = ats.missingKeywords ?? []
  const hasAnalysis =
    ats.issues.length > 0 || ats.suggestions.length > 0 || missingKeywords.length > 0
  if (!hasAnalysis) {
    return {
      success: false,
      error: "Run Analyze first so there are ATS findings to work from.",
      code: "NO_ANALYSIS",
    }
  }

  // ── Ownership ─────────────────────────────────────────────────────────────
  // Archived (soft-deleted) resumes are treated as gone, same as a foreign id.
  const resume = await prisma.resume.findUnique({
    where: { id: resumeId, userId, status: { not: "ARCHIVED" } },
    include: {
      sections: { include: { items: true }, orderBy: { order: "asc" } },
    },
  })
  if (!resume) {
    return { success: false, error: "Resume not found", code: "NOT_FOUND" }
  }

  // A focus must name one of this resume's own sections, and that section must
  // hold text to rewrite — checked before the rate limit so a bad focus never
  // spends an attempt.
  if (focus) {
    const sectionExists = (resume.sections ?? []).some(
      (section) => section.id === focus.sectionId
    )
    if (!sectionExists) {
      return { success: false, error: "Invalid input", code: "VALIDATION" }
    }
    if (!targets.some((target) => target.targetId.startsWith(`${focus.sectionId}::`))) {
      return {
        success: false,
        error: "Nothing to enhance in that section yet.",
        code: "VALIDATION",
      }
    }
  }

  // ── Evidence grounding ────────────────────────────────────────────────────
  // A missing keyword is, by definition, something this resume does not say —
  // handing that list to the model as "keywords to work in" is how a posting's
  // JPQL or JMS becomes a claimed skill. Classify each one against the
  // candidate's own words first. The evidence base is deliberately wide (the
  // stored resume plus the targets, which carry edits the last autosave may not
  // have persisted yet) because it is only ever used to WITHHOLD a claim.
  const evidenceText = [
    serializeSections((resume.sections ?? []) as unknown as Section[]),
    ...targets.map((target) => target.text),
  ].join("\n")
  const grounded = groundKeywords(missingKeywords, evidenceText)
  const barredKeywords = [...grounded.unsupported, ...grounded.ambiguous]

  // ── Rate limit: max 10 enhance runs per user per 10 minutes ───────────────
  // Enhancing is free, so there is no artifact row to count — the shared
  // rate_limit_attempts table carries the window instead. Checked last, so a
  // request that was going to fail validation never spends an attempt.
  const enhanceAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.AI_RESUME_ENHANCE,
    userId,
    ENHANCE_RATE_LIMIT
  )
  if (!enhanceAllowed) {
    const err = rateLimited(
      "Too many enhance runs. Please wait a few minutes and try again."
    )
    return { success: false, error: err.message, code: "RATE_LIMITED" }
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  let raw: EnhanceSuggestionResult[]
  try {
    const result = await generateATSEnhanceSuggestions({
      userId,
      targets,
      issues: ats.issues,
      suggestions: ats.suggestions,
      overallScore: ats.overallScore,
      scores: ats.scores,
      groundedKeywords: grounded,
      jobDescription,
      targetRole: resume.targetRole ?? undefined,
      targetCompany: resume.targetCompany ?? undefined,
      ...(focus ? { focus, sections: resume.sections ?? [] } : {}),
    })
    raw = result.suggestions
  } catch (err) {
    log.error("AI suggestion generation failed", { err })
    return {
      success: false,
      // The key and daily-limit messages are actionable and safe to show; anything
      // else could carry provider/infra detail, so it stays in the log above.
      error:
        err instanceof AiKeyRequiredError || err instanceof AiDailyLimitError
          ? err.message
          : "AI enhance failed. Please try again.",
      code: "AI_FAILED",
    }
  }

  // ── Post-process: resolve target ids, cap lengths, drop no-ops ────────────
  const targetsById = new Map(targets.map((target) => [target.targetId, target]))
  const allTargetIds = targets.map((target) => target.targetId)
  const seen = new Set<string>()
  const suggestions: EnhanceSuggestionResult[] = []

  for (const candidate of raw) {
    const target = targetsById.get(candidate.targetId)
    if (!target) continue
    if (seen.has(candidate.targetId)) continue

    const reasonText = stripInternalRefs(candidate.reason, allTargetIds)
      .trim()
      .slice(0, MAX_REASON_LENGTH)
    if (!reasonText) continue

    // ── Removals: bullets only, no suggested text to clean up ───────────────
    if (candidate.action === "remove") {
      // Skills stay append-only and a summary is never dropped wholesale, so a
      // removal is only honoured for a real bullet target.
      if (target.field !== "bullet") continue
      if (!BULLET_TARGET_ID.test(candidate.targetId)) continue

      seen.add(candidate.targetId)
      suggestions.push({
        targetId: candidate.targetId,
        action: "remove",
        reason: reasonText,
      })
      continue
    }

    let suggested = (candidate.suggested ?? "").trim()
    if (target.field === "bullet") suggested = suggested.replace(LEADING_GLYPHS, "")
    suggested = suggested.slice(0, MAX_SUGGESTED_LENGTH[target.field]).trim()

    // ── Enforce the grounding rule, do not merely request it ────────────────
    // The prompt bars every ungrounded requirement, but the prompt is not the
    // control. A skills list is repaired surgically (each entry is its own
    // claim); prose cannot be, so a summary or bullet that smuggled one in is
    // dropped whole rather than shown to the user for one-click acceptance.
    if (barredKeywords.length > 0) {
      if (target.field === "skills") {
        const { skills, removed } = stripIntroducedSkills(
          target.text,
          suggested,
          barredKeywords
        )
        if (removed.length > 0) {
          log.warn("Dropped ungrounded skills from an enhance suggestion", {
            targetId: candidate.targetId,
            removed,
          })
          suggested = skills.trim()
        }
      } else {
        const introduced = findIntroducedKeywords(
          target.text,
          suggested,
          barredKeywords
        )
        if (introduced.length > 0) {
          log.warn("Discarded an enhance suggestion that claimed ungrounded skills", {
            targetId: candidate.targetId,
            field: target.field,
            introduced,
          })
          continue
        }
      }
    }

    if (!suggested) continue
    if (suggested === target.text) continue

    seen.add(candidate.targetId)
    suggestions.push({
      targetId: candidate.targetId,
      action: "rewrite",
      suggested,
      reason: reasonText,
    })
  }

  // Requirements the resume could not back are reported rather than silently
  // swallowed: the user is the only one who can resolve them, either by adding
  // the real evidence to the resume or by leaving the gap alone.
  const grounding = grounded.details.filter((detail) => detail.verdict !== "supported")

  return { success: true, suggestions, grounding }
}
