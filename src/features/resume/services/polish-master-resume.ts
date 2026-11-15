import { z } from "zod"

import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import { logger } from "@/shared/lib/logger"
import { HUMAN_VOICE_LEXICON } from "@/shared/lib/prompts/human-voice"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"
import type {
  AssembledMasterResumeItem,
  AssembledMasterResumeSection,
} from "../lib/assemble-master-resume"
import { MAX_BULLET_LENGTH, MAX_SUMMARY_LENGTH } from "./enhance-ats"

const log = logger("resume-master-polish")

// ─── Prompt caps ────────────────────────────────────────────────────────────

/** How many bullets one run will send and accept rewrites for. */
export const MAX_POLISH_BULLETS = 60
/** Free-text profile fields; none of them may grow into the prompt. */
const MAX_CAREER_GOALS_LENGTH = 1000
const MAX_CONTEXT_TEXT_LENGTH = 200
const MAX_CONTEXT_TARGET_ROLES = 5

/**
 * How long the polish gets before the resume is created without it. Resume
 * creation redirects on completion, so this is time the user spends staring at a
 * pending form — the deadline is the difference between "a beat slower" and "the
 * button is broken".
 *
 * Sized from measurement, not taste. The first value here was 15_000, and every
 * real run hit it: six `resume.master_polish` usage rows in a row, all
 * `ok: false`, all `durationMs` between 14483 and 14738 — the deadline aborting
 * the request, every time, which is exactly what "the bullets came out verbatim
 * and the summary was empty" looked like from the outside. A live 27-bullet
 * payload on claude-sonnet-5 completed in 21424ms, and the app's other
 * structured calls for the same account run 45-62s (`resume.enhance` 46635ms,
 * `resume.tailor` 62391ms). 45s is the measured duration plus ~100% headroom,
 * which is what it takes for this to succeed rather than fail politely.
 */
export const POLISH_TIMEOUT_MS = 45_000

// ─── Structured output ──────────────────────────────────────────────────────

/**
 * An array of `{ id, text }` rather than a record keyed by id: strict structured
 * outputs cannot express a dynamic-key object, so the ids travel as values and
 * are resolved against the supplied map below.
 *
 * `text` is required-and-nullable for the same reason `enhancedTextSchema` is —
 * `.optional()` drops the key from `required`, which strict mode rejects. Null
 * means "keep the original".
 */
export const masterResumePolishSchema = z.object({
  bullets: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().nullable(),
      })
    )
    .max(MAX_POLISH_BULLETS),
  /** The generated professional summary. Null when there was nothing to say. */
  summary: z.string().nullable(),
})

/** Read-only profile context. Never a source of new facts for the rewrites. */
export interface PolishProfileContext {
  careerGoals?: string | null
  /** `CareerProfile.experienceLevel`, passed through as its raw enum value. */
  experienceLevel?: string | null
  targetRoles?: readonly string[]
}

export interface PolishMasterResumeInput {
  /** Owner of the request, recorded with the call's token usage. */
  userId: string
  /** The assembled sections, straight out of `assembleMasterResume`. */
  sections: AssembledMasterResumeSection[]
  profileContext?: PolishProfileContext
}

export interface PolishMasterResumeResult {
  /**
   * Always safe to persist: the same sections and items in the same order, with
   * the same number of bullets. Equal to the input when the polish did nothing.
   */
  sections: AssembledMasterResumeSection[]
  /** The generated summary, or null. The caller decides where to put it. */
  summary: string | null
  /** False when the run was skipped or failed and `sections` is the input. */
  polished: boolean
}

// ─── Bullet targets ─────────────────────────────────────────────────────────

interface BulletTarget {
  id: string
  text: string
  /** Human label for the prompt, e.g. "Experience — Engineer @ Acme". */
  label: string
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function bulletsOf(item: AssembledMasterResumeItem): string[] | undefined {
  const bullets = item.content.bullets
  return Array.isArray(bullets) ? bullets : undefined
}

/** Stable, position-derived id. Nothing else about an item is unique yet. */
function bulletId(sectionIndex: number, itemIndex: number, bulletIndex: number): string {
  return `s${sectionIndex}i${itemIndex}b${bulletIndex}`
}

function labelFor(section: AssembledMasterResumeSection, item: AssembledMasterResumeItem): string {
  // `role` for experience, `name` for projects — the keys `assembleMasterResume`
  // actually writes. `title` is the fallback for anything shaped differently.
  const title =
    asString(item.content.role) ??
    asString(item.content.name) ??
    asString(item.content.title) ??
    "—"
  const company = asString(item.content.company) ?? asString(item.content.organization)
  return `${section.title} — ${title}${company ? ` @ ${company}` : ""}`
}

/** Every bullet in every section, in section/item/bullet order, capped. */
function collectTargets(sections: AssembledMasterResumeSection[]): BulletTarget[] {
  const targets: BulletTarget[] = []

  sections.forEach((section, sectionIndex) => {
    section.items.create.forEach((item, itemIndex) => {
      bulletsOf(item)?.forEach((bullet, bulletIndex) => {
        const text = typeof bullet === "string" ? bullet.trim() : ""
        if (!text) return
        targets.push({
          id: bulletId(sectionIndex, itemIndex, bulletIndex),
          text,
          label: labelFor(section, item),
        })
      })
    })
  })

  return targets.slice(0, MAX_POLISH_BULLETS)
}

/**
 * Rebuilds the sections with the accepted rewrites applied.
 *
 * Structurally a map, never a filter: the bullet count of every item, the item
 * count of every section and the section count itself are all carried over
 * untouched. An id the map does not know about simply never matches.
 */
function applyRewrites(
  sections: AssembledMasterResumeSection[],
  rewrites: Map<string, string>
): AssembledMasterResumeSection[] {
  if (rewrites.size === 0) return sections

  return sections.map((section, sectionIndex) => ({
    ...section,
    items: {
      create: section.items.create.map((item, itemIndex) => {
        const bullets = bulletsOf(item)
        if (!bullets) return item

        let changed = false
        const next = bullets.map((bullet, bulletIndex) => {
          const rewritten = rewrites.get(bulletId(sectionIndex, itemIndex, bulletIndex))
          if (!rewritten || rewritten === bullet) return bullet
          changed = true
          return rewritten
        })

        return changed ? { ...item, content: { ...item.content, bullets: next } } : item
      }),
    },
  }))
}

/**
 * Turns the model's array into a map of id → accepted rewrite.
 *
 * Every guard here is deliberate and code-level, because the output is written
 * straight into a resume with no review step:
 * - an id that was never sent is dropped (no bullet is invented into existence),
 * - a blank rewrite is dropped (the original survives),
 * - a rewrite over the bullet cap is dropped rather than truncated, since a
 *   sentence cut mid-word reads worse than the bullet it replaced,
 * - the first rewrite for an id wins, so a duplicated id cannot fight itself.
 */
function collectRewrites(
  object: z.infer<typeof masterResumePolishSchema>,
  targets: BulletTarget[]
): Map<string, string> {
  const originals = new Map(targets.map((target) => [target.id, target.text]))
  const rewrites = new Map<string, string>()

  for (const bullet of object.bullets) {
    const original = originals.get(bullet.id)
    if (original === undefined) continue
    if (rewrites.has(bullet.id)) continue

    const text = (bullet.text ?? "").trim()
    if (!text || text === original) continue
    if (text.length > MAX_BULLET_LENGTH) continue

    rewrites.set(bullet.id, text)
  }

  return rewrites
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

function buildContextParts(context: PolishProfileContext | undefined): string[] {
  const parts: string[] = []
  if (!context) return parts

  if (context.experienceLevel) {
    parts.push(`Self-declared experience level: ${context.experienceLevel}`)
  }

  const targetRoles = (context.targetRoles ?? [])
    .map((role) => asString(role))
    .filter((role): role is string => Boolean(role))
    .slice(0, MAX_CONTEXT_TARGET_ROLES)
    .map((role) => role.slice(0, MAX_CONTEXT_TEXT_LENGTH))
  if (targetRoles.length > 0) {
    parts.push(
      `Roles this person is targeting (context for emphasis and tone only — NOT facts about them, and NOT permission to claim any of it):\n${targetRoles
        .map((role) => `- ${role}`)
        .join("\n")}`
    )
  }

  const careerGoals = asString(context.careerGoals)?.slice(0, MAX_CAREER_GOALS_LENGTH)
  if (careerGoals) {
    parts.push(
      `Career goals, in this person's own words:\n${fenceUntrusted("CAREER_GOALS", careerGoals)}`
    )
  }

  return parts
}

// ─── Deadline ───────────────────────────────────────────────────────────────

/** Distinguishes "we gave up waiting" from a provider error, for the log line. */
class PolishTimeoutError extends Error {
  constructor(ms: number) {
    super(`Master resume polish exceeded ${ms}ms`)
    this.name = "PolishTimeoutError"
  }
}

/**
 * Runs `work` under a hard deadline.
 *
 * Two layers on purpose. The `AbortSignal` is the honest one: the gateway
 * forwards it to the SDK, which cancels the in-flight request rather than
 * leaving it burning a socket. The race is the guarantee — it does not depend on
 * the provider, the SDK or the transport honouring the signal, and it is what
 * makes the deadline observable. A late rejection from the abandoned call is
 * swallowed by the attached no-op catch, so it can never surface as an unhandled
 * rejection after the caller has moved on.
 */
async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const running = work(controller.signal)
  running.catch(() => {})

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new PolishTimeoutError(ms))
    }, ms)
  })

  try {
    return await Promise.race([running, deadline])
  } finally {
    // Whoever won, the timer must not keep the process (or a test) alive.
    clearTimeout(timer)
  }
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * One AI pass that turns a freshly assembled master resume into resume-quality
 * text: every experience/project bullet rewritten in strong resume language, plus
 * the professional summary `assembleMasterResume` deliberately leaves empty.
 *
 * This runs at creation with no accept/reject step, so it is written to fail
 * quietly and structurally: it never throws, never drops a bullet, item or
 * section, and returns the input untouched whenever the model is unavailable,
 * unhelpful, off-contract or simply too slow. The worst case is the resume the
 * user gets today, delayed by at most `POLISH_TIMEOUT_MS`.
 *
 * No `tier: "light"` here, unlike `enhanceProfileText`: this is a many-bullet
 * rewrite whose output is persisted unreviewed, which is the same shape of work
 * as `generateATSEnhanceSuggestions` — and that one runs on the flagship model.
 */
export async function polishMasterResume(
  input: PolishMasterResumeInput
): Promise<PolishMasterResumeResult> {
  const unpolished: PolishMasterResumeResult = {
    sections: input.sections,
    summary: null,
    polished: false,
  }

  const startedAt = Date.now()

  try {
    const targets = collectTargets(input.sections)
    const contextParts = buildContextParts(input.profileContext)

    // Nothing to rewrite and nothing to write a summary from — an empty profile.
    // Spending a call here would only produce invented text.
    if (targets.length === 0 && contextParts.length === 0) return unpolished

    const promptParts = [...contextParts]

    if (targets.length > 0) {
      promptParts.push(
        `Resume bullets to rewrite. Each entry is "<id> | <where it appears>" followed by the bullet's current text:\n${fenceUntrusted(
          "RESUME_BULLETS",
          targets
            .map((target) => `${target.id} | ${target.label}\n${target.text}`)
            .join("\n\n")
        )}`
      )
    } else {
      promptParts.push(
        "This resume has no bullets yet. Return an empty `bullets` array and write the summary from the context above alone."
      )
    }

    const { object } = await withDeadline(
      (abortSignal) =>
        generateObjectTracked({
          abortSignal,
          schema: masterResumePolishSchema,
          tracking: {
            feature: AI_USAGE_FEATURES.RESUME_MASTER_POLISH,
            surface: "app",
            userId: input.userId,
          },
          system: [
            "You are an expert resume writer. You are given the raw notes a job seeker recorded about their own career, already sorted into resume bullets, plus some context about them. Rewrite those bullets into strong resume language and write their professional summary.",
            "",
            UNTRUSTED_CONTENT_RULES,
            "",
            'OUTPUT FORMAT: Respond with ONLY a valid JSON object using EXACTLY this camelCase shape — no extra fields, no markdown: { "bullets": [{ "id": "<one of the supplied bullet ids>", "text": "<the rewritten bullet, or null>" }], "summary": "<the professional summary, or null>" }',
            "EVERY field above is required on every entry — never omit a key. Use null rather than leaving a key out.",
            "",
            "Return AT MOST one entry per supplied id, and NEVER invent an id that was not supplied. Return an entry for every bullet you improved. If a bullet is already strong, or is too thin to improve without inventing something, return null for its `text` (or leave it out entirely) — returning the original unchanged is always better than padding it.",
            "",
            "GROUNDING — THIS IS THE MOST IMPORTANT RULE: the rewrite must contain no fact the input does not already contain. NEVER invent or sharpen a number, percentage, dollar amount, duration, date, team size, budget, employer, job title, tool, technology, certification or skill. If a bullet says 'managed social media', it stays qualitative — you may not turn it into 'grew following by 40%'. Removing a fact is equally wrong: keep every claim the bullet makes. The target roles and career goals describe where this person WANTS to go; they are never evidence of what this person has done, and nothing may be claimed from them.",
            "",
            `BULLETS: rewrite each one as ONE single line of at most ${MAX_BULLET_LENGTH} characters. Open with a strong, specific action verb, then what was actually done, then the outcome the input gives — state the outcome qualitatively when no figure is supplied. Be concrete: replace vague duty-speak ('responsible for', 'helped with', 'various tasks') with the precise version of the SAME claim. Vary the opening verbs across bullets. No first-person pronouns, no bullet glyph prefix ("-", "•"), no trailing period-free fragments, no markdown.`,
            `A rewrite longer than ${MAX_BULLET_LENGTH} characters is discarded, so keep it tight.`,
            "",
            `SUMMARY: 2-3 sentences, at most ${MAX_SUMMARY_LENGTH} characters, written in the third person with no pronouns ('Operations lead with...' not 'I am...'). Synthesise it ONLY from the bullets and context supplied above — the scope, field and kind of work they actually show. Never state a number of years, a seniority title, an employer, a degree or a skill that the supplied text does not contain. If the supplied material is too thin to describe this person honestly, return null for the summary rather than writing a generic one.`,
            "",
            HUMAN_VOICE_LEXICON,
            "STYLE: plain professional English, active voice, ATS-friendly wording with real skill and tool names. No buzzword filler such as 'results-driven professional', 'passionate about', 'synergy' or 'leverage'. No tables, no special characters beyond ordinary punctuation.",
          ].join("\n"),
          prompt: promptParts.join("\n\n"),
        }),
      POLISH_TIMEOUT_MS
    )

    const rewrites = collectRewrites(object, targets)
    const summary = (object.summary ?? "").trim().slice(0, MAX_SUMMARY_LENGTH).trim()

    // Logged on the happy path too, because `elapsedMs` next to `timeoutMs` is
    // the only way to see the deadline getting close before it starts firing.
    log.info("Master resume polish applied", {
      elapsedMs: Date.now() - startedAt,
      timeoutMs: POLISH_TIMEOUT_MS,
      bulletsSent: targets.length,
      bulletsRewritten: rewrites.size,
      hasSummary: Boolean(summary),
    })

    return {
      sections: applyRewrites(input.sections, rewrites),
      summary: summary || null,
      polished: true,
    }
  } catch (err) {
    // Creation must not fail — or hang — because the polish did. The user gets
    // the resume they would have got before this pass existed.
    //
    // `reason` and `elapsedMs` are the whole point of this line: the fallback is
    // invisible in the UI by design, so a bare "failed" left a deadline that
    // fired on every single run indistinguishable from a provider outage.
    log.warn("Master resume polish failed; persisting the unpolished sections", {
      reason: err instanceof PolishTimeoutError ? "timeout" : (err as Error)?.name || "error",
      elapsedMs: Date.now() - startedAt,
      timeoutMs: POLISH_TIMEOUT_MS,
      err,
    })
    return unpolished
  }
}
