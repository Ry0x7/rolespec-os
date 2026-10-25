import { memo, useMemo } from "react"
import Link from "next/link"
import { ArrowRight, BellRing, CalendarClock, ListTodo } from "lucide-react"

export interface TodayFocusItem {
  title: string
  description: string
  href: string
  cta: string
}

interface TodayFocusProps {
  /** The user's day; greeting + heading derive from it. */
  date?: Date
  followUpDue: number
  interviewsToday: number
  overdueTodos: number
  openTodos: number
  nextAction?: TodayFocusItem | null
}

function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 5) return "Up late"
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
})

/**
 * OS command-center hero: one glance at what today demands before the user
 * touches any tab. Counts are computed server-side; this is pure presentational
 * so it stays cheap and testable.
 */
export function TodayFocus({
  date,
  followUpDue,
  interviewsToday,
  overdueTodos,
  openTodos,
  nextAction,
}: TodayFocusProps) {
  const now = date ?? new Date()
  const tiles = useMemo(
    () => [
      {
        label: "Follow-ups due",
        value: followUpDue,
        href: "/jobs?filter=follow-up-due",
        icon: BellRing,
        alert: followUpDue > 0,
      },
      {
        label: "Interviews today",
        value: interviewsToday,
        href: "/planner",
      icon: CalendarClock,
      alert: interviewsToday > 0,
    },
      {
        label: "Overdue tasks",
        value: overdueTodos,
        href: "/planner",
        icon: ListTodo,
        alert: overdueTodos > 0,
      },
    ],
    [followUpDue, interviewsToday, overdueTodos]
  )

  return (
    <section
      aria-label="Today's focus"
      className="rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {dateFmt.format(now)} · Today&apos;s focus
          </p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">
            {greetingFor(now)} — {openTodos === 0 ? "pipeline is clear" : `${openTodos} open ${openTodos === 1 ? "task" : "tasks"}`}
          </h2>
        </div>
        {nextAction && (
          <Link
            href={nextAction.href}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {nextAction.cta}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>

      {nextAction && (
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{nextAction.title}</span>
          {" — "}
          {nextAction.description}
        </p>
      )}

      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {tiles.map(({ label, value, href, icon: Icon, alert }) => (
          <li key={label}>
            <Link
              href={href}
              className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5 transition-colors hover:border-brand-500/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={
                  alert
                    ? "flex h-8 w-8 items-center justify-center rounded-md bg-error/10"
                    : "flex h-8 w-8 items-center justify-center rounded-md bg-muted"
                }
              >
                <Icon
                  className={alert ? "h-4 w-4 text-error" : "h-4 w-4 text-muted-foreground"}
                  aria-hidden="true"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-lg font-bold tabular-nums leading-none">
                  {value}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {label}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
