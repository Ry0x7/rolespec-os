"use client"

import { AlertTriangle, CheckCircle2, Users } from "lucide-react"
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import type { RatingBenchmark } from "@/shared/lib/rating/schemas"

interface LinkedinBenchmarkNarrativeProps {
  benchmark: RatingBenchmark
}

/**
 * The competitor comparison narrative — how this profile reads next to other
 * candidates chasing the same role. Only rendered for ratings that carry a
 * benchmark; older rows have `benchmark: null`.
 */
export function LinkedinBenchmarkNarrative({
  benchmark,
}: LinkedinBenchmarkNarrativeProps) {
  const advantages = benchmark.advantages ?? []
  const gaps = benchmark.gaps ?? []

  return (
    <Card className="space-y-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-brand-400" aria-hidden="true" />
          Against the competition
        </CardTitle>
        <CardDescription>
          Compared with typical candidates targeting{" "}
          <span className="font-medium text-foreground">{benchmark.role}</span>.
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-foreground">{benchmark.summary}</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Where you win
          </h4>
          {advantages.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No clear edge over competitors yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {advantages.map((item, idx) => (
                <li
                  key={idx}
                  className="flex gap-2 rounded-md border border-green-600/20 bg-green-600/5 p-2.5 text-xs dark:border-green-500/20 dark:bg-green-500/5"
                >
                  <CheckCircle2
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-500"
                    aria-hidden="true"
                  />
                  <span className="text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Where they beat you
          </h4>
          {gaps.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing standing out — competitors have no obvious edge.
            </p>
          ) : (
            <ul className="space-y-2">
              {gaps.map((item, idx) => (
                <li
                  key={idx}
                  className="flex gap-2 rounded-md border border-amber-600/20 bg-amber-600/5 p-2.5 text-xs dark:border-amber-500/20 dark:bg-amber-500/5"
                >
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500"
                    aria-hidden="true"
                  />
                  <span className="text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}
