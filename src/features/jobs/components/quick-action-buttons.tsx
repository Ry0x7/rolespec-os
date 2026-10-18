"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { ApplicationStatus } from "@/generated/prisma/enums"
import { Button, buttonVariants } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { localCalendarDateString } from "@/shared/lib/dates"
import {
  clearJobApplicationFollowUp,
  scheduleJobApplicationFollowUp,
  snoozeJobApplicationFollowUp,
  updateJobApplicationStatus,
} from "../actions/job-application.actions"
import { recheckJobQualification } from "../actions/job-qualification.actions"
import { jobDetailHref } from "../lib/job-detail-href"
import type { QuickAction } from "../services/application-quick-actions"

/**
 * The buttons behind `quickActionsFor` — one small control per action, wired to
 * the same server actions the job detail page calls and saying the same thing
 * in the toast, so acting from the list is the same move as acting from the
 * page.
 *
 * Shared by the tracker card and the dashboard's overdue follow-ups, because
 * those two lists are the only places an action is offered away from the job.
 */

interface QuickActionButtonsProps {
  applicationId: string
  /** Named in every accessible label, so a list of rows has distinct controls. */
  companyName: string
  actions: QuickAction[]
  className?: string
}

/** Every kind except `open`, which is a link and writes nothing. */
type QuickActionWrite = Exclude<QuickAction["kind"], "open">

/** What each kind says once it has worked, worded as the job page words it. */
const SUCCESS_TOAST: Record<QuickActionWrite, string> = {
  "mark-applied": "Marked as applied",
  "follow-up-done": "Follow-up logged",
  "snooze-week": "Follow-up snoozed for a week",
  "schedule-follow-up": "Follow-up scheduled for next week",
  // Worded for a row that never had a verdict, which is the only row that
  // offers this — the job page picks between this and "Fit re-checked"
  // depending on whether a snapshot was already there.
  "check-fit": "Fit checked",
}

function ariaLabelFor(action: QuickAction, companyName: string): string {
  switch (action.kind) {
    case "mark-applied":
      return `Mark ${companyName} as applied`
    case "follow-up-done":
      return `Mark the follow-up for ${companyName} as done`
    case "snooze-week":
      return `Snooze the follow-up for ${companyName} by 1 week`
    case "schedule-follow-up":
      return `Schedule a follow-up for ${companyName} in 1 week`
    case "check-fit":
      return `Check how ${companyName} fits your Career Profile`
    case "open":
      return `${action.label} — ${companyName}`
  }
}

export function QuickActionButtons({
  applicationId,
  companyName,
  actions,
  className,
}: QuickActionButtonsProps) {
  const router = useRouter()
  // One transition for the whole group: two writes to the same row at once is
  // never something the user meant, so pressing one disables the other. The
  // kind is tracked separately so only the pressed button shows the spinner.
  const [isPending, startAction] = useTransition()
  const [runningKind, setRunningKind] = useState<QuickActionWrite | null>(null)

  if (actions.length === 0) return null

  function run(kind: QuickActionWrite) {
    setRunningKind(kind)
    startAction(async () => {
      // The caller's own calendar day, so "today" and "a week out" are counted
      // where the user is rather than wherever the server runs.
      const today = localCalendarDateString()
      const result =
        kind === "mark-applied"
          ? await updateJobApplicationStatus(
              applicationId,
              ApplicationStatus.APPLIED,
              today,
            )
          : kind === "follow-up-done"
            ? await clearJobApplicationFollowUp(applicationId)
            : kind === "snooze-week"
              ? await snoozeJobApplicationFollowUp(applicationId, today)
              : kind === "check-fit"
                ? await recheckJobQualification(applicationId)
                : await scheduleJobApplicationFollowUp(applicationId, today)

      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success(SUCCESS_TOAST[kind])
      router.refresh()
    })
  }

  return (
    <>
      {actions.map((action) =>
        action.kind === "open" ? (
          <Link
            key={action.kind}
            href={jobDetailHref(applicationId, action.section)}
            aria-label={ariaLabelFor(action, companyName)}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              className,
            )}
          >
            {action.label}
          </Link>
        ) : (
          <Button
            key={action.kind}
            size="sm"
            variant="outline"
            className={className}
            loading={isPending && runningKind === action.kind}
            disabled={isPending}
            aria-label={ariaLabelFor(action, companyName)}
            onClick={() => run(action.kind as QuickActionWrite)}
          >
            {action.label}
          </Button>
        ),
      )}
    </>
  )
}
