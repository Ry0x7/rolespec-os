import { prisma } from "@/shared/lib/prisma"
import { estimateCostUsd } from "@/shared/lib/ai-pricing"

export interface DailyCount {
  day: string
  count: number
}

function toUtcDayKey(value: Date | string) {
  if (typeof value === "string") return value.slice(0, 10)
  return value.toISOString().slice(0, 10)
}

export function fillDailySeries(
  rows: { day: Date | string; count: number }[],
  days: number,
  now: Date
): DailyCount[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const key = toUtcDayKey(row.day)
    totals.set(key, (totals.get(key) ?? 0) + Number(row.count))
  }

  const today = startOfUtcDay(now)
  const series: DailyCount[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today.getTime() - offset * DAY_MS)
    const key = toUtcDayKey(day)
    series.push({ day: key, count: totals.get(key) ?? 0 })
  }
  return series
}

/** Days of AI usage covered by every number on the user's Usage tab. */
export const USER_AI_USAGE_WINDOW_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export interface UserAiUsageTotals {
  calls: number
  okCalls: number
  failedCalls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** null when no call in the window has a known price. */
  estimatedCostUsd: number | null
}

export interface UserAiUsageModelRow {
  provider: string
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number | null
}

export interface UserAiUsageFeatureRow {
  feature: string
  calls: number
  failedCalls: number
  totalTokens: number
}

export interface UserAiUsage {
  windowDays: number
  totals: UserAiUsageTotals
  byModel: UserAiUsageModelRow[]
  byFeature: UserAiUsageFeatureRow[]
  tokensByDay: DailyCount[]
}

type DailyRow = { day: Date | string; count: number }

/** Midnight UTC of `date`'s day. Mirrors the admin dashboard's series alignment. */
function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
}

/**
 * One user's AI usage over the last 30 days, for /settings/usage.
 *
 * Cost is derived at read time from `ai-pricing.ts` and never stored: list
 * prices change, and a stored number would silently go stale. A model with no
 * price row contributes nothing to the estimate and reports null on its own row.
 */
export async function getUserAiUsage(userId: string): Promise<UserAiUsage> {
  const now = new Date()
  const since = new Date(now.getTime() - USER_AI_USAGE_WINDOW_DAYS * DAY_MS)
  const where = { userId, createdAt: { gte: since } }
  // The chart is drawn from 30 whole UTC days, so its query has to start at the
  // start of the oldest of them. Using the rolling cutoff instead silently
  // dropped the earlier part of the oldest bar.
  const seriesStart = new Date(
    startOfUtcDay(now).getTime() - (USER_AI_USAGE_WINDOW_DAYS - 1) * DAY_MS,
  )

  const [totalsRow, okCalls, modelRows, featureRows, failureRows, tokenRows] =
    await Promise.all([
      prisma.aiUsageEvent.aggregate({
        where,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
      prisma.aiUsageEvent.count({ where: { ...where, ok: true } }),
      prisma.aiUsageEvent.groupBy({
        by: ["provider", "model"],
        where,
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          cachedInputTokens: true,
        },
      }),
      prisma.aiUsageEvent.groupBy({
        by: ["feature"],
        where,
        _count: { _all: true },
        _sum: { totalTokens: true },
      }),
      prisma.aiUsageEvent.groupBy({
        by: ["feature"],
        where: { ...where, ok: false },
        _count: { _all: true },
      }),
      prisma.$queryRaw<DailyRow[]>`
        SELECT date_trunc('day', "createdAt") AS day,
               COALESCE(SUM("totalTokens"), 0)::int AS count
        FROM "ai_usage_events"
        WHERE "userId" = ${userId} AND "createdAt" >= ${seriesStart}
        GROUP BY 1
        ORDER BY 1
      `,
    ])

  let costTotal = 0
  let anyPriced = false

  const byModel: UserAiUsageModelRow[] = modelRows
    .map((row) => {
      const inputTokens = row._sum.inputTokens ?? 0
      const outputTokens = row._sum.outputTokens ?? 0
      const cost = estimateCostUsd({
        provider: row.provider,
        model: row.model,
        inputTokens,
        outputTokens,
        cachedInputTokens: row._sum.cachedInputTokens ?? 0,
      })
      if (cost !== null) {
        costTotal += cost
        anyPriced = true
      }
      return {
        provider: row.provider,
        model: row.model,
        calls: row._count._all,
        inputTokens,
        outputTokens,
        estimatedCostUsd: cost,
      }
    })
    .sort(
      (a, b) =>
        b.outputTokens + b.inputTokens - (a.outputTokens + a.inputTokens) ||
        b.calls - a.calls
    )

  const calls = totalsRow._count._all
  const totals: UserAiUsageTotals = {
    calls,
    okCalls,
    failedCalls: calls - okCalls,
    inputTokens: totalsRow._sum.inputTokens ?? 0,
    outputTokens: totalsRow._sum.outputTokens ?? 0,
    totalTokens: totalsRow._sum.totalTokens ?? 0,
    estimatedCostUsd: anyPriced ? costTotal : null,
  }

  const failuresByFeature = new Map(
    failureRows.map((row) => [row.feature, row._count._all])
  )
  const byFeature: UserAiUsageFeatureRow[] = featureRows
    .map((row) => ({
      feature: row.feature,
      calls: row._count._all,
      failedCalls: failuresByFeature.get(row.feature) ?? 0,
      totalTokens: row._sum.totalTokens ?? 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls)

  return {
    windowDays: USER_AI_USAGE_WINDOW_DAYS,
    totals,
    byModel,
    byFeature,
    tokensByDay: fillDailySeries(tokenRows, USER_AI_USAGE_WINDOW_DAYS, now),
  }
}
