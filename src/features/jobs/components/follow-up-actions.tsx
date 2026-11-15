"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { calendarDaysBetween, localCalendarDateString } from "@/shared/lib/dates"
import {
  clearJobApplicationFollowUp,
  snoozeJobApplicationFollowUp,
} from "../actions/job-application.actions"
import { useJobEdit } from "./job-edit-context"

interface FollowUpActionsProps {
  jobApplicationId: string
  /** Drops the top margin so the controls can sit inline beside the date (workspace card). */
  compact?: boolean
}

/**
 * The two ways out of a scheduled follow-up, next to the date itself.
 *
 * Without these the schedule button is a one-way door: it disappears once a
 * date is set, and the only way back was to find the Edit dialog and guess that
 * the field lives in there. "Done" clears the date, which is also what makes
 * the overdue badge and the dashboard nag go away — both key off `followUpAt`.
 */
export function FollowUpActions({ jobApplicationId, compact = false }: FollowUpActionsProps) {
  const router = useRouter()
  const jobEdit = useJobEdit()
  const [isClearing, startClearing] = useTransition()
  const [isSnoozing, startSnoozing] = useTransition()

  function handleDone() {
    startClearing(async () => {
      const result = await clearJobApplicationFollowUp(jobApplicationId)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Follow-up logged")
      router.refresh()
    })
  }

  // Same action and wording as the dashboard's "Snooze 1 week" quick action,
  // counted from the caller's own calendar day.
  function handleSnooze() {
    startSnoozing(async () => {
      const result = await snoozeJobApplicationFollowUp(
        jobApplicationId,
        localCalendarDateString()
      )
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Follow-up snoozed for a week")
      router.refresh()
    })
  }

  return (
    <span className={`${compact ? "" : "mt-1 "}flex items-center gap-3 text-xs`}>
      <button
        type="button"
        onClick={handleDone}
        disabled={isClearing || isSnoozing}
        aria-label="Mark the follow-up as done"
        className="inline-flex items-center gap-1 rounded-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {isClearing ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : null}
        Done
      </button>
      <button
        type="button"
        onClick={handleSnooze}
        disabled={isClearing || isSnoozing}
        aria-label="Snooze the follow-up by 1 week"
        className="inline-flex items-center gap-1 rounded-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {isSnoozing ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : null}
        Snooze 1 week
      </button>
      {jobEdit ? (
        <button
          type="button"
          onClick={() => jobEdit.openEdit()}
          aria-label="Change the follow-up date"
          className="rounded-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Change
        </button>
      ) : null}
    </span>
  )
}

interface LastFollowUpNoteProps {
  /** The user's calendar day of the last follow-up, as UTC midnight (`getUserDayStart(lastFollowedUpAt)`). */
  lastFollowedUpAt: Date
  /** The user's day start, from the server (`getUserDayStart()`). */
  today: Date
}

/**
 * The one line left behind once a follow-up is marked done, so the Track
 * section remembers that the chase happened instead of going blank.
 * Both dates are calendar days (UTC midnight) on the user's own calendar.
 */
export function LastFollowUpNote({ lastFollowedUpAt, today }: LastFollowUpNoteProps) {
  const days = Math.max(0, calendarDaysBetween(lastFollowedUpAt, today))
  const when =
    days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`
  return (
    <p className="text-xs text-muted-foreground">Followed up {when}</p>
  )
}
