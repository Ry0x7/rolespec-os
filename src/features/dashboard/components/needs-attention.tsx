import Link from "next/link"
import { BellRing, CalendarCheck, ListChecks } from "lucide-react"

import { OpportunityConfidenceBadge } from "@/features/discovery/components/opportunity-confidence-badge"
import { VerdictBadge } from "@/features/discovery/components/verdict-badge"
import { QuickActionButtons } from "@/features/jobs/components/quick-action-buttons"
import { jobDetailHref } from "@/features/jobs/lib/job-detail-href"
import { FOLLOW_UP_DUE_PARAM } from "@/features/jobs/services/follow-up.service"
import { FOLLOW_UP_DUE_ACTIONS } from "@/features/jobs/services/application-quick-actions"
import type {
  AwaitingOutcomeItem,
  DecideQueueItem,
  OverdueFollowUp,
} from "@/features/jobs/services/dashboard-attention.service"
import { Card } from "@/shared/ui/card"

interface NeedsAttentionProps {
  /** Already trimmed to the rows worth showing by the service. */
  overdueFollowUps: OverdueFollowUp[]
  /** Total overdue, which may exceed the rows above. */
  overdueTotal: number
  /** Screening/interview rows whose interview day has passed, already trimmed. */
  awaitingOutcome?: AwaitingOutcomeItem[]
  decideQueue: DecideQueueItem[]
  /** Every application still at `INTERESTED`, for the footer link. */
  interestedTotal: number
}

/** 0 is "the day has come but not passed" — not something to call overdue by a number. */
function overdueLabel(daysOverdue: number): string {
  if (daysOverdue <= 0) return "Due today"
  if (daysOverdue === 1) return "1 day overdue"
  return `${daysOverdue} days overdue`
}

/** The service only returns interviews before today, so this is always at least 1. */
function awaitingOutcomeLabel(daysSince: number): string {
  const ago = daysSince === 1 ? "1 day ago" : `${daysSince} days ago`
  return `Interview was ${ago} · Log the outcome`
}

/**
 * The decisions waiting on the user, directly under the single next action:
 * follow-ups that have gone overdue first, then interviews whose outcome is
 * still unrecorded, then the saved jobs most worth deciding on.
 *
 * Everything here is a stored verdict or a stored date — no AI runs, and the
 * "Decide next" reason is the service's decision-phase line for the stored
 * verdict, not the discovery-phase next action the snapshot carries.
 *
 * Renders nothing when there is nothing waiting: an empty card would be one
 * more thing to read on the screen whose job is to say what matters next.
 */
export function NeedsAttention({
  overdueFollowUps,
  overdueTotal,
  awaitingOutcome = [],
  decideQueue,
  interestedTotal,
}: NeedsAttentionProps) {
  if (
    overdueFollowUps.length === 0 &&
    awaitingOutcome.length === 0 &&
    decideQueue.length === 0
  ) {
    return null
  }

  return (
    <Card className="space-y-5">
      <h2 className="text-sm font-semibold">Needs attention</h2>

      {overdueFollowUps.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-error">
              <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
              Overdue follow-ups
            </h3>
            {overdueTotal > overdueFollowUps.length && (
              <Link
                href={`/jobs?filter=${FOLLOW_UP_DUE_PARAM}`}
                className="text-xs text-brand-400 hover:underline"
              >
                View all {overdueTotal}
              </Link>
            )}
          </div>
          <ul className="space-y-2">
            {overdueFollowUps.map((row) => (
              <li key={row.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={jobDetailHref(row.id, "track")}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {row.companyName}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.jobTitle}
                  </p>
                </div>
                <p className="shrink-0 text-xs font-medium text-error">
                  {overdueLabel(row.daysOverdue)}
                </p>
                {/* The chase itself, without a trip to the job page. Same
                    actions and same toasts as the tracker row. */}
                <div className="flex shrink-0 items-center gap-1">
                  <QuickActionButtons
                    applicationId={row.id}
                    companyName={row.companyName}
                    actions={FOLLOW_UP_DUE_ACTIONS}
                    className="h-7 px-2 text-xs"
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {awaitingOutcome.length > 0 && (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <CalendarCheck
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            Interview outcomes
          </h3>
          <ul className="space-y-2">
            {awaitingOutcome.map((row) => (
              <li key={row.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  {/* Track owns the outcome panel and the status control, so
                      recording the result is one click from here. */}
                  <Link
                    href={jobDetailHref(row.id, "track")}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {row.companyName}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.jobTitle}
                  </p>
                </div>
                <p className="shrink-0 text-xs font-medium text-muted-foreground">
                  {awaitingOutcomeLabel(row.daysSince)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {decideQueue.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <ListChecks
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              Decide next
            </h3>
            <Link href="/jobs" className="text-xs text-brand-400 hover:underline">
              {/* Counts the INTERESTED rows only, so it must not say "saved
                  jobs" — the tracker it links to lists every status and shows a
                  larger number. */}
              All {interestedTotal} to decide
            </Link>
          </div>
          <ul className="space-y-2">
            {decideQueue.map((row) => (
              <li key={row.id} className="space-y-0.5">
                {/* Below sm the badges wrap under the link, so the company and
                    title get the full row width instead of ~120px. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap">
                  <Link
                    href={jobDetailHref(row.id, "decide")}
                    className="min-w-0 max-w-full basis-full truncate text-sm font-medium hover:underline sm:basis-auto"
                  >
                    {row.companyName} &mdash; {row.jobTitle}
                  </Link>
                  {row.verdict && <VerdictBadge verdict={row.verdict} />}
                  {/* Fit first, then whether the posting itself is worth the time. */}
                  <OpportunityConfidenceBadge
                    level={row.confidence.level}
                    summary={row.confidence.summary}
                  />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {row.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
