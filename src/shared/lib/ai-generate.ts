import { generateObject, generateText, type LanguageModelUsage } from "ai"
import type { z } from "zod"
import { prisma } from "./prisma"
import {
  AiDailyLimitError,
  assertAiConfigUsable,
  getAIModel,
  getEffectiveAiConfigForUser,
} from "./ai-provider"
import { AI_PROVIDER_META } from "./ai-providers/constants"
import { logger } from "./logger"

const log = logger("ai-generate")

/**
 * Every AI generation in the app goes through this module instead of calling
 * `generateObject`/`generateText` directly, for two reasons:
 *
 * 1. The admin-configurable `temperature`/`maxOutputTokens` from
 *    `getEffectiveAiConfig()` are applied here. Before this wrapper existed
 *    nothing read them, so both knobs were dead.
 * 2. Token usage is persisted per call to `ai_usage_events`, which is what the
 *    admin Usage tab reads. The SDK returns `usage` on every result; without a
 *    single choke point each of the sixteen call sites simply discarded it.
 */

/** Features that make AI calls. Plain strings are stored; these keep spelling honest. */
export const AI_USAGE_FEATURES = {
  RESUME_PARSE: "resume.parse",
  /** Bullet-rewrite pass that runs inside resume parsing when asked for. */
  RESUME_PARSE_OPTIMIZE: "resume.parse_optimize",
  RESUME_ATS_SCAN: "resume.ats_scan",
  RESUME_ENHANCE: "resume.enhance",
  /** One-shot bullet + summary rewrite run while creating the master resume. */
  RESUME_MASTER_POLISH: "resume.master_polish",
  /** Job-specific tailoring pass when creating a job-tailored resume copy. */
  RESUME_TAILOR: "resume.tailor",
  /** Optimization pass run while building an export. */
  EXPORT_OPTIMIZE: "export.optimize",
  COVER_LETTER: "jobs.cover_letter",
  COVER_LETTER_IMPROVE: "jobs.cover_letter_improve",
  COLD_EMAIL: "jobs.cold_email",
  /** Extension-only person-shaped outreach draft. */
  OUTREACH_EMAIL: "jobs.outreach_email",
  APPLICATION_EMAIL: "jobs.application_email",
  REPLY_EMAIL: "jobs.reply_email",
  JOB_MATCH: "jobs.match",
  /** On-demand interview questions for a tracked application. */
  INTERVIEW_QUESTIONS: "jobs.interview_questions",
  /** On-demand ghost-job / scam assessment for a tracked application. */
  JOB_RISK: "jobs.risk",
  LINKEDIN_RATING: "linkedin.rating",
  LINKEDIN_ASSIST: "linkedin.assist",
  PORTFOLIO_RATING: "portfolio.rating",
  /** Extracting career facts from an uploaded LinkedIn profile PDF. */
  CAREER_IMPORT: "career.import",
  /** Tightening one piece of text the user already wrote in their profile. */
  PROFILE_ENHANCE: "career.profile_enhance",
} as const

export type AiUsageFeature =
  (typeof AI_USAGE_FEATURES)[keyof typeof AI_USAGE_FEATURES]

/** Where the call came from: the web app, or the browser extension endpoints. */
export type AiSurface = "app" | "extension"

export interface AiTracking {
  feature: AiUsageFeature
  surface: AiSurface
  /**
   * Required in practice: omitting it (or passing null) makes the resolver throw
   * `AiKeyRequiredError`, since a call with no user has no key to resolve.
   */
  userId?: string | null
}

interface TrackedCallOptions {
  system?: string
  prompt: string
  /** Passed straight through, e.g. `{ openai: { strictJsonSchema: false } }`. */
  providerOptions?: Parameters<typeof generateObject>[0]["providerOptions"]
  /** Wins over the admin-configured value when supplied. */
  temperature?: number
  /** Wins over the admin-configured value when supplied. */
  maxOutputTokens?: number
  /**
   * Forwarded straight to the SDK, which aborts the in-flight request. For
   * callers on a deadline — usage is still recorded for the aborted attempt,
   * because the reservation was already spent.
   */
  abortSignal?: AbortSignal
  /**
   * `"light"` marks a call whose output does not need the flagship model. It
   * swaps in the provider's cheap model — unless the caller pinned a model of
   * their own, which always wins.
   */
  tier?: "light"
  tracking: AiTracking
}

/** Calls per user per rolling 24h when `User.aiDailyRequestLimit` is unset. */
export const DEFAULT_AI_DAILY_REQUEST_LIMIT = 300

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Bounds for the reservation transaction. The advisory lock serializes concurrent
 * holders, so waiters queue behind it while holding a pool connection; Prisma's
 * default 2s start-wait turns a burst into "unable to start a transaction"
 * errors, which the fail-open handler below converts into UNRECORDED admissions.
 * These bounds make a burst wait at the gate instead.
 */
const RESERVE_TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const

interface ReserveInput {
  userId: string
  limit: number | null
  tracking: AiTracking
  provider: string
  model: string
}

/**
 * Reserves one slot against the caller's daily cap BEFORE the provider is
 * called, and throws `AiDailyLimitError` once the cap is reached.
 *
 * Counting alone was check-then-act: the usage row only appeared after a
 * multi-second provider call, so N concurrent requests all counted the same
 * `used` and all passed. Instead the count and the row insert run in one
 * interactive transaction guarded by `pg_advisory_xact_lock`, keyed on two
 * int4s — a namespace hash ("ai-quota") plus the hash of the userId. The lock is
 * transaction-scoped, so Postgres releases it on commit or rollback. A hash
 * collision between two users only makes them serialize against each other; the
 * count still filters on `userId`, so it can never be wrong.
 *
 * The reserved row is written with `ok: false` and null token counts, and
 * `recordUsage()` updates it once the call finishes. Consequences, both
 * intended: failed calls count against the cap (a retry loop against a broken
 * provider is exactly what this is here to stop), and a process that crashes
 * mid-call leaves an `ok: false` row behind that still counts for 24h.
 *
 * Returns the reserved row id, or null when the reservation could not be made
 * for a non-cap reason — a DB error fails OPEN, like every other limiter here.
 * `AiDailyLimitError` is rethrown untouched: it is the user-facing contract.
 */
async function reserveDailyUsage({
  userId,
  limit,
  tracking,
  provider,
  model,
}: ReserveInput): Promise<string | null> {
  const max = limit ?? DEFAULT_AI_DAILY_REQUEST_LIMIT
  try {
    return await prisma.$transaction(async (tx) => {
      // `$executeRaw`, not `$queryRaw`: the function returns `void`, which
      // Prisma's row deserializer rejects outright.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-quota'), hashtext(${userId}))`

      const used = await tx.aiUsageEvent.count({
        where: { userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
      })
      if (used >= max) {
        throw new AiDailyLimitError()
      }

      const reservation = await tx.aiUsageEvent.create({
        data: {
          userId,
          feature: tracking.feature,
          surface: tracking.surface,
          provider,
          model,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          cachedInputTokens: null,
          reasoningTokens: null,
          durationMs: null,
          ok: false,
        },
        select: { id: true },
      })
      return reservation.id
    }, RESERVE_TX_OPTIONS)
  } catch (error) {
    if (error instanceof AiDailyLimitError) throw error
    log.warn("Daily AI limit check failed; allowing the call", { error })
    return null
  }
}

export type GenerateObjectTrackedOptions<T> = TrackedCallOptions & {
  schema: z.ZodType<T>
}

export type GenerateTextTrackedOptions = TrackedCallOptions

interface RecordInput {
  tracking: AiTracking
  provider: string
  model: string
  usage: LanguageModelUsage | undefined
  durationMs: number
  ok: boolean
  /** Row already inserted by `reserveDailyUsage()`; updated instead of inserted. */
  reservationId: string | null
}

/**
 * Finishes the usage row. Never throws and never rethrows: losing a metric must
 * not fail (or mask) the AI call it describes.
 *
 * When the call was reserved against the daily cap the row already exists, so
 * this fills in the outcome. Without a reservation (no userId, or the
 * reservation failed open) it inserts the row after the fact, as before.
 *
 * Note the log keys — `src/shared/lib/logger.ts` redacts any context key
 * containing "token", so counts are logged as `inputCount`/`outputCount`.
 */
async function recordUsage({
  tracking,
  provider,
  model,
  usage,
  durationMs,
  ok,
  reservationId,
}: RecordInput): Promise<void> {
  const outcome = {
    // Resolution can differ from what was reserved (cheap-tier swap, fallback).
    provider,
    model,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? null,
    durationMs,
    ok,
  }
  try {
    if (reservationId) {
      await prisma.aiUsageEvent.update({
        where: { id: reservationId },
        data: outcome,
      })
      return
    }
    await prisma.aiUsageEvent.create({
      data: {
        userId: tracking.userId ?? null,
        feature: tracking.feature,
        surface: tracking.surface,
        ...outcome,
      },
    })
  } catch (error) {
    log.warn("Failed to record AI usage event", {
      error,
      feature: tracking.feature,
      surface: tracking.surface,
      ok,
      inputCount: usage?.inputTokens ?? null,
      outputCount: usage?.outputTokens ?? null,
    })
  }
}

/**
 * Resolves the caller's own provider/model/key once per call, enforces their
 * daily cap, and merges the admin-configured sampling settings under any value
 * the caller supplied.
 *
 * Throws `AiKeyRequiredError` when a non-admin has no usable personal key, or
 * when the resolved provider cannot run at all (local-only in a deployment, or
 * no API key anywhere) — no usage row is written for a call that never reached
 * a provider, so a misconfigured deployment cannot burn a user's daily quota.
 */
async function resolveSettings(options: TrackedCallOptions) {
  const resolved = await getEffectiveAiConfigForUser(options.tracking.userId)

  const cheapModel = AI_PROVIDER_META[resolved.provider].cheapModel
  const config =
    options.tier === "light" && cheapModel && !resolved.modelPinned
      ? { ...resolved, model: cheapModel }
      : resolved

  // Before the reservation: a config that can never reach a provider must not
  // consume a slot against the caller's cap.
  await assertAiConfigUsable(config)

  // After the model is known, so the reserved row names what will actually run.
  const reservationId = options.tracking.userId
    ? await reserveDailyUsage({
        userId: options.tracking.userId,
        limit: resolved.dailyRequestLimit,
        tracking: options.tracking,
        provider: config.provider,
        model: config.model,
      })
    : null

  const temperature = options.temperature ?? config.temperature ?? undefined
  const maxOutputTokens =
    options.maxOutputTokens ?? config.maxOutputTokens ?? undefined
  return { config, temperature, maxOutputTokens, reservationId }
}

/** `generateObject` with the effective settings applied and usage recorded. */
export async function generateObjectTracked<T>(
  options: GenerateObjectTrackedOptions<T>,
): Promise<{ object: T; usage: LanguageModelUsage }> {
  const { tracking, schema, ...rest } = options
  // Routing hint for `resolveSettings`, not an SDK argument.
  delete rest.tier
  const { config, temperature, maxOutputTokens, reservationId } =
    await resolveSettings(options)
  const startedAt = Date.now()

  try {
    const model = await getAIModel(config)
    const result = await generateObject({
      ...rest,
      temperature,
      maxOutputTokens,
      model,
      schema,
    })
    await recordUsage({
      tracking,
      provider: config.provider,
      model: config.model,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
      ok: true,
      reservationId,
    })
    return { object: result.object as T, usage: result.usage }
  } catch (error) {
    await recordUsage({
      tracking,
      provider: config.provider,
      model: config.model,
      usage: undefined,
      durationMs: Date.now() - startedAt,
      ok: false,
      reservationId,
    })
    throw error
  }
}

/** `generateText` with the effective settings applied and usage recorded. */
export async function generateTextTracked(
  options: GenerateTextTrackedOptions,
): Promise<{ text: string; usage: LanguageModelUsage }> {
  const { tracking, ...rest } = options
  // Routing hint for `resolveSettings`, not an SDK argument.
  delete rest.tier
  const { config, temperature, maxOutputTokens, reservationId } =
    await resolveSettings(options)
  const startedAt = Date.now()

  try {
    const model = await getAIModel(config)
    const result = await generateText({
      ...rest,
      temperature,
      maxOutputTokens,
      model,
    })
    await recordUsage({
      tracking,
      provider: config.provider,
      model: config.model,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
      ok: true,
      reservationId,
    })
    return { text: result.text, usage: result.usage }
  } catch (error) {
    await recordUsage({
      tracking,
      provider: config.provider,
      model: config.model,
      usage: undefined,
      durationMs: Date.now() - startedAt,
      ok: false,
      reservationId,
    })
    throw error
  }
}
