"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { BellPlus, CheckCircle2, FileText, Loader2, Pencil, PenLine, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { Button } from "@/shared/ui/button"
import { Select } from "@/shared/ui/select"
import { localCalendarDateString } from "@/shared/lib/dates"
import {
  scheduleJobApplicationFollowUp,
  selectJobApplicationResume,
  updateJobApplicationStatus,
} from "../actions/job-application.actions"
import { FOLLOW_UP_STATUSES } from "../services/follow-up.service"
import { isTerminalStatus } from "../services/outcome.service"
import { requestOutcomeNoteFocus } from "./outcome-panel"
import { jobDetailHref } from "../lib/job-detail-href"
import { STATUS_OPTIONS } from "./job-form-options"
import { DeleteJobDialog } from "./delete-job-dialog"
import { EditJobDialog } from "./edit-job-dialog"
import { useJobEdit } from "./job-edit-context"
import type { JobFormApplication } from "./job-form-application"

/**
 * The statuses an application in flight can move to: everything forward of
 * INTERESTED, terminal ones included. Moving *back* to INTERESTED is a
 * correction, not a move, so it stays in the Edit dialog.
 */
const FORWARD_STATUS_OPTIONS = STATUS_OPTIONS.filter(
  (option) => option.value !== ApplicationStatus.INTERESTED
)

/** The in-flight statuses that get the inline select. */
const ADVANCEABLE_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.APPLIED,
  ApplicationStatus.SCREENING,
  ApplicationStatus.INTERVIEW,
]

interface JobDetailActionsProps {
  application: JobFormApplication
  /** The persisted resume choice (null when none is saved or it is archived). */
  savedResumeId?: string | null
  /** The resume the page is working from: the saved choice, else the recommendation. */
  effectiveResumeId?: string | null
}

/**
 * Edit + Delete for the job detail header — the same two controls the `/jobs`
 * card has, so a job opened from a bookmark or the dashboard is not read-only.
 */
export function JobDetailActions({
  application,
  savedResumeId = null,
  effectiveResumeId = null,
}: JobDetailActionsProps) {
  const router = useRouter()
  // Inside a `JobEditProvider` the dialog is shared with the AI panels; the
  // local copy is the fallback for any caller that has no provider above it.
  const jobEdit = useJobEdit()
  const [showEdit, setShowEdit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isMarking, startMarking] = useTransition()
  const [isScheduling, startScheduling] = useTransition()

  // Only offered while the application is actually waiting on a reply and has
  // no follow-up yet; a scheduled one is edited from the dialog, not re-added.
  const canScheduleFollowUp =
    application.followUpAt === null &&
    FOLLOW_UP_STATUSES.includes(application.status)

  function handleScheduleFollowUp() {
    startScheduling(async () => {
      const result = await scheduleJobApplicationFollowUp(
        application.id,
        localCalendarDateString()
      )
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Follow-up scheduled for next week")
      router.refresh()
    })
  }

  // Only the saved-but-not-yet-sent state gets the shortcut. Every later status
  // is a move the user has to pick deliberately (the Edit dialog owns those),
  // and the action itself is what stamps `dateApplied` on the transition.
  const canMarkApplied = application.status === ApplicationStatus.INTERESTED

  function handleMarkApplied() {
    startMarking(async () => {
      // The resume panel shows the recommendation as the effective resume
      // before anything is saved. Applying is the moment that choice becomes
      // real, so commit it first; if that fails, the status stays put.
      if (savedResumeId === null && effectiveResumeId) {
        const selected = await selectJobApplicationResume(
          application.id,
          effectiveResumeId
        )
        if ("error" in selected) {
          toast.error(selected.error)
          return
        }
      }
      const result = await updateJobApplicationStatus(
        application.id,
        ApplicationStatus.APPLIED,
        localCalendarDateString()
      )
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Marked as applied")
      router.refresh()
    })
  }

  const isTerminal = isTerminalStatus(application.status)
  const canReopen = isTerminal

  function handleReopen() {
    startMarking(async () => {
      const result = await updateJobApplicationStatus(
        application.id,
        ApplicationStatus.INTERESTED,
        localCalendarDateString()
      )
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Reopened — back to Interested")
      router.refresh()
    })
  }

  // Once the application is in flight, the next move used to mean opening the
  // Edit dialog. The same action Mark applied uses does the move here, and it
  // is the one place `outcomeAt` gets stamped when the pick is a terminal one.
  const canAdvanceStatus = ADVANCEABLE_STATUSES.includes(application.status)

  function handleAdvanceStatus(next: ApplicationStatus) {
    if (next === application.status) return
    startMarking(async () => {
      const result = await updateJobApplicationStatus(
        application.id,
        next,
        localCalendarDateString()
      )
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      const label = FORWARD_STATUS_OPTIONS.find((option) => option.value === next)?.label
      toast.success(`Moved to ${label ?? next}`)
      // The outcome panel only appears after the refresh; this one-shot flag
      // tells it to bring its note into view when it mounts.
      if (isTerminalStatus(next)) requestOutcomeNoteFocus(application.id)
      router.refresh()
    })
  }

  return (
    <>
      {canAdvanceStatus && (
        <Select
          aria-label={`Status for ${application.companyName}`}
          value={application.status}
          disabled={isMarking}
          onChange={(event) =>
            handleAdvanceStatus(event.target.value as ApplicationStatus)
          }
          className="h-8 w-auto min-w-0 px-2 text-xs sm:h-8 sm:text-xs"
        >
          {FORWARD_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
      {canReopen && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleReopen}
          disabled={isMarking}
          aria-label={`Reopen ${application.companyName}`}
        >
          {isMarking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Reopen
        </Button>
      )}
      {!isTerminal && (
        <>
          <Link
            href={jobDetailHref(application.id, "prepare")}
            aria-label={`Tailor resume for ${application.companyName}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:border-brand-600 hover:text-brand-500"
          >
            <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
            Tailor
          </Link>
          <Link
            href={jobDetailHref(application.id, "prepare")}
            aria-label={`Cover letter for ${application.companyName}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:border-brand-600 hover:text-brand-500"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Cover letter
          </Link>
        </>
      )}
      {canMarkApplied && (
        <Button
          size="sm"
          onClick={handleMarkApplied}
          disabled={isMarking}
          aria-label={`Mark ${application.companyName} as applied`}
        >
          {isMarking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Mark applied
        </Button>
      )}
      {canScheduleFollowUp && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleScheduleFollowUp}
          disabled={isScheduling}
          aria-label={`Schedule a follow-up for ${application.companyName} in 1 week`}
        >
          {isScheduling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <BellPlus className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Schedule follow-up in 1 week
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        aria-label={`Edit ${application.companyName}`}
        onClick={() => (jobEdit ? jobEdit.openEdit() : setShowEdit(true))}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        Edit
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="hover:text-destructive"
        aria-label={`Delete ${application.companyName}`}
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete
      </Button>

      <DeleteJobDialog
        application={application}
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onDeleted={() => {
          router.push("/jobs")
          router.refresh()
        }}
      />

      {showEdit ? (
        <EditJobDialog
          application={application}
          onClose={() => setShowEdit(false)}
        />
      ) : null}
    </>
  )
}
