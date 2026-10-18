import type { ReactNode } from "react"
import Link from "next/link"
import {
  BellRing,
  CalendarClock,
  Clock,
  Inbox,
  ListChecks,
  Target,
} from "lucide-react"
import { Card } from "@/shared/ui/card"
import { Progress } from "@/shared/ui/progress"
import { EmptyState } from "@/shared/components/empty-state"
import { cn, formatDate } from "@/shared/lib/utils"
import { calendarDaysBetween, formatCalendarDate } from "@/shared/lib/dates"
import { StatusBadge } from "@/features/jobs/components/status-badge"
import { DAILY_JOB_GOAL } from "@/features/jobs/constants/goals"
import { STATUS_LABELS } from "@/features/jobs/constants/status-labels"
import { UpcomingEventsList } from "./upcoming-events-list"
import type {
  JobsDashboardStats,
  StatusCount,
  UpcomingEvent,
} from "@/features/jobs/services/dashboard-stats.service"

// `followUpDue` is a next-action input, not something this overview renders.
interface JobsOverviewProps extends Omit<JobsDashboardStats, "followUpDue"> {
  /**
   * Rendered as the top-right cell of the same grid (the "Your activity"
   * panel). It lives here rather than in a sibling column so the bottom two
   * cards can span the full page width instead of leaving a dead quadrant.
   */
  sidebar?: ReactNode
}

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

function EventRow({ event, todayStart }: { event: UpcomingEvent; todayStart: Date }) {
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
        <Icon className={`h-4 w-4 ${className}`} />
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
}

/**
 * Every status with its count, including the empty ones — a fixed row is easier
 * to read at a glance than one that reshuffles as the pipeline changes.
 */
function StatusStrip({ counts }: { counts: StatusCount[] }) {
  return (
    <ul className="grid grid-cols-4 gap-x-3 gap-y-2 sm:grid-cols-7">
      {counts.map(({ status, count }) => (
        <li key={status} className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {STATUS_LABELS[status]}
          </p>
          <p
            className={`font-mono text-lg tabular-nums ${
              count === 0 ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {count}
          </p>
        </li>
      ))}
    </ul>
  )
}

export function JobsOverview({
  todayStart,
  appliedToday,
  statusCounts,
  upcomingEvents,
  recentApplications,
  sidebar,
}: JobsOverviewProps) {
  const goalMet = appliedToday >= DAILY_JOB_GOAL

  return (
    // Six columns so the top row keeps its 4/2 split while the bottom pair
    // divides the same width evenly (3/3).
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-6">
      {/* Without a sidebar there is no second cell to sit beside, so the status
          card takes the whole width rather than leaving a dead quadrant. */}
      <Card className={sidebar ? "lg:col-span-4" : "lg:col-span-6"}>
        <StatusStrip counts={statusCounts} />
      </Card>

      {sidebar && <div className="lg:col-span-2">{sidebar}</div>}

      {/* Nothing scheduled is not a task, so the card is left out entirely
          rather than filling the page with an empty state. */}
      {upcomingEvents.length > 0 && (
        <Card className="space-y-4 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Upcoming (next 7 days)</h2>
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
            description="Track a job to see its status and history here."
            action={
              <Link
                href="/jobs"
                className="text-sm text-brand-400 underline-offset-4 hover:underline"
              >
                Add your first application
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

      {/* A progress meter, not a task — it sits after the lists that are. */}
      <Card className="space-y-4 lg:col-span-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
              <Target className="h-5 w-5 text-brand-400" />
            </div>
            <div>
              <p className="text-sm font-medium">Applied today</p>
              <p className="text-xs text-muted-foreground">
                {goalMet
                  ? "Daily goal reached — nice work."
                  : `${DAILY_JOB_GOAL - appliedToday} to go for today's goal`}
              </p>
            </div>
          </div>
          <p className="font-mono text-2xl font-bold">
            {appliedToday}{" "}
            <span className="text-base text-muted-foreground">
              / {DAILY_JOB_GOAL}
            </span>
          </p>
        </div>
        <Progress
          value={appliedToday}
          max={DAILY_JOB_GOAL}
          size="lg"
          // At zero the bar has no width, so the track carries the meter on its
          // own — an outline keeps it readable against the card fill.
          className="border border-input"
          color={goalMet ? "success" : "brand"}
          label={`Applications today: ${appliedToday} of ${DAILY_JOB_GOAL}`}
        />
      </Card>
    </div>
  )
}
