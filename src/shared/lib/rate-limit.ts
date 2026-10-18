import * as Sentry from "@sentry/nextjs"
import { prisma } from "@/shared/lib/prisma"
import { logger } from "@/shared/lib/logger"

const log = logger("rate-limit")

/**
 * Generic sliding-window rate limiter backed by the `rate_limit_attempts` table.
 * Use it for anything that has no artifact table of its own to count rows in
 * (sign-in, sign-up, free AI actions). Buckets namespace the limit; the caller
 * decides what to key on — a lowercased email, a userId, or an IP.
 */

/** Buckets in use today. Plain strings are accepted; these keep spelling honest. */
export const RATE_LIMIT_BUCKETS = {
  SIGN_IN: "auth:sign-in",
  /** Same window as SIGN_IN but keyed on the client IP, to cap email spraying. */
  SIGN_IN_IP: "auth:sign-in-ip",
  SIGN_UP: "auth:sign-up",
  /** Reset requests, keyed on the submitted address — each one sends mail. */
  PASSWORD_RESET_REQUEST: "auth:password-reset-request",
  /** Same window keyed on the client IP, to cap walking a list of addresses. */
  PASSWORD_RESET_REQUEST_IP: "auth:password-reset-request-ip",
  RESUME_PARSE: "resume:parse",
  /** Creating a job-tailored resume copy — one AI call per run. */
  AI_RESUME_TAILOR: "resume:tailor",
  COVER_LETTER_IMPROVE: "cover-letter:improve",
  /** Full data export — the widest read a single user can trigger. */
  DATA_EXPORT: "account:data-export",
  /** Minting a personal API token, keyed on the user id. */
  API_TOKEN_CREATE: "account:api-token-create",
  /** Job creation through the extension endpoint, keyed on the token's user id. */
  EXTENSION_JOBS: "extension:jobs",
  /** Resume listing for the extension's picker, keyed on the token's user id. */
  EXTENSION_RESUMES: "extension:resumes",
  /** Batch fit-badge qualification for the extension, keyed on the token's user id. */
  EXTENSION_QUALIFY: "extension:qualify",
  /** Outreach-email generation through the extension, keyed on the token's user id. */
  EXTENSION_COLD_EMAIL: "extension:cold-email",
  /** Reply drafting through the extension, keyed on the token's user id. */
  EXTENSION_EMAIL_REPLY: "extension:email-reply",
  /** One job-discovery run (fans out to several source requests), keyed on the user id. */
  DISCOVERY_RUN: "discovery:run",
  /** Adding one posting by its URL (one third-party page fetch), keyed on the user id. */
  DISCOVERY_ADD_URL: "discovery:add-url",
  /** Resume↔job match scoring, keyed on the user id. */
  AI_JOB_MATCH: "ai:job-match",
  /** On-demand model second opinion on a posting's risk, keyed on the user id. */
  AI_JOB_RISK: "ai:job-risk",
  /** Interview-question generation, keyed on the user id. */
  AI_INTERVIEW_QUESTIONS: "ai:interview-questions",
  /** Application / cold / reply email drafting in-app, keyed on the user id. */
  AI_JOB_EMAIL: "ai:job-email",
  /** Resume enhance and assist calls, keyed on the user id. */
  AI_RESUME_ENHANCE: "ai:resume-enhance",
  /** LinkedIn profile suggestions, keyed on the user id. */
  AI_LINKEDIN: "ai:linkedin",
  /** Portfolio analysis, keyed on the user id. */
  AI_PORTFOLIO: "ai:portfolio",
  /** LinkedIn PDF → career-profile import, keyed on the user id. */
  CAREER_IMPORT: "career:import",
  /** One-click enhance of a career-profile field, keyed on the user id. */
  AI_PROFILE_ENHANCE: "ai:profile-enhance",
  /** Polish pass run while creating a master resume, keyed on the user id. */
  AI_MASTER_POLISH: "ai:master-polish",
} as const

/** Copy returned to the client whenever a limit trips. */
export const RATE_LIMIT_MESSAGE = "Too many attempts. Please try again later."

export interface RateLimitOptions {
  /** Attempts allowed inside the window before the limit trips. */
  max: number
  /** Length of the sliding window in milliseconds. */
  windowMs: number
}

/** Records one attempt. Never throws — a lost row only loosens the limit. */
export async function recordAttempt(bucket: string, identifier: string): Promise<void> {
  try {
    await prisma.rateLimitAttempt.create({ data: { bucket, identifier } })
  } catch (err) {
    log.error("Failed to record attempt", { err })
    Sentry.captureException(err)
  }
}

/**
 * True when `identifier` already used up `max` attempts inside the window.
 *
 * Fail direction on a DB error: OPEN (returns false, request proceeds). Failing
 * closed would be safer against brute force, but a transient Neon blip would
 * then lock every user out of sign-in, and every other limiter in this codebase
 * fails open. Consistency wins here; the tradeoff is deliberate.
 */
export async function isRateLimited(
  bucket: string,
  identifier: string,
  opts: RateLimitOptions
): Promise<boolean> {
  try {
    const recent = await prisma.rateLimitAttempt.count({
      where: {
        bucket,
        identifier,
        createdAt: { gte: new Date(Date.now() - opts.windowMs) },
      },
    })
    return recent >= opts.max
  } catch (err) {
    log.error("Count failed, failing open", { err })
    Sentry.captureException(err)
    return false
  }
}

/**
 * SQLSTATE for "function does not exist". Reached only when the code is deployed
 * ahead of the `20260911110000_consume_rate_limit_function` migration; the
 * limiter then walks back to the pre-function implementation instead of erroring
 * into the fail-open handler, which would leave every bucket unlimited.
 *
 * Prisma reports raw-query failures as P2010 and keeps the driver's SQLSTATE in
 * `meta.driverAdapterError.cause` — observed against Neon as both `originalCode`
 * and `code` for 42883. Matched on the code, never the message.
 */
const UNDEFINED_FUNCTION = "42883"

function isUndefinedFunctionError(err: unknown): boolean {
  const meta = (err as { meta?: unknown })?.meta
  const cause = (meta as { driverAdapterError?: { cause?: unknown } })?.driverAdapterError?.cause
  const { originalCode, code } = (cause ?? {}) as { originalCode?: unknown; code?: unknown }
  return originalCode === UNDEFINED_FUNCTION || code === UNDEFINED_FUNCTION
}

/**
 * Bounds for the legacy fallback transaction. The advisory lock serializes
 * concurrent holders, so waiters queue behind it while holding a pool connection;
 * Prisma's default 2s start-wait turns a burst into "unable to start a
 * transaction" errors, which the fail-open handler converts into UNRECORDED
 * admissions — exactly the burst the limiter exists to stop. These bounds make a
 * burst wait at the gate instead.
 */
const CONSUME_TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const

/**
 * The pre-function implementation: five round trips (~270ms), same guarantees.
 * Kept only as the deploy-ordering fallback above — do not call it directly.
 */
async function consumeViaTransaction(
  bucket: string,
  identifier: string,
  opts: RateLimitOptions
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const key = `${bucket}:${identifier}`
    // `$executeRaw`, not `$queryRaw`: the function returns `void`, which Prisma's
    // row deserializer rejects outright.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('rate-limit'), hashtext(${key}))`

    const recent = await tx.rateLimitAttempt.count({
      where: {
        bucket,
        identifier,
        createdAt: { gte: new Date(Date.now() - opts.windowMs) },
      },
    })
    if (recent >= opts.max) return false

    await tx.rateLimitAttempt.create({ data: { bucket, identifier } })
    return true
  }, CONSUME_TX_OPTIONS)
}

/**
 * Atomic check-and-record: returns true when the attempt is allowed (and the row
 * for it has already been written), false when the limit is reached (and nothing
 * was written).
 *
 * This exists because `isRateLimited()` + `recordAttempt()` is check-then-act: N
 * concurrent requests all read the same count and all pass. Lock, count and
 * insert therefore live in `public.consume_rate_limit()` (see the
 * `20260911110000_consume_rate_limit_function` migration), reached in ONE round
 * trip instead of the five an interactive transaction cost. Concurrent callers
 * for the same key serialize on `pg_advisory_xact_lock` inside it, and because
 * the function is VOLATILE its count runs on a fresh snapshot taken after the
 * lock — so each waiter sees the rows the previous holder committed. Doing the
 * same work as one CTE does NOT hold: a single statement snapshots before the
 * lock is acquired, and measured against Neon that let 5 of 5 concurrent callers
 * through a max of 3.
 *
 * No explicit transaction: the statement's implicit one scopes the advisory lock,
 * so Postgres releases it the moment the statement ends. A burst queues on the
 * lock rather than failing, bounded by the function's `lock_timeout`.
 *
 * The lock key is two int4s: a namespace hash ("rate-limit") plus the hash of
 * `bucket:identifier`. A hash collision between two different keys only makes
 * them serialize against each other unnecessarily; it can never produce a wrong
 * count, because the count itself still filters on bucket and identifier.
 *
 * Fail direction on a DB error: OPEN (returns true, nothing recorded), matching
 * `isRateLimited()`. Failing closed would be safer against brute force, but a
 * transient Neon blip would then lock every user out of sign-in. The tradeoff is
 * deliberate and consistent with every other limiter here. The one exception is a
 * missing `consume_rate_limit()`, which is not transient — see
 * `isUndefinedFunctionError`.
 */
export async function consumeRateLimit(
  bucket: string,
  identifier: string,
  opts: RateLimitOptions
): Promise<boolean> {
  try {
    const now = Date.now()
    // ISO strings cast to `timestamp(3)`, not JS Dates: the driver renders a Date
    // with the local UTC offset, which a `timestamp` cast would then silently
    // drop. `toISOString()` is already UTC, matching what Prisma stores.
    const rows = await prisma.$queryRaw<{ allowed: boolean }[]>`
      SELECT public.consume_rate_limit(
        ${`${bucket}:${identifier}`},
        ${bucket},
        ${identifier},
        ${new Date(now - opts.windowMs).toISOString()}::timestamp(3),
        ${new Date(now).toISOString()}::timestamp(3),
        ${opts.max}::integer
      ) AS allowed
    `
    return rows[0].allowed
  } catch (err) {
    // Deploy ordering, not an outage: run the old path rather than admit
    // everyone. Costs nothing on the fast path — it only branches after a throw.
    if (isUndefinedFunctionError(err)) {
      log.error(
        "consume_rate_limit() is missing — run the pending migration. Falling back to the transaction path",
        { err }
      )
      Sentry.captureException(err)
      try {
        return await consumeViaTransaction(bucket, identifier, opts)
      } catch (fallbackErr) {
        log.error("Consume fallback failed, failing open", { err: fallbackErr })
        Sentry.captureException(fallbackErr)
        return true
      }
    }

    log.error("Consume failed, failing open", { err })
    Sentry.captureException(err)
    return true
  }
}

/**
 * Drops an identifier's attempts. Call after a SUCCESSFUL auth so an honest user
 * who fat-fingered their password a few times is not held to the failure count.
 */
export async function clearAttempts(bucket: string, identifier: string): Promise<void> {
  try {
    await prisma.rateLimitAttempt.deleteMany({ where: { bucket, identifier } })
  } catch (err) {
    log.error("Failed to clear attempts", { err })
    Sentry.captureException(err)
  }
}

/**
 * Housekeeping: deletes attempts older than `olderThanMs`. Driven daily by
 * `GET /api/cron/prune-rate-limits`. Returns the number of rows removed.
 */
export async function pruneAttempts(olderThanMs: number): Promise<number> {
  try {
    const { count } = await prisma.rateLimitAttempt.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - olderThanMs) } },
    })
    return count
  } catch (err) {
    log.error("Prune failed", { err })
    Sentry.captureException(err)
    return 0
  }
}
