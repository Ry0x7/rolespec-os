"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { ApplicationStatus } from "@/generated/prisma/enums"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { Textarea } from "@/shared/ui/textarea"
import { formatCalendarDate } from "@/shared/lib/dates"
import { saveJobApplicationOutcomeNote } from "../actions/job-application.actions"
import { outcomeLabel } from "../services/outcome.service"

/**
 * One-shot hand-off from the inline status select: set just before the refresh
 * that renders this panel, consumed on mount. A plain load of a job that is
 * already over never sees it, so it never steals focus there.
 */
export const OUTCOME_FOCUS_KEY = "rolespec:outcome-note-focus"

export function requestOutcomeNoteFocus(jobApplicationId: string) {
  try {
    window.sessionStorage.setItem(OUTCOME_FOCUS_KEY, jobApplicationId)
  } catch {
    // Storage unavailable (private mode, quota): the panel still renders.
  }
}

function consumeOutcomeNoteFocus(jobApplicationId: string): boolean {
  try {
    if (window.sessionStorage.getItem(OUTCOME_FOCUS_KEY) !== jobApplicationId) {
      return false
    }
    window.sessionStorage.removeItem(OUTCOME_FOCUS_KEY)
    return true
  } catch {
    return false
  }
}

interface OutcomePanelProps {
  jobApplicationId: string
  /** Already narrowed to a terminal status by the caller. */
  status: ApplicationStatus
  /** The day it ended. Null only for applications that ended before this existed. */
  outcomeAt: Date | null
  outcomeNote: string | null
}

/**
 * How this application ended, on the job detail page.
 *
 * Only the note is entered here — the date is stamped by the status move itself,
 * so reaching an outcome costs the user nothing and writing it down stays
 * entirely optional. Deliberately not a modal: capture must never stand between
 * the user and updating a status.
 */
export function OutcomePanel({
  jobApplicationId,
  status,
  outcomeAt,
  outcomeNote,
}: OutcomePanelProps) {
  const router = useRouter()
  const [note, setNote] = useState(outcomeNote ?? "")
  const [isSaving, startSaving] = useTransition()
  const noteRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!consumeOutcomeNoteFocus(jobApplicationId)) return
    const textarea = noteRef.current
    if (!textarea) return
    textarea.scrollIntoView({ behavior: "smooth", block: "center" })
    textarea.focus({ preventScroll: true })
  }, [jobApplicationId])

  const dirty = note !== (outcomeNote ?? "")

  function handleSave() {
    startSaving(async () => {
      const result = await saveJobApplicationOutcomeNote(jobApplicationId, note)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success("Outcome note saved")
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outcome</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {outcomeLabel(status)}
          {outcomeAt ? ` — ${formatCalendarDate(outcomeAt)}` : ""}
        </p>
        <div className="space-y-2">
          <label
            htmlFor="outcome-note"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Note (optional)
          </label>
          <Textarea
            ref={noteRef}
            id="outcome-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What happened, and anything worth remembering next time."
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={isSaving || !dirty}
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            Save note
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
