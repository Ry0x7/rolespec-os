"use client"

import Link from "next/link"
import { ArrowUpRight, BellRing, CalendarClock, TrendingUp } from "lucide-react"
import { cn, formatDate } from "@/shared/lib/utils"
import { formatCalendarDate } from "@/shared/lib/dates"
import type { WorkspaceJobRow } from "./workspace-board"
import { groupFollowUps, summarizeWorkspace } from "../hooks/use-workspace-filters"

const GROUP_TITLES = {
  overdue: "Overdue",
  today: "Due today",
  upcoming: "Upcoming",
} as const

export function FollowUpsPanel({
  jobs,
  today,
}: {
  jobs: WorkspaceJobRow[]
  today: Date
}) {
  const grouped = groupFollowUps(jobs, today).slice(0, 8)
  const summary = summarizeWorkspace(jobs, today)

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-label="Follow-up reminders">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <BellRing className="h-4 w-4 text-muted-foreground" aria-hidden />
          Follow-ups
          {summary.dueFollowUps > 0 && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                summary.overdueFollowUps > 0
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
              )}
            >
              {summary.dueFollowUps} due
            </span>
          )}
        </h3>
        {grouped.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing scheduled. Open an application to set its next follow-up
            date.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {grouped.map(({ job, group }) => (
              <li
                key={job.id}
                className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-sm"
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    group === "overdue"
                      ? "bg-red-500"
                      : group === "today"
                        ? "bg-amber-500"
                        : "bg-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium leading-tight">
                    {job.job.companyName}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {job.job.title}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "block text-xs",
                      group === "overdue"
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {GROUP_TITLES[group]}
                    {job.followUpAt &&
                      ` · ${formatCalendarDate(job.followUpAt)}`}
                  </span>
                </span>
                <Link
                  href={`/jobs/${job.id}`}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label={`Open ${job.job.companyName} application`}
                >
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Outcomes summary">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
          Outcomes
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          {(
            [
              ["Active", String(summary.active)],
              ["Interviews", String(summary.interviews)],
              ["Offers", String(summary.offers)],
              ["Response", `${summary.responseRate}%`],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="rounded-md border border-border bg-background/40 px-2.5 py-2"
            >
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-mono text-lg font-bold leading-tight">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {summary.total === 0
              ? "Add your first application below to start the pipeline."
              : `Tracking ${summary.total} application${summary.total === 1 ? "" : "s"}. Notes live on each job page — open a card for details${summary.dueFollowUps > 0 ? `, ${summary.dueFollowUps} follow-up${summary.dueFollowUps === 1 ? " needs" : "s need"} attention` : ""}.`}
            {summary.total > 0 && (
              <>
                {" "}
                Last activity {formatDate(today)}.
              </>
            )}
          </span>
        </p>
      </section>
    </div>
  )
}
