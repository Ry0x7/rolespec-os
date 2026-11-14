import { memo } from "react"
import Link from "next/link"
import {
  BellRing,
  CalendarClock,
  Clock,
  Inbox,
  ListChecks,
} from "lucide-react"
import { Card } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { cn, formatDate } from "@/shared/lib/utils"
import { calendarDaysBetween, formatCalendarDate } from "@/shared/lib/dates"
import { StatusBadge } from "@/features/jobs/components/status-badge"
import { STATUS_LABELS } from "@/features/jobs/constants/status-labels"
import { UpcomingEventsList } from "./upcoming-events-list"
import type {
  JobsDashboardStats,
  StatusCount,
  UpcomingEvent,
} from "@/features/jobs/services/dashboard-stats.service"

// `followUpDue` and `appliedToday` are next-action/status-bar inputs. They now
// render at the top of the dashboard, not at the bottom of this overview.
type JobsOverviewProps = Omit<
  JobsDashboardStats,
  "followUpDue" | "appliedToday"
>

function relativeLabel(days: number): string {
  if (days <= 0) return "Today"
  if (days === 1) return "Tomorrow"
  return `In ${days} days`
}

/** Icon, tint, and right-hand label per event type — one source for all three. */
const EVENT_TYPE_CONFIG: Record<
  UpcomingEvent["type"],
  { icon: typeof CalendarClock; className: string; label: string }
> = {
  interview: {
    icon: CalendarClock,
    className: "text-amber-400",
    label: "Interview",
  },
  deadline: { icon: Clock, className: "text-red-400", label: "Deadline" },
  "follow-up": {
    icon: BellRing,
    className: "text-violet-400",
    label: "Follow up",
  },
  todo: { icon: ListChecks, className: "text-blue-400", label: "Task" },
}

const EventRow = memo(function EventRow({ event, todayStart }: { event: UpcomingEvent; todayStart: Date }) {
  const days = calendarDaysBetween(todayStart, event.date)
  const { icon: Icon, className, label } = EVENT_TYPE_CONFIG[event.type]
  // Deadlines, follow-ups and todo due dates are calendar dates and must render
  // as the day they were stored; an interview is a real instant, so stays local.
  const dateLabel =
    event.type === "interview"
      ? formatDate(event.date)
      : formatCalendarDate(event.date)
  return (
    <li className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className={`h-4 w-4 ${className}`} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <Link
          href={event.href}
          className="block truncate text-sm font-medium hover:underline"
        >
          {event.title}
        </Link>
        {event.subtitle && (
          <p className="truncate text-xs text-muted-foreground">
            {event.subtitle}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {relativeLabel(days)} &middot; {dateLabel}
        </p>
      </div>
    </li>
  )
})

/** Same colour language as the workspace board, so a status keeps its identity. */
const STATUS_DOT: Record<StatusCount["status"], string> = {
  INTERESTED: "bg-blue-600 dark:bg-blue-400",
  APPLIED: "bg-violet-600 dark:bg-violet-400",
  SCREENING: "bg-cyan-600 dark:bg-cyan-400",
  INTERVIEW: "bg-amber-600 dark:bg-amber-400",
  OFFER: "bg-green-600 dark:bg-green-400",
  REJECTED: "bg-red-600 dark:bg-red-400",
  WITHDRAWN: "bg-muted-foreground",
}

/**
 * Every status with its count, including the empty ones — a fixed row is easier
 * to read at a glance than one that reshuffles as the pipeline changes.
 */
const StatusStrip = memo(function StatusStrip({ counts }: { counts: StatusCount[] }) {
  return (
    <ul className="grid grid-cols-4 gap-x-3 gap-y-3 sm:grid-cols-7">
      {counts.map(({ status, count }) => (
        <li key={status} className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[status])}
              aria-hidden="true"
            />
            <span className="truncate">{STATUS_LABELS[status]}</span>
          </p>
          <p
            className={`mt-0.5 font-mono text-lg tabular-nums ${
              count === 0 ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {count}
          </p>
        </li>
      ))}
    </ul>
  )
})

export function JobsOverview({
  todayStart,
  statusCounts,
  upcomingEvents,
  recentApplications,
}: JobsOverviewProps) {
  return (
    // Six columns so the bottom pair divides the width evenly (3/3).
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-6">
      <Card className="lg:col-span-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Your pipeline</h2>
          <Link href="/workspace" className="text-xs text-brand-400 hover:underline">
            Open board
          </Link>
        </div>
        <StatusStrip counts={statusCounts} />
      </Card>

      {/* Nothing scheduled is not a task, so the card is left out entirely
          rather than filling the page with an empty state. */}
      {upcomingEvents.length > 0 && (
        <Card className="space-y-4 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Coming up (next 7 days)</h2>
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
          </div>
          <UpcomingEventsList
            rows={upcomingEvents.map((event) => (
              <EventRow
                key={`${event.id}-${event.type}`}
                event={event}
                todayStart={todayStart}
              />
            ))}
          />
        </Card>
      )}

      <Card
        className={cn(
          "space-y-4",
          upcomingEvents.length > 0 ? "lg:col-span-3" : "lg:col-span-6",
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent applications</h2>
          <Link href="/jobs" className="text-xs text-brand-400 hover:underline">
            View all
          </Link>
        </div>
        {recentApplications.length === 0 ? (
          <EmptyState
            variant="bare"
            icon={Inbox}
            title="No applications yet"
            description="Save a job to see its status and history here."
            action={
              <Link
                href="/jobs"
                className="text-sm text-brand-400 underline-offset-4 hover:underline"
              >
                Save your first job
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {recentApplications.map((app) => (
              <li key={app.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/jobs/${app.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {app.companyName}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {app.jobTitle}
                  </p>
                </div>
                <StatusBadge status={app.status} className="shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
