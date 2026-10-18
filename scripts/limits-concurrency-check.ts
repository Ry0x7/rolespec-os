/**
 * Live check that the two advisory-lock guards are actually atomic under
 * concurrency.
 *
 * The unit tests can only simulate the advisory lock's serialization; the real
 * property — that 20 parallel transactions against one key let exactly `max`
 * through — is only observable against a real Postgres.
 *
 * Phase 1 exercises `consumeRateLimit()` directly.
 * Phase 2 replays the daily AI quota reservation from
 * `reserveDailyUsage()` in `src/shared/lib/ai-generate.ts` — same lock
 * namespace, same rolling-24h count, same insert — against a throwaway userId.
 * `AiUsageEvent.userId` is a plain string with no foreign key, so inventing one
 * is safe.
 *
 * Usage: npx tsx scripts/limits-concurrency-check.ts
 * Env:   DATABASE_URL (required)
 *
 * Both phases use throwaway keys and delete their own rows afterwards, so this
 * is safe to run against any environment. Prints PASS or FAIL per phase and
 * exits non-zero if either fails.
 *
 * Known artifact: 20 parallel interactive transactions can exceed Prisma's
 * default transaction-start wait against a remote Neon, and `consumeRateLimit`
 * then fails open — reporting "allowed" for a call that wrote nothing. That
 * inflates phase 1's allowed count while `rows written` stays at `max`. The row
 * count is the property under test; a phase-1 FAIL with `rows written: 5` and
 * "Consume failed, failing open" in the log is the pool timing out, not a
 * broken lock. Re-run before believing it.
 */
import "dotenv/config"
import { prisma } from "@/shared/lib/prisma"
import { consumeRateLimit } from "@/shared/lib/rate-limit"

const BUCKET = "check:concurrency"
const MAX = 5
const PARALLEL = 20
const WINDOW_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000

/** The throwaway feature name the quota phase writes, so cleanup is exact. */
const QUOTA_FEATURE = "p03-check"

/** True when both counts came out at MAX. Logs the phase verdict either way. */
function report(phase: string, allowed: number, rows: number): boolean {
  console.log(`[${phase}] parallel calls: ${PARALLEL}, max: ${MAX}`)
  console.log(`[${phase}] allowed: ${allowed} (expected ${MAX})`)
  console.log(`[${phase}] rows written: ${rows} (expected ${MAX})`)

  const ok = allowed === MAX && rows === MAX
  console.log(`[${phase}] ${ok ? "PASS" : "FAIL"}`)
  return ok
}

/** Phase 1: the generic sliding-window limiter. */
async function checkRateLimit(): Promise<boolean> {
  const identifier = `p03-check-${Date.now()}`

  try {
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        consumeRateLimit(BUCKET, identifier, { max: MAX, windowMs: WINDOW_MS })
      )
    )
    const allowed = results.filter(Boolean).length
    const rows = await prisma.rateLimitAttempt.count({
      where: { bucket: BUCKET, identifier },
    })

    return report("rate-limit", allowed, rows)
  } finally {
    const { count } = await prisma.rateLimitAttempt.deleteMany({
      where: { bucket: BUCKET, identifier },
    })
    console.log(`[rate-limit] cleaned up ${count} row(s)`)
  }
}

/**
 * Phase 2: the daily AI quota reservation, mirroring `reserveDailyUsage()`.
 * Kept as an inline copy rather than an import because the real function needs
 * a provider, a model and a tracking object it would then try to charge.
 */
async function reserve(userId: string): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      // `$executeRaw`, not `$queryRaw`: the function returns `void`, which
      // Prisma's row deserializer rejects outright.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-quota'), hashtext(${userId}))`

      const used = await tx.aiUsageEvent.count({
        where: { userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
      })
      if (used >= MAX) return false

      await tx.aiUsageEvent.create({
        data: {
          userId,
          feature: QUOTA_FEATURE,
          surface: "app",
          provider: "check",
          model: "check",
          ok: false,
        },
        select: { id: true },
      })
      return true
    })
  } catch (error) {
    console.error("[ai-quota] reservation threw", error)
    return false
  }
}

async function checkAiQuota(): Promise<boolean> {
  const userId = `p03-ai-check-${Date.now()}`

  try {
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () => reserve(userId))
    )
    const allowed = results.filter(Boolean).length
    const rows = await prisma.aiUsageEvent.count({ where: { userId } })

    return report("ai-quota", allowed, rows)
  } finally {
    const { count } = await prisma.aiUsageEvent.deleteMany({
      where: { userId, feature: QUOTA_FEATURE },
    })
    console.log(`[ai-quota] cleaned up ${count} row(s)`)
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set")
  }

  // Sequential: two lock-contention storms at once would only muddy the timings.
  const rateLimitOk = await checkRateLimit()
  const aiQuotaOk = await checkAiQuota()

  if (rateLimitOk && aiQuotaOk) {
    console.log("PASS")
  } else {
    console.log("FAIL")
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(error)
    console.log("FAIL")
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
