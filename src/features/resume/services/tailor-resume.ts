import { z } from "zod"

import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import type { GroundedKeywords } from "@/shared/lib/evidence-grounding"
import { HUMAN_VOICE_LEXICON } from "@/shared/lib/prompts/human-voice"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"

// ─── Structured output ──────────────────────────────────────────────────────

/**
 * A tailoring pass may touch the whole resume, so the ceiling is higher than
 * the enhance pass — but still bounded, and enforced again by the caller.
 */
export const MAX_TAILOR_SUGGESTIONS = 20

export const jobTailorSuggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        /** Must be one of the target ids supplied in the prompt. */
        targetId: z.string().min(1),
        /**
         * `remove` drops the bullet from the tailored copy instead of
         * rewriting it; `remove-item` drops a whole experience item. Flat enum
         * plus a nullable `suggested`, like the enhance schema — the
         * "suggested present iff rewrite" rule lives in the action's
         * post-processing, where providers cannot get it wrong.
         *
         * Nullable, NOT optional/defaulted: OpenAI's strict structured outputs
         * reject a schema whose `required` misses any property, and both
         * `.optional()` and `.default()` drop the key from `required`. A null
         * `action` still means "rewrite" — `normalizeSuggestions()` below
         * applies that default before the caller ever sees it.
         */
        action: z.enum(["rewrite", "remove", "remove-item"]).nullable(),
        suggested: z.string().nullable(),
        reason: z.string().min(1),
      })
    )
    .max(MAX_TAILOR_SUGGESTIONS),
  /**
   * A professional summary written from the candidate's own resume content,
   * requested ONLY when the source resume has no summary of its own. Null
   * otherwise — the key stays required for the same strict-output reason as
   * `action` above. The caller re-checks it against the barred-term list and
   * drops it if it fails; no summary beats an ungrounded one.
   */
  generatedSummary: z.string().nullable(),
})

/** What a suggestion does to its target. */
export type JobTailorAction = "rewrite" | "remove" | "remove-item"

/** One suggestion after the wire nulls are normalised away. */
export interface JobTailorSuggestion {
  targetId: string
  action: JobTailorAction
  /** Present for a rewrite, absent for a removal. */
  suggested?: string
  reason: string
}

export interface JobTailorSuggestions {
  suggestions: JobTailorSuggestion[]
  /** Absent unless a summary was requested AND the model returned one. */
  generatedSummary?: string
}

/**
 * Turns the wire shape into the shape the caller has always seen: a missing
 * action is a rewrite, and a missing `suggested` is absent rather than null.
 */
function normalizeSuggestions(
  object: z.infer<typeof jobTailorSuggestionsSchema>
): JobTailorSuggestions {
  const generatedSummary = object.generatedSummary?.trim()
  return {
    suggestions: object.suggestions.map((suggestion) => ({
      targetId: suggestion.targetId,
      action: suggestion.action ?? "rewrite",
      ...(suggestion.suggested === null ? {} : { suggested: suggestion.suggested }),
      reason: suggestion.reason,
    })),
    ...(generatedSummary ? { generatedSummary } : {}),
  }
}

/**
 * Which resume field a target is — drives the length rules. `experience` is an
 * a whole experience ITEM, addressable only by `remove-item`; its bullets remain
 * separate `bullet` targets.
 */
export type TailorTargetField = "summary" | "bullet" | "skills" | "experience"

export interface TailorTarget {
  targetId: string
  field: TailorTargetField
  text: string
  /** Human label for the prompt, e.g. "Experience — Acme / Senior Engineer". */
  label?: string
}

export interface JobTailorInput {
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
  targets: TailorTarget[]
  /** From the tracked application — untrusted posting-derived text. */
  jobTitle: string
  companyName: string
  jobDescription?: string
  targetRole?: string
  /**
   * The posting's own terms, already partitioned against the candidate's text
   * by `groundKeywords()`. A term the resume cannot back is a DO-NOT-CLAIM
   * instruction here, never a suggestion to work in.
   */
  groundedKeywords: GroundedKeywords
  /**
   * True when the source resume carries no summary text at all. The model is
   * then asked for `generatedSummary` — written from the resume targets only,
   * never from the posting — which the caller re-grounds before keeping.
   */
  needsSummary?: boolean
}

// ─── Prompt caps ────────────────────────────────────────────────────────────

/** Same editor caps the enhance pass enforces. */
export const MAX_TAILOR_SUMMARY_LENGTH = 500
export const MAX_TAILOR_BULLET_LENGTH = 220
export const MAX_TAILOR_SKILLS_LENGTH = 600

/** The description is the tailoring signal, so it gets more room than enhance. */
const MAX_JOB_DESCRIPTION_LENGTH = 4000
const MAX_TARGET_LENGTH = 200
const MAX_PROMPT_KEYWORDS = 25
const MAX_PROMPT_KEYWORD_LENGTH = 60

function bulletList(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n")
}

function capKeywords(keywords: readonly string[]): string[] {
  return keywords
    .map((keyword) => keyword?.trim())
    .filter((keyword): keyword is string => Boolean(keyword))
    .slice(0, MAX_PROMPT_KEYWORDS)
    .map((keyword) => keyword.slice(0, MAX_PROMPT_KEYWORD_LENGTH))
}

// ─── Main generator ─────────────────────────────────────────────────────────

/**
 * Asks the model to tailor the copied resume text toward one tracked job:
 * select (drop irrelevant bullets, or a whole unrelated experience item),
 * reorder emphasis and rephrase — never add. When the resume has no summary of
 * its own it may also condense one out of the supplied targets.
 * Returns the raw (schema-valid) model output — the caller resolves
 * `targetId`s, enforces the length caps and re-checks grounding
 * deterministically.
 */
export async function generateJobTailorSuggestions(
  input: JobTailorInput
): Promise<JobTailorSuggestions> {
  const promptParts: string[] = []

  promptParts.push(
    `Target job: ${input.jobTitle.slice(0, MAX_TARGET_LENGTH)} at ${input.companyName.slice(0, MAX_TARGET_LENGTH)}`
  )
  if (input.targetRole) {
    promptParts.push(`Candidate's target role: ${input.targetRole.slice(0, MAX_TARGET_LENGTH)}`)
  }

  const jobDescription = input.jobDescription?.trim().slice(0, MAX_JOB_DESCRIPTION_LENGTH)
  if (jobDescription) {
    promptParts.push(
      `Job description — tailor the wording toward the requirements, responsibilities and vocabulary it uses:\n${fenceUntrusted(
        "JOB_DESCRIPTION",
        jobDescription
      )}`
    )
  }

  const supportedKeywords = capKeywords(input.groundedKeywords.supported)
  const barredKeywords = capKeywords([
    ...input.groundedKeywords.unsupported,
    ...input.groundedKeywords.ambiguous,
  ])

  const keywordSections = [
    "Terms the job posting uses, already checked against this candidate's own resume text. The classification is authoritative — do not second-guess it from the job description.",
  ]
  if (supportedKeywords.length > 0) {
    keywordSections.push(
      `SUPPORTED (the resume backs these — surface them where they genuinely fit, without keyword-stuffing):\n${bulletList(
        supportedKeywords
      )}`
    )
  }
  if (barredKeywords.length > 0) {
    keywordSections.push(
      `DO NOT CLAIM (the resume does not back these). They MUST NOT appear in any rewritten text in any form, however strongly the posting asks for them. Adding one is a false statement on a job application:\n${bulletList(
        barredKeywords
      )}`
    )
  }
  if (keywordSections.length > 1) {
    promptParts.push(keywordSections.join("\n\n"))
  }

  promptParts.push(
    `Tailorable resume text. Each entry is "<targetId> | <field> | <label>" followed by its current text:\n${fenceUntrusted(
      "RESUME_TARGETS",
      input.targets
        .map(
          (target) =>
            `${target.targetId} | ${target.field} | ${target.label ?? "—"}\n${target.text}`
        )
        .join("\n\n")
    )}`
  )

  const { object } = await generateObjectTracked({
    schema: jobTailorSuggestionsSchema,
    tracking: {
      feature: AI_USAGE_FEATURES.RESUME_TAILOR,
      surface: "app",
      userId: input.userId,
    },
    system: [
      "You are an expert resume writer tailoring an existing resume to one specific job posting. You may SELECT (drop bullets, or a whole experience item, that does not serve this application), REORDER emphasis within a piece of text, and REPHRASE toward the posting's vocabulary. You may NEVER add experience, skills, tools, credentials or facts the resume does not already contain.",
      "",
      UNTRUSTED_CONTENT_RULES,
      "",
      'OUTPUT FORMAT: Respond with ONLY a valid JSON object using EXACTLY this camelCase shape — no extra fields, no markdown: { "suggestions": [{ "targetId": "<one of the supplied target ids>", "action": "rewrite" | "remove" | "remove-item", "suggested": "<the rewritten text, or null for remove and remove-item>", "reason": "<one short sentence naming what in the posting this serves>" }], "generatedSummary": <string or null> }',
      "EVERY field above is required on every suggestion — never omit a key. Use null for `suggested` instead of leaving it out. `generatedSummary` is also always required at the top level.",
      "",
      `Return AT MOST ${MAX_TAILOR_SUGGESTIONS} suggestions in total (rewrites and removals combined), at most one per targetId, ordered by impact. Do NOT invent target ids. Do NOT return a suggestion that is identical to the current text. A target you leave untouched is kept as it is — return an empty array if nothing should change.`,
      "",
      "GROUNDING — THIS IS THE MOST IMPORTANT RULE: use ONLY facts present in the target text. NEVER invent specific numbers, percentages, dollar amounts, team sizes, dates, employers or technologies that the input does not contain. Quantify only where a figure is already given; otherwise phrase the impact without a number rather than guessing one.",
      "GROUNDING AND THE JOB POSTING: a requirement in the posting is evidence about the EMPLOYER, never about the candidate. A skill, technology, tool, certification or responsibility may only appear in a rewrite if the candidate's own text already shows it. Anything listed under DO NOT CLAIM is barred outright; leave the gap visible rather than filling it.",
      "",
      'REMOVAL: use `action: "remove"` ONLY for bullet targets — their ids contain "::b" — and ONLY when the bullet is clearly irrelevant to this job: an unrelated duty, filler with no substance, or content already covered by another bullet. Set `suggested` to null for a removal, and make the `reason` name why that bullet does not serve this application.',
      "REMOVAL GUARDRAILS: never propose removing a bullet that carries a term from the posting or the SUPPORTED list, and never one that carries a quantified result. Never propose so many removals that an experience item is left with fewer than 2 bullets. Prefer a rewrite over a removal whenever the content is salvageable.",
      'REMOVAL SCOPE: `action: "remove"` applies to bullets only. NEVER use it on a summary, skills or experience-item target.',
      "",
      'ITEM REMOVAL: use `action: "remove-item"` ONLY on an `experience` target — a whole job entry — and ONLY when that entire role is clearly unrelated to this posting (a different field of work whose bullets carry nothing the posting asks for). Set `suggested` to null and make the `reason` name why the whole role does not serve this application.',
      "ITEM REMOVAL GUARDRAILS: this is a strong action — prefer dropping individual bullets. Never propose removing every experience item; at least one role must survive, and the most recent role should normally stay even when the match is imperfect. Never remove a role whose bullets carry a SUPPORTED term or a quantified result. When in doubt, keep the role and trim its bullets instead.",
      "",
      "STYLE: write every rewritten bullet in the Action–Result–Reason framework — open with the Action (a strong action verb plus what was done), then the Result, then the Reason it mattered. Plain professional English, active voice, no first-person pronouns in bullets, no buzzword filler. Use ATS-friendly wording: real skill, credential and tool names, no tables, no special characters beyond ordinary punctuation.",
      HUMAN_VOICE_LEXICON,
      "ARR AND GROUNDING: the Result clause obeys the grounding rule above — state the Result qualitatively when the source gives no figure; never invent numbers for it. The Reason clause must likewise come from the target text, never from assumption.",
      "",
      "BE SPECIFIC, NOT VAGUE — a rewrite that says less than the original is a failed rewrite. Carry over the concrete detail the source already gives: the named systems, tools, products, scale, scope and any figure it states. Keep every number the source contains. Name the thing that was built, fixed or run instead of describing it in the abstract.",
      'BANNED FILLER: never write generic self-description such as "results-driven professional", "team player", "hard worker", "detail-oriented", "proven track record", "passionate about", "dynamic", "synergy", "leveraged synergies", "wide range of", "various technologies", "responsible for" or "helped with". If a phrase would fit on anyone\'s resume, it does not belong on this one.',
      "VOCABULARY ALIGNMENT: match the posting's terminology ONLY for a term the candidate's own text already backs — a SUPPORTED term, or a plain rewording of something the target text already says. Never reach for the posting's phrasing to describe work the resume does not show.",
      "",
      `SUMMARY TARGETS: 2-3 sentences aimed at this job, at most ${MAX_TAILOR_SUMMARY_LENGTH} characters. Not a bullet — no Action–Result–Reason framing.`,
      `BULLET TARGETS: ONE single-line bullet of at most ${MAX_TAILOR_BULLET_LENGTH} characters. The complete bullet MUST fit inside ${MAX_TAILOR_BULLET_LENGTH} characters — if it will not, drop the Reason clause and keep Action and Result. Do NOT prefix it with "-", "•" or any other bullet glyph.`,
      `SKILLS TARGETS: return the SAME comma-separated list reordered so the skills most relevant to this job come first — at most ${MAX_TAILOR_SKILLS_LENGTH} characters. NEVER remove, rename or add a skill (reordering is the only change allowed; the removal action is for bullets only and must never be used here). No categories, no prose, no bullet glyphs — just the list.`,
      "EXPERIENCE-ITEM TARGETS: these exist only so you can drop a whole role. Never return a rewrite for one.",
      ...(input.needsSummary
        ? [
            "",
            `GENERATED SUMMARY: this resume has no summary of its own, so write one in \`generatedSummary\` — 2-3 sentences, at most ${MAX_TAILOR_SUMMARY_LENGTH} characters, aimed at this job. Build it ONLY from the supplied resume targets: the candidate's own titles, bullets and skills. It is a condensation of what is already there, not a new claim.`,
            "GENERATED SUMMARY GROUNDING: the posting tells you what to EMPHASISE from the resume, never what to say about the candidate. Every role, technology, domain and figure in the summary must already appear in the resume targets. Nothing from DO NOT CLAIM may appear in any form. Lead with the candidate's actual title and years/scope if the targets show them, name their real tools and domains, and skip the generic opener entirely. If the targets are too thin to say anything specific, return null rather than filler.",
          ]
        : ["`generatedSummary` MUST be null: this resume already has a summary target, which you rewrite through `suggestions` like any other target."]),
    ].join("\n"),
    prompt: promptParts.join("\n\n"),
  })

  return normalizeSuggestions(object)
}
