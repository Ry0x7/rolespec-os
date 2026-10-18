import { AlertTriangle, CheckCircle2, ExternalLink, Gauge, Info, XCircle } from "lucide-react"
import { EmptyState } from "@/shared/components/empty-state"
import { formatDate } from "@/shared/lib/utils"
import type { RatingIssue } from "@/shared/lib/rating/schemas"
import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"

/** Human labels for each rating kind, in the order they should render. */
const SCORE_LABELS: Record<ProfileRatingData["kind"], Record<string, string>> = {
  PORTFOLIO: {
    contentClarity: "Content clarity",
    projectShowcase: "Project showcase",
    professionalPositioning: "Professional positioning",
    contactability: "Contactability",
    keywordsSeo: "Keywords & SEO",
  },
  LINKEDIN: {
    headline: "Headline",
    about: "About",
    experienceImpact: "Experience impact",
    skillsKeywords: "Skills & keywords",
    completeness: "Completeness",
  },
}

/** `keywordsSeo` → "Keywords seo". Fallback for keys the UI doesn't know yet. */
export function deCamelize(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Known keys first (in their declared order), then anything unexpected. */
export function orderedScores(
  kind: ProfileRatingData["kind"],
  scores: Record<string, number>
): { key: string; label: string; value: number }[] {
  const labels = SCORE_LABELS[kind] ?? {}
  const known = Object.keys(labels).filter((key) => key in scores)
  const extra = Object.keys(scores).filter((key) => !(key in labels))
  return [...known, ...extra].map((key) => ({
    key,
    label: labels[key] ?? deCamelize(key),
    value: scores[key],
  }))
}

interface RatingResultsProps {
  data: ProfileRatingData | null
  /** Shown in the empty state, e.g. "portfolio". */
  emptyHint?: string
}

export function RatingResults({ data, emptyHint }: RatingResultsProps) {
  if (!data) {
    return (
      <EmptyState
        icon={Gauge}
        title="No rating yet — run your first scan"
        description={emptyHint}
      />
    )
  }

  const issues = data.issues ?? []
  const suggestions = data.suggestions?.items ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ScoreGauge score={data.overallScore} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Score: {data.overallScore}
          </p>
          <p className="text-xs text-muted-foreground">
            {getScoreLabel(data.overallScore)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Rated {formatDate(data.createdAt)}
          </p>
          {data.sourceUrl && (
            <a
              href={data.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-brand-400 underline-offset-4 hover:underline"
            >
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{data.sourceUrl}</span>
            </a>
          )}
        </div>
      </div>

      <CategoryScores kind={data.kind} scores={data.scores ?? {}} />

      {issues.length > 0 && <IssuesList issues={issues} />}
      {suggestions.length > 0 && <SuggestionsList suggestions={suggestions} />}
    </div>
  )
}

/** Fixed-height placeholder so the gauge area never shifts while rating. */
export function RatingResultsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="flex items-center gap-3">
        <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="space-y-2">
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
          <div className="h-2 w-40 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 w-24 animate-pulse rounded bg-muted" />
            <div className="h-2 flex-1 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Severity → lucide icon. */
export const SEVERITY_ICON = {
  critical: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const

/** Severity → text colour class. */
export function severityTextClass(severity: RatingIssue["severity"]): string {
  return severity === "critical"
    ? "text-red-600 dark:text-red-500"
    : severity === "warning"
      ? "text-amber-600 dark:text-amber-500"
      : "text-blue-600 dark:text-blue-500"
}

export function ScoreGauge({ score }: { score: number }) {
  const radius = 28
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference
  const color = getScoreColor(score)

  return (
    <div
      className="relative h-16 w-16 shrink-0"
      role="img"
      aria-label={`Overall score ${score} out of 100`}
    >
      <svg className="h-full w-full -rotate-90" viewBox="0 0 64 64">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-muted"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">
        {score}
      </span>
    </div>
  )
}

function CategoryScores({
  kind,
  scores,
}: {
  kind: ProfileRatingData["kind"]
  scores: Record<string, number>
}) {
  const categories = orderedScores(kind, scores)
  if (categories.length === 0) return null

  return (
    <div className="space-y-2">
      {categories.map(({ key, label, value }) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 text-muted-foreground sm:w-36">{label}</span>
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
              style={{ width: `${value}%`, backgroundColor: getScoreColor(value) }}
            />
          </div>
          <span className="w-7 text-right font-medium">{value}</span>
        </div>
      ))}
    </div>
  )
}

function IssuesList({ issues }: { issues: RatingIssue[] }) {
  const critical = issues.filter((i) => i.severity === "critical")
  const warnings = issues.filter((i) => i.severity === "warning")
  const infos = issues.filter((i) => i.severity === "info")

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Issues
      </h4>
      {[...critical, ...warnings, ...infos].map((issue, idx) => (
        <IssueItem key={`${issue.severity}-${idx}`} issue={issue} />
      ))}
    </div>
  )
}

function IssueItem({ issue }: { issue: RatingIssue }) {
  const Icon = SEVERITY_ICON[issue.severity]
  const color = severityTextClass(issue.severity)

  return (
    <div
      data-severity={issue.severity}
      className="flex gap-2 rounded-md border border-border bg-background p-2.5 text-xs"
    >
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="text-foreground">{issue.message}</p>
        {issue.category && (
          <p className="text-muted-foreground">{deCamelize(issue.category)}</p>
        )}
      </div>
    </div>
  )
}

function SuggestionsList({ suggestions }: { suggestions: string[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Suggestions
      </h4>
      {suggestions.map((item, idx) => (
        <div
          key={idx}
          className="flex gap-2 rounded-md border border-border bg-background p-2.5 text-xs"
        >
          <CheckCircle2
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-500"
            aria-hidden="true"
          />
          <p className="text-foreground">{item}</p>
        </div>
      ))}
    </div>
  )
}

/** Score → bar/ring colour. Exported so feature UIs stay visually consistent. */
export function getScoreColor(score: number): string {
  if (score >= 75) return "#22c55e"
  if (score >= 50) return "#f59e0b"
  return "#ef4444"
}

/** Score → one-line verdict. Exported alongside {@link getScoreColor}. */
export function getScoreLabel(score: number): string {
  if (score >= 90) return "Excellent — this profile stands out"
  if (score >= 75) return "Good — a few refinements left"
  if (score >= 50) return "Fair — several areas need work"
  return "Needs work — start with the critical issues"
}
