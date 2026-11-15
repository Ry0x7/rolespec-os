import { z } from "zod"

import type { CareerEvidenceKind } from "@/generated/prisma/enums"
import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import { HUMAN_VOICE_LEXICON } from "@/shared/lib/prompts/human-voice"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"
import { EVIDENCE_KIND_LABELS } from "../constants/labels"

// ─── Field caps ─────────────────────────────────────────────────────────────

/** `updateCareerPreferencesSchema.careerGoals` */
export const MAX_CAREER_GOALS_LENGTH = 5000
/** `createEvidenceSchema.details` */
export const MAX_EVIDENCE_DETAILS_LENGTH = 5000

/** How many active target roles are worth spending prompt space on. */
const MAX_CONTEXT_TARGET_ROLES = 5
const MAX_CONTEXT_TEXT_LENGTH = 200

/** Which profile field is being tightened — drives the field-specific rules. */
export type EnhanceProfileField = "careerGoals" | "evidenceDetails"

/**
 * Required-and-nullable rather than optional: strict structured outputs demand
 * that every property appears in `required`, and `.optional()` drops it.
 */
export const enhancedTextSchema = z.object({
  /** The tightened text. Null when nothing could be improved. */
  improved: z.string().nullable(),
  /** True when the input was already clear enough, or too thin to work with. */
  unchanged: z.boolean(),
})

export interface EnhanceProfileTextInput {
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
  field: EnhanceProfileField
  /** The text as the user wrote it. */
  text: string
  /** Read-only context. Never a source of new facts for the rewrite. */
  context?: {
    evidenceKind?: CareerEvidenceKind
    evidenceTitle?: string
    evidenceOrganization?: string
    targetRoles?: string[]
  }
}

export interface EnhanceProfileTextResult {
  /** Always safe to write back: equals the input when `unchanged` is true. */
  improved: string
  unchanged: boolean
}

const MAX_LENGTH: Record<EnhanceProfileField, number> = {
  careerGoals: MAX_CAREER_GOALS_LENGTH,
  evidenceDetails: MAX_EVIDENCE_DETAILS_LENGTH,
}

const FIELD_RULES: Record<EnhanceProfileField, string> = {
  careerGoals: `CAREER GOALS: a short statement of the direction this person wants to move in, written in the first person as they wrote it. Keep it to at most ${MAX_CAREER_GOALS_LENGTH} characters and prefer a few tight sentences over a list. Name only the direction, role or scope the input already names — never add a target title, industry, company, timeline or seniority the input does not state.`,
  evidenceDetails: `EVIDENCE DETAILS: a factual description of what this person actually did. Keep it to at most ${MAX_EVIDENCE_DETAILS_LENGTH} characters, in plain professional English. Keep every fact, and only the facts, that the input contains — no invented numbers, percentages, team sizes, dates, employers, tools or technologies.`,
}

/**
 * Tightens one piece of text the user already wrote.
 *
 * This is a clarity pass, not a content pass: the model may only fix vagueness,
 * grammar and weak phrasing in what is already there. Adding a fact is the one
 * thing it must never do — the result is written straight back to the profile,
 * and a profile is the evidence base every other feature is grounded against.
 *
 * `tier: "light"` because rewording one short field does not need the flagship
 * model.
 */
export async function enhanceProfileText(
  input: EnhanceProfileTextInput
): Promise<EnhanceProfileTextResult> {
  const maxLength = MAX_LENGTH[input.field]
  const original = input.text.trim()

  const promptParts: string[] = []

  const context = input.context
  if (context?.evidenceKind) {
    promptParts.push(`Evidence type: ${EVIDENCE_KIND_LABELS[context.evidenceKind]}`)
  }
  if (context?.evidenceTitle) {
    promptParts.push(`Evidence title: ${context.evidenceTitle.slice(0, MAX_CONTEXT_TEXT_LENGTH)}`)
  }
  if (context?.evidenceOrganization) {
    promptParts.push(
      `Organization: ${context.evidenceOrganization.slice(0, MAX_CONTEXT_TEXT_LENGTH)}`
    )
  }
  const targetRoles = (context?.targetRoles ?? [])
    .slice(0, MAX_CONTEXT_TARGET_ROLES)
    .map((role) => role.slice(0, MAX_CONTEXT_TEXT_LENGTH))
  if (targetRoles.length > 0) {
    promptParts.push(
      `Roles this person is targeting (context for tone only — NOT facts about them, and NOT permission to claim any of it):\n${targetRoles
        .map((role) => `- ${role}`)
        .join("\n")}`
    )
  }

  promptParts.push(
    `Text to tighten:\n${fenceUntrusted("PROFILE_TEXT", original.slice(0, maxLength))}`
  )

  const { object } = await generateObjectTracked({
    schema: enhancedTextSchema,
    tier: "light",
    tracking: {
      feature: AI_USAGE_FEATURES.PROFILE_ENHANCE,
      surface: "app",
      userId: input.userId,
    },
    system: [
      "You are an editor tightening one field of a job seeker's own career profile. You rewrite their words; you never write new ones.",
      "",
      UNTRUSTED_CONTENT_RULES,
      "",
      'OUTPUT FORMAT: Respond with ONLY a valid JSON object using EXACTLY this camelCase shape — no extra fields, no markdown: { "improved": "<the tightened text, or null>", "unchanged": true | false }',
      "Both keys are required on every response. Never omit a key.",
      "",
      "GROUNDING — THIS IS THE MOST IMPORTANT RULE: the output must contain no fact that the input does not already contain. Never add or sharpen a number, percentage, duration, date, team size, budget, employer, job title, tool, technology, certification or skill. If the input says 'improved performance', it stays qualitative — you may not turn it into 'improved performance by 30%'. Removing a fact is equally wrong: keep every claim the input makes.",
      "WHAT YOU MAY DO: fix grammar, spelling and punctuation; replace vague or weak phrasing with a precise wording of the SAME claim; cut filler, hedging and repetition; make the voice active and professional; fix the ordering so the point comes first.",
      "",
      'WHEN TO LEAVE IT ALONE: if the text is already clear, or is too thin for a rewrite to add clarity without inventing something (a fragment, a couple of words, a placeholder), set "unchanged": true and return the input verbatim as "improved" (or null). Returning the text unchanged is always better than padding it.',
      "",
      HUMAN_VOICE_LEXICON,
      "STYLE: plain professional English. No buzzword filler such as 'results-driven professional', 'passionate about', 'synergy' or 'leverage'. No markdown, no bullet glyphs, no headings, no quotation marks around the whole answer. Keep the same point of view the input uses.",
      "",
      FIELD_RULES[input.field],
    ].join("\n"),
    prompt: promptParts.join("\n\n"),
  })

  const improved = (object.improved ?? "").trim().slice(0, maxLength).trim()

  // The `unchanged` flag is the model's opinion; these checks are the contract.
  // Anything empty, identical or missing falls back to the user's own text, so
  // the caller never has to guard against an enhance that quietly erased a field.
  if (object.unchanged || !improved || improved === original) {
    return { improved: original, unchanged: true }
  }

  return { improved, unchanged: false }
}
