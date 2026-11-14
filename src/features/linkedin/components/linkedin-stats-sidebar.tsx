"use client"

import { FileText, Trophy } from "lucide-react"
import {
  ScoreGauge,
  getScoreColor,
  getScoreLabel,
  orderedScores,
} from "@/shared/components/rating-results"
import { formatDate } from "@/shared/lib/utils"
import { Badge } from "@/shared/ui/badge"
import { Card, CardHeader, CardTitle } from "@/shared/ui/card"
import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"
import type { LinkedinContextUsed } from "../hooks/use-linkedin"

interface LinkedinStatsSidebarProps {
  rating: ProfileRatingData | null
  isPending: boolean
  /** Only set after a run in this session — drives the context chips. */
  contextUsed: LinkedinContextUsed | null
}

/**
 * Sticky rail beside the editor. Everything is null-safe: no rating shows an
 * invitation, and a pre-benchmark rating falls back to plain category bars.
 */
export function LinkedinStatsSidebar({
  rating,
  isPending,
  contextUsed,
}: LinkedinStatsSidebarProps) {
  if (isPending) return <LinkedinStatsSidebarSkeleton />

  if (!rating) {
    return (
      <Card className="space-y-3">
        <CardHeader>
          <CardTitle className="text-sm">Your standing</CardTitle>
        </CardHeader>
        <p className="text-sm text-muted-foreground">
          Rate your profile to see how you stack up against the competition.
        </p>
      </Card>
    )
  }

  const benchmark = rating.benchmark
  const categories = orderedScores(rating.kind, rating.scores ?? {})
  const chips = [
    contextUsed?.resume ? { label: "Resume linked", icon: FileText } : null,
  ].filter((chip): chip is { label: string; icon: typeof FileText } => chip !== null)

  return (
    <>
      <Card className="space-y-3">
        <CardHeader>
          <CardTitle className="text-sm">Your standing</CardTitle>
        </CardHeader>

        <div className="flex items-center gap-3">
          <ScoreGauge score={rating.overallScore} />
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {rating.overallScore}/100
            </p>
            <p className="text-xs text-muted-foreground">
              {getScoreLabel(rating.overallScore)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Rated {formatDate(rating.createdAt)}
            </p>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <Badge key={chip.label} variant="brand" size="sm">
                <chip.icon className="h-3 w-3" aria-hidden="true" />
                {chip.label}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {benchmark && (
        <Card className="space-y-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Trophy className="h-4 w-4 text-brand-400" aria-hidden="true" />
              Competitor standing
            </CardTitle>
          </CardHeader>

          <div>
            <p className="font-mono text-2xl font-bold tabular-nums text-foreground">
              Top {Math.max(1, 100 - benchmark.percentile)}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Stronger than{" "}
              <span className="font-mono tabular-nums">
                {benchmark.percentile}%
              </span>{" "}
              of profiles competing for{" "}
              <span className="font-medium text-foreground">{benchmark.role}</span>
              .
            </p>
          </div>
        </Card>
      )}

      {categories.length > 0 && (
        <Card className="space-y-3">
          <CardHeader>
            <CardTitle className="text-sm">
              {benchmark ? "You vs competitors" : "Category scores"}
            </CardTitle>
          </CardHeader>

          <ul className="space-y-3">
            {categories.map(({ key, label, value }) => {
              const competitor = benchmark
                ? benchmarkScoreFor(benchmark.benchmarkScores, key)
                : null

              return (
                <li key={key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-muted-foreground">
                      {label}
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-foreground">
                      {value}
                      {competitor != null && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          / {competitor}
                        </span>
                      )}
                    </span>
                  </div>

                  <div
                    role="img"
                    aria-label={
                      competitor == null
                        ? `${label}: your score ${value} out of 100`
                        : `${label}: your score ${value} vs typical competitor ${competitor}`
                    }
                    className="relative h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                      style={{
                        width: `${clamp(value)}%`,
                        backgroundColor: getScoreColor(value),
                      }}
                    />
                    {competitor != null && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
                        style={{ left: `${clamp(competitor)}%` }}
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {benchmark ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="inline-block h-3 w-0.5 shrink-0 rounded-full bg-foreground/70"
                aria-hidden="true"
              />
              Marker = typical competing profile
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Re-rate this profile to add the competitor benchmark.
            </p>
          )}
        </Card>
      )}
    </>
  )
}

/** Fixed-shape placeholder so the rail never resizes mid-request. */
export function LinkedinStatsSidebarSkeleton() {
  return (
    <>
      <Card className="space-y-3" aria-hidden="true">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="flex items-center gap-3">
          <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="h-2 w-32 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </Card>
      <Card className="space-y-3" aria-hidden="true">
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        <ul className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="space-y-1.5">
              <div className="h-2 w-24 animate-pulse rounded bg-muted" />
              <div className="h-2 w-full animate-pulse rounded-full bg-muted" />
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/** Benchmark scores use the same keys as `scores`; unknown keys have no tick. */
function benchmarkScoreFor(
  benchmarkScores: Record<string, number>,
  key: string
): number | null {
  const value = benchmarkScores?.[key]
  return typeof value === "number" ? value : null
}
