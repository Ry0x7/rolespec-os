"use client"

import { CheckCircle2, Gauge, ListChecks, TriangleAlert } from "lucide-react"
import { Card, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import {
  SEVERITY_ICON,
  deCamelize,
  severityTextClass,
} from "@/shared/components/rating-results"
import type { RatingIssue } from "@/shared/lib/rating/schemas"

/** Critical first, then warnings, then info — the shared rating ordering. */
function bySeverity(issues: RatingIssue[]): RatingIssue[] {
  return [
    ...issues.filter((i) => i.severity === "critical"),
    ...issues.filter((i) => i.severity === "warning"),
    ...issues.filter((i) => i.severity === "info"),
  ]
}

export function LinkedinIssues({ issues }: { issues: RatingIssue[] }) {
  if (issues.length === 0) return null

  return (
    <Card className="space-y-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-brand-400" aria-hidden="true" />
          What to fix
        </CardTitle>
      </CardHeader>

      <ul className="space-y-2">
        {bySeverity(issues).map((issue, idx) => {
          const Icon = SEVERITY_ICON[issue.severity]
          return (
            <li
              key={`${issue.severity}-${idx}`}
              data-severity={issue.severity}
              className="flex gap-2 rounded-md border border-border bg-background p-2.5 text-xs"
            >
              <Icon
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${severityTextClass(issue.severity)}`}
                aria-hidden="true"
              />
              <div className="min-w-0 space-y-0.5">
                <p className="text-foreground">{issue.message}</p>
                {issue.category && (
                  <p className="text-muted-foreground">
                    {deCamelize(issue.category)}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

export function LinkedinSuggestions({ suggestions }: { suggestions: string[] }) {
  if (suggestions.length === 0) return null

  return (
    <Card className="space-y-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-brand-400" aria-hidden="true" />
          Suggested next moves
        </CardTitle>
      </CardHeader>

      <ul className="space-y-2">
        {suggestions.map((item, idx) => (
          <li
            key={idx}
            className="flex gap-2 rounded-md border border-border bg-background p-2.5 text-xs"
          >
            <CheckCircle2
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-500"
              aria-hidden="true"
            />
            <p className="text-foreground">{item}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * Stand-in for the benchmark + issues + suggestions stack while a rating runs.
 * Fixed heights so the main column doesn't jump when the real cards land.
 */
export function LinkedinResultsSkeleton() {
  return (
    <div className="space-y-4 lg:space-y-6" aria-hidden="true">
      <Card className="space-y-4">
        <div className="space-y-2">
          <div className="h-3 w-40 animate-pulse rounded bg-muted" />
          <div className="h-2 w-56 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-8 animate-pulse rounded-md bg-muted" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="h-20 animate-pulse rounded-md bg-muted" />
          <div className="h-20 animate-pulse rounded-md bg-muted" />
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      </Card>
    </div>
  )
}

/** Shown before the first rating exists. */
export function LinkedinResultsEmpty({ className }: { className?: string }) {
  return (
    <EmptyState
      className={className}
      icon={Gauge}
      title="No rating yet — run your first scan"
      description="Upload your LinkedIn PDF and we'll score your headline, about, experience impact, skills, and completeness — then show how you compare with other candidates."
    />
  )
}
