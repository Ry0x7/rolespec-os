"use client"

import { memo, useContext } from "react"
import Link from "next/link"
import { ArrowUpRight, BellRing, CalendarClock, CalendarCheck } from "lucide-react"
import { cn, formatDate } from "@/shared/lib/utils"
import { calendarDaysBetween, formatCalendarDate } from "@/shared/lib/dates"
import { Select } from "@/shared/ui/select"
import { FollowUpActions } from "@/features/jobs/components/follow-up-actions"
import {
  FOLLOW_UP_STATUSES,
  isFollowUpDue,
} from "@/features/jobs/services/follow-up.service"
import type { ApplicationStatus } from "@/generated/prisma/enums"
import type { WorkspaceJobRow } from "../workspace-board"
import { KanbanStatusContext, KanbanTodayContext, STATUS_LABELS } from "./kanban-status"

export const KanbanCard = memo(function KanbanCard({
  job,
  selected,
  onToggleSelect,
}: {
  job: WorkspaceJobRow
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const changeStatus = useContext(KanbanStatusContext)
  const today = useContext(KanbanTodayContext)

  // Same rule as the jobs list: only an application still waiting on a reply
  // has a follow-up to show, so a stale date on a closed one stays hidden.
  const followUpAt = FOLLOW_UP_STATUSES.includes(job.status) ? job.followUpAt : null
  const followUpDue = followUpAt !== null && today !== null && isFollowUpDue(followUpAt, today)
  // isFollowUpDue includes today; the suffix splits "due today" from a date
  // that has actually passed, in Job Detail's wording.
  const followUpDueLabel = followUpDue
    ? calendarDaysBetween(followUpAt, today) === 0
      ? " — due today"
      : " — overdue"
    : ""

  return (
    <div
      className={cn(
        "glass rounded-md border border-border p-2 text-sm",
        selected && "border-primary/60 ring-1 ring-primary/30",
      )}
    >
      {onToggleSelect && (
        <div className="mb-1 flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={() => onToggleSelect(job.id)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${job.job.title} at ${job.job.companyName} for bulk actions`}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-current"
          />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Select
          </span>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold leading-tight">
            {job.job.companyName}
          </p>
          <p className="truncate text-xs leading-tight text-muted-foreground">
            {job.job.title}
          </p>
        </div>
        <Link
          href={`/jobs/${job.id}`}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Open application"
        >
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      {(changeStatus || job.job.deadline || job.interviewDate) && (
        // One row: the status select shares it with the date badges so a card
        // with a deadline doesn't grow a third line.
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {changeStatus && (
            // Non-drag fallback. The drag listeners live on the wrapper in
            // KanbanColumn, so the pointer events are stopped here the same way
            // the "Open application" link stops them.
            <Select
              aria-label={`Status for ${job.job.title} at ${job.job.companyName}`}
              value={job.status}
              onChange={(e) =>
                changeStatus(job.id, e.target.value as ApplicationStatus)
              }
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="h-7 w-auto min-w-0 flex-1 basis-24 px-2 text-xs sm:h-7 sm:text-xs"
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
          {job.job.deadline && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <CalendarClock className="h-3 w-3" />
              {formatCalendarDate(job.job.deadline)}
            </span>
          )}
          {job.interviewDate && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <CalendarCheck className="h-3 w-3" />
              {formatDate(job.interviewDate)}
            </span>
          )}
        </div>
      )}
      {followUpAt && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          <span
            className={cn(
              "inline-flex min-w-0 items-center gap-1",
              followUpDue ? "text-error" : "text-muted-foreground",
            )}
          >
            <BellRing className="h-3 w-3 shrink-0" aria-hidden="true" />
            Follow up {formatCalendarDate(followUpAt)}
            {followUpDueLabel}
          </span>
          {/* Same stop as the status select: the drag listeners live on the
              wrapper in KanbanColumn, so a press on Done / Snooze must not
              start a drag (pointer, touch, or Space/Enter for the keyboard). */}
          <span
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <FollowUpActions jobApplicationId={job.id} compact />
          </span>
        </div>
      )}
    </div>
  )
})
