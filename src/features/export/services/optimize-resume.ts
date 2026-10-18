import { z } from "zod"

import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import type { Section } from "../types"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import {
  findIntroducedKeywords,
  groundKeywords,
  type GroundedKeywords,
} from "@/shared/lib/evidence-grounding"
import { logger } from "@/shared/lib/logger"
import { HUMAN_VOICE_LEXICON } from "@/shared/lib/prompts/human-voice"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"

const log = logger("optimize-resume")

// ─── Structured output ──────────────────────────────────────────────────────

/**
 * Superset of every section-item content shape in `../types`. The model may
 * only return these keys; anything else is stripped, and any key the model
 * omits falls back to the original value (see `mergeContent`), so unknown
 * fields written by the editor survive an optimization pass untouched.
 *
 * Every key is `.nullable()`, NOT `.optional()`/`.nullish()`: OpenAI's strict
 * structured outputs reject a schema whose `required` misses any property, and
 * `.optional()`, `.default()` and `.nullish()` all drop the key from `required`.
 * A nullable key stays in `required` and expresses "not set" as an explicit
 * `null`, which `mergeContent()` normalises away at the service boundary so the
 * merged content the caller receives is unchanged.
 */
export const optimizedContentSchema = z.object({
  // CONTACT
  fullName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  linkedin: z.string().nullable(),
  github: z.string().nullable(),
  website: z.string().nullable(),
  // SUMMARY
  text: z.string().nullable(),
  placeholder: z.string().nullable(),
  // EXPERIENCE
  company: z.string().nullable(),
  role: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  current: z.boolean().nullable(),
  bullets: z.array(z.string()).nullable(),
  // EDUCATION
  school: z.string().nullable(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
  gpa: z.string().nullable(),
  // SKILLS
  category: z.string().nullable(),
  skills: z.array(z.string()).nullable(),
  // PROJECTS
  name: z.string().nullable(),
  technologies: z.array(z.string()).nullable(),
  url: z.string().nullable(),
  urlLabel: z.string().nullable(),
  // CERTIFICATIONS
  organization: z.string().nullable(),
  dateObtained: z.string().nullable(),
  expirationDate: z.string().nullable(),
  credentialId: z.string().nullable(),
  // CUSTOM
  title: z.string().nullable(),
  content: z.string().nullable(),
})

export const optimizedSectionsSchema = z.object({
  sections: z.array(
    z.object({
      id: z.string().min(1),
      items: z.array(
        z.object({
          id: z.string().min(1),
          content: optimizedContentSchema,
        })
      ),
    })
  ),
})

export type OptimizedSections = z.infer<typeof optimizedSectionsSchema>

// ─── ATS context ────────────────────────────────────────────────────────────

export interface OptimizeATSIssue {
  severity: "critical" | "warning" | "info"
  category: string
  message: string
  section?: string
  suggestion?: string
}

export interface OptimizeResumeOptions {
  /** Owner of the export, recorded with the call's token usage. */
  userId: string
  targetRole?: string | null
  targetCompany?: string | null
  /** From the resume's latest ATSAnalysis (`suggestions.missingKeywords`). */
  missingKeywords?: string[] | null
  /** From the resume's latest ATSAnalysis (`issues`), highest severity first. */
  atsIssues?: OptimizeATSIssue[] | null
}

/**
 * Why an optimization pass produced the original sections instead of rewritten
 * ones. `ai_key_required` is the actionable one — the caller can tell the user
 * to configure a key — everything else is a generic soft failure.
 */
export type OptimizeFallbackReason = "ai_key_required" | "ai_daily_limit" | "failed"

export interface OptimizeResumeResult {
  sections: Section[]
  /** False when `sections` is the untouched input (fail-soft path). */
  optimized: boolean
  reason?: OptimizeFallbackReason
}

const MAX_MISSING_KEYWORDS = 20
const MAX_MISSING_KEYWORD_LENGTH = 60
const MAX_ATS_ISSUES = 12
/** Both targets are free-text fields; neither may grow into the prompt. */
const MAX_TARGET_LENGTH = 200

function capKeywords(keywords: string[] | null | undefined): string[] {
  return (keywords ?? [])
    .map((keyword) => keyword?.trim())
    .filter((keyword): keyword is string => Boolean(keyword))
    .slice(0, MAX_MISSING_KEYWORDS)
    .map((keyword) => keyword.slice(0, MAX_MISSING_KEYWORD_LENGTH))
}

// ─── Serialize sections for context ─────────────────────────────────────────

function serializeSectionsForPrompt(sections: Section[]): string {
  return JSON.stringify(
    sections.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      order: s.order,
      visible: s.visible,
      items: s.items.map((i) => ({
        id: i.id,
        content: i.content,
        order: i.order,
      })),
    })),
    null,
    2
  )
}

/**
 * Plain text of everything the candidate has written, for the evidence check.
 * Deliberately separate from `serializeSectionsForPrompt`: this one needs the
 * words only, not the ids or the JSON structure.
 */
function serializeSectionsForEvidence(sections: Section[]): string {
  const out: string[] = []
  for (const section of sections) {
    out.push(section.title)
    for (const item of section.items) out.push(contentText(item.content))
  }
  return out.join("\n")
}

/** The three-way keyword block, or "" when there is nothing to say. */
function formatGroundedKeywords(grounded: GroundedKeywords): string {
  const blocks: string[] = []

  if (grounded.supported.length > 0) {
    blocks.push(
      `SUPPORTED (this resume backs these — keep and surface them where they already fit):\n${bulletList(
        grounded.supported
      )}`
    )
  }
  if (grounded.ambiguous.length > 0) {
    blocks.push(
      `NEEDS CONFIRMATION (only partial evidence). Keep the evidence the resume already contains; do NOT assert the requirement itself:\n${bulletList(
        grounded.ambiguous
      )}`
    )
  }
  if (grounded.unsupported.length > 0) {
    blocks.push(
      `DO NOT CLAIM (nothing in this resume supports them). These MUST NOT appear anywhere in your output, however strongly the target role suggests them. Adding one is a false statement on a job application:\n${bulletList(
        grounded.unsupported
      )}`
    )
  }

  if (blocks.length === 0) return ""

  return [
    "ATS keywords the target role asks for, already checked against this candidate's own resume text. The classification is authoritative:",
    ...blocks,
  ].join("\n\n")
}

function bulletList(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n")
}

/** Every string inside an item's content, flattened for the evidence check. */
function contentText(content: Record<string, unknown>): string {
  const out: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === "object") Object.values(value).forEach(walk)
  }
  walk(content)
  return out.join("\n")
}

// ─── Merge ──────────────────────────────────────────────────────────────────

/**
 * Overlays only the keys the model actually returned, so content fields the
 * schema does not know about are preserved for the export templates. `null` is
 * treated exactly like an omitted key — strict-mode structured output uses it
 * to mean "not set" — so no null can leak into merged content.
 *
 * This is the service boundary that normalises the wire shape: the schema is
 * all-nullable-required for OpenAI strict mode, and every null is dropped here
 * so the merged content is identical to what the caller has always received.
 */
function mergeContent(
  original: Record<string, unknown>,
  optimized: z.infer<typeof optimizedContentSchema>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...original }
  for (const [key, value] of Object.entries(optimized)) {
    if (value !== undefined && value !== null) merged[key] = value
  }
  return merged
}

// ─── Main optimization function ─────────────────────────────────────────────

/**
 * Rewrites resume copy for impact before an export. Fails soft: any model or
 * validation failure returns the ORIGINAL sections so the export still runs,
 * with `optimized: false` plus a `reason` so the caller can say so out loud
 * instead of reporting a fully optimized export.
 */
export async function optimizeResume(
  sections: Section[],
  options: OptimizeResumeOptions
): Promise<OptimizeResumeResult> {
  const promptParts = [
    `Resume sections (JSON):\n${fenceUntrusted(
      "RESUME_SECTIONS_JSON",
      serializeSectionsForPrompt(sections)
    )}`,
  ]

  if (options?.targetRole) {
    promptParts.push(`Target role: ${options.targetRole.slice(0, MAX_TARGET_LENGTH)}`)
  }

  if (options?.targetCompany) {
    promptParts.push(
      `Target company: ${options.targetCompany.slice(0, MAX_TARGET_LENGTH)}`
    )
  }

  const atsIssues = (options?.atsIssues ?? []).slice(0, MAX_ATS_ISSUES)
  if (atsIssues.length > 0) {
    promptParts.push(
      `ATS issues found on this resume:\n${atsIssues
        .map(
          (issue) =>
            `- [${issue.severity}/${issue.category}${issue.section ? ` @ ${issue.section}` : ""}] ${issue.message}${
              issue.suggestion ? ` (fix: ${issue.suggestion})` : ""
            }`
        )
        .join("\n")}`
    )
  }

  // ── Evidence grounding ────────────────────────────────────────────────────
  // A "missing" keyword is by definition absent from this resume. Classify each
  // one against the candidate's own words before it reaches the prompt, so the
  // export path cannot promote a job requirement to a claimed skill.
  const grounded = groundKeywords(
    capKeywords(options?.missingKeywords),
    serializeSectionsForEvidence(sections)
  )
  const barredKeywords = [...grounded.unsupported, ...grounded.ambiguous]
  const keywordBlock = formatGroundedKeywords(grounded)
  if (keywordBlock) promptParts.push(keywordBlock)

  try {
    const { object } = await generateObjectTracked({
      schema: optimizedSectionsSchema,
      tracking: {
        feature: AI_USAGE_FEATURES.EXPORT_OPTIMIZE,
        surface: "app",
        userId: options.userId,
      },
      // OpenAI structured outputs default to strict mode, which requires every
      // property to be listed in `required` — it rejects this schema outright
      // (400 invalid_json_schema) because the content keys are optional. Turning
      // strict off keeps the request valid and lets the model return only the
      // keys it actually touched. Other providers ignore the `openai` namespace.
      providerOptions: { openai: { strictJsonSchema: false } },
      system: `You are an expert resume optimization specialist. Your job is to rewrite resume content to maximize impact and ATS compatibility.

RULES:
1. EXPERIENCE bullets: Rewrite every bullet in the Action–Result–Reason framework — the Action (a strong action verb plus what was done), then the Result (the outcome it produced), then the Reason (why it mattered: the purpose, relevance or business value). Keep it concise (1-2 lines max). Make achievements specific, but ONLY with facts the original bullet already contains: state the Result qualitatively when the source gives no figure, never invent numbers for it, and drop the Reason clause rather than padding the bullet or inventing one.
2. SUMMARY: Rewrite to be compelling, concise (2-4 sentences), and keyword-rich for the target role.
3. SKILLS: Do NOT change skill items. Return them exactly as provided.
4. EDUCATION: Minor polish only (fix capitalization, formatting). Do NOT change school names, degrees, dates, or GPA.
5. PROJECTS: Polish bullet points for clarity and impact. Do NOT change project names, technologies, or URLs.
6. CERTIFICATIONS: Minor polish only. Do NOT change names, organizations, dates, or credential IDs.
7. CONTACT: Do NOT change any contact information. Return exactly as provided.
8. CUSTOM sections: Minor polish for clarity only.

GROUNDING — THIS IS THE MOST IMPORTANT RULE: use ONLY facts present in the supplied resume content. NEVER invent specific numbers, percentages, dollar amounts, team sizes, dates, employers or technologies that the input does not contain. Quantify only where a figure is already given or plainly implied in the source text; otherwise strengthen the wording without fabricating a metric.

KEYWORD PRESERVATION: the existing wording may already have been tuned for ATS. PRESERVE existing strong keyword phrasing — real skill, tool, technology and certification names must survive verbatim. Do NOT paraphrase a concrete term into a generic one (e.g. do not turn "Kubernetes" into "container orchestration", and do not turn "ACLS certification" into "medical training").

${HUMAN_VOICE_LEXICON}

${UNTRUSTED_CONTENT_RULES}

CRITICAL CONSTRAINTS:
- NEVER change factual data: company names, school names, dates, locations, credential IDs, URLs, technologies, GPA values.
- NEVER add fabricated achievements or metrics that weren't implied by the original.
- Preserve ALL section IDs and item IDs exactly as supplied. Do NOT invent ids.
- Return the COMPLETE sections array with all items, even those you didn't change.
- The JSON must have this shape: { "sections": [{ "id": "<section id>", "items": [{ "id": "<item id>", "content": { ... } }] }] }, where content keeps the same keys as the supplied item content.`,
      prompt: promptParts.join("\n\n"),
    })

    // Merge AI output back, preserving original ids/type/order/visibility.
    const merged = sections.map((originalSection) => {
      const optimizedSection = object.sections.find((s) => s.id === originalSection.id)
      if (!optimizedSection) return originalSection

      return {
        ...originalSection,
        items: originalSection.items.map((originalItem) => {
          const optimizedItem = optimizedSection.items.find((i) => i.id === originalItem.id)
          if (!optimizedItem) return originalItem

          const content = mergeContent(originalItem.content, optimizedItem.content)

          // Enforce the grounding rule rather than trusting it. An item that
          // smuggled in an ungrounded requirement keeps its ORIGINAL content:
          // losing one item's polish is cheap, shipping a false claim is not.
          if (barredKeywords.length > 0) {
            const introduced = findIntroducedKeywords(
              contentText(originalItem.content),
              contentText(content),
              barredKeywords
            )
            if (introduced.length > 0) {
              log.warn("Reverted an optimized item that claimed ungrounded skills", {
                sectionId: originalSection.id,
                itemId: originalItem.id,
                introduced,
              })
              return originalItem
            }
          }

          return { ...originalItem, content }
        }),
      }
    })

    return { sections: merged, optimized: true }
  } catch (error) {
    // Fail soft: an export must never fail because optimization did.
    log.error("Optimization failed, exporting original content", { error })
    return {
      sections,
      optimized: false,
      reason:
        error instanceof AiKeyRequiredError
          ? "ai_key_required"
          : error instanceof AiDailyLimitError
            ? "ai_daily_limit"
            : "failed",
    }
  }
}
