import Link from "next/link"
import { ArrowRight, BellRing, CalendarClock, Send } from "lucide-react"
import { Badge, type BadgeProps } from "@/shared/ui/badge"
import { Progress } from "@/shared/ui/progress"
import { cn } from "@/shared/lib/utils"
import { calendarDaysBetween, formatCalendarDate } from "@/shared/lib/dates"
import { FOLLOW_UP_DUE_PARAM } from "@/features/jobs/services/follow-up.service"
import type { UpcomingEvent } from "@/features/jobs/services/dashboard-stats.service"

const EVENT_LABELS: Record<UpcomingEvent["type"], string> = {
  interview: "Interview",
  deadline: "Deadline",
  "follow-up": "Follow-up",
  todo: "Task",
}

function relativeDayLabel(days: number): string {
  if (days <= 0) return "Today"
  if (days === 1) return "Tomorrow"
  return `In ${days} days`
}

type Tone = NonNullable<BadgeProps["variant"]>

function applicationsBadge(
  appliedToday: number,
  dailyGoal: number
): {
  label: string
  variant: Tone
} {
  if (appliedToday >= dailyGoal) {
    return { label: "Goal met", variant: "success" }
  }
  if (appliedToday > 0) {
    return {
      label: `${dailyGoal - appliedToday} to go`,
      variant: "info",
    }
  }
  return { label: "Not started", variant: "neutral" }
}

/**
 * The first thing on the dashboard: today's three time-sensitive numbers.
 *
 * It used to live at the very bottom of the page as a progress card, which made
 * the most useful status the last thing a reader reached. It now opens the
 * workflow, above the next action, with each state carrying a colour-coded
 * badge rather than relying on plain text alone.
 */
export function DailyStatus({
  todayStart,
  appliedToday,
  followUpDue,
  dailyGoal,
  upcomingEvents,
}: {
  /** The user's own calendar day (UTC midnight), resolved on the server page. */
  todayStart: Date
  appliedToday: number
  followUpDue: number
  /** The user's saved target, so the strip never hardcodes two applications. */
  dailyGoal: number
  /** Already sorted soonest-first by the dashboard stats service. */
  upcomingEvents: UpcomingEvent[]
}) {
  const goalMet = appliedToday >= dailyGoal
  const applications = applicationsBadge(appliedToday, dailyGoal)
  const nextEvent = upcomingEvents[0]

  return (
    <section
      aria-labelledby="daily-status-heading"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500/10">
            <Send className="h-3.5 w-3.5 text-brand-400" aria-hidden="true" />
          </span>
          <h2 id="daily-status-heading" className="text-sm font-semibold">
            Today
          </h2>
          <span className="text-xs text-muted-foreground">
            {formatCalendarDate(todayStart)}
          </span>
        </div>
        <p className="hidden min-w-0 text-xs text-muted-foreground sm:block">
          Applications, follow-ups and what is coming up.
        </p>
      </div>

      <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="min-w-0 px-4 py-3.5 sm:px-5" data-metric="applications">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">Applications today</p>
            <Badge variant={applications.variant} size="sm">
              {applications.label}
            </Badge>
          </div>
          <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums">
            {appliedToday}
            <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">
              of {dailyGoal} goal
            </span>
          </p>
          <Progress
            value={appliedToday}
            max={dailyGoal}
            size="sm"
            className="mt-2 border border-input"
            color={goalMet ? "success" : "brand"}
            label={`Applications today: ${appliedToday} of ${dailyGoal}`}
          />
        </div>

        <Link
          href={`/jobs?filter=${FOLLOW_UP_DUE_PARAM}`}
          data-metric="follow-ups"
          className="group block min-w-0 px-4 py-3.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <BellRing
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              Follow-ups due
            </p>
            <Badge
              variant={followUpDue > 0 ? "error" : "success"}
              size="sm"
            >
              {followUpDue > 0 ? "Needs a nudge" : "Clear"}
            </Badge>
          </div>
          <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums">
            {followUpDue}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            {followUpDue > 0 ? "Open the overdue list" : "Nothing to chase"}
            <ArrowRight
              className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </p>
        </Link>

        <div className="min-w-0 px-4 py-3.5 sm:px-5" data-metric="upcoming">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <CalendarClock
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              Coming up
            </p>
            <Badge variant={nextEvent ? "info" : "neutral"} size="sm">
              {nextEvent
                ? `${upcomingEvents.length} scheduled`
                : "Nothing scheduled"}
            </Badge>
          </div>
          <p
            className={cn(
              "mt-1.5 truncate text-sm font-medium",
              !nextEvent && "text-muted-foreground",
            )}
          >
            {nextEvent
              ? `${nextEvent.title} · ${EVENT_LABELS[nextEvent.type]}`
              : "Next 7 days are clear"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {nextEvent
              ? relativeDayLabel(
                  calendarDaysBetween(todayStart, nextEvent.date),
                )
              : "No interviews, deadlines or tasks."}
          </p>
        </div>
      </div>
    </section>
  )
}
