"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { ApplicationStatus } from "@/generated/prisma/enums"
import { Button } from "@/shared/ui/button"
import { localCalendarDateString } from "@/shared/lib/dates"
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "@/shared/ui/dialog"
import {
  updateJobApplication,
  updateJobApplicationStatus,
  type DuplicateJobApplicationResult,
} from "../actions/job-application.actions"
import type { JobFormApplication } from "./job-form-application"
import { JobFormFields } from "./job-form-fields"
import { DuplicateJobNotice } from "./duplicate-job-notice"

interface EditJobDialogProps {
  application: JobFormApplication
  onClose: () => void
  /**
   * Lands focus on one field instead of the first one — used by the "Add job
   * description" affordances, which would otherwise drop the user at Company.
   */
  focusField?: "jobDescription" | null
}

export function EditJobDialog({
  application,
  onClose,
  focusField = null,
}: EditJobDialogProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] =
    useState<DuplicateJobApplicationResult | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const fieldIdPrefix = `edit-job-${application.id}`

  useEffect(() => {
    if (focusField) {
      const target = document.getElementById(`${fieldIdPrefix}-${focusField}`)
      if (target instanceof HTMLTextAreaElement) {
        target.focus()
        // Caret at the end, so typing appends to an existing description.
        target.setSelectionRange(target.value.length, target.value.length)
        return
      }
    }
    firstFieldRef.current?.focus()
  }, [focusField, fieldIdPrefix])

  function handleClose() {
    if (isSaving) return
    onClose()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    // Status must go through the dedicated action — it stamps `dateApplied` on
    // the transition to APPLIED — so it is stripped from the general update payload.
    const submittedStatus = String(formData.get("status") ?? "")
    formData.delete("status")
    const nextStatus = submittedStatus as ApplicationStatus
    const statusChanged =
      submittedStatus !== "" && nextStatus !== application.status

    setIsSaving(true)
    setError(null)
    setDuplicate(null)
    const result = await updateJobApplication(application.id, formData)
    // The edited link belongs to a posting the user already tracks: nothing was
    // written, and the notice says which one rather than "something went wrong".
    if (result && "code" in result) {
      setIsSaving(false)
      setDuplicate(result)
      return
    }
    if (result?.error) {
      setIsSaving(false)
      setError(result.error)
      return
    }

    if (statusChanged) {
      const statusResult = await updateJobApplicationStatus(
        application.id,
        nextStatus,
        localCalendarDateString()
      )
      if (statusResult?.error) {
        setIsSaving(false)
        setError(statusResult.error)
        return
      }
    }

    setIsSaving(false)
    toast.success("Application updated")
    onClose()
    router.refresh()
  }

  return (
    <Dialog
      open
      onClose={handleClose}
      maxWidth="max-w-2xl"
      aria-labelledby={`${fieldIdPrefix}-title`}
    >
      <DialogHeader>
        <h2
          id={`${fieldIdPrefix}-title`}
          className="text-lg font-semibold"
        >
          Edit application
        </h2>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          <JobFormFields
            ref={firstFieldRef}
            application={application}
            idPrefix={fieldIdPrefix}
          />

          {duplicate ? <DuplicateJobNotice duplicate={duplicate} /> : null}

          {error ? <p className="text-sm text-error">{error}</p> : null}
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={isSaving}
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button type="submit" loading={isSaving}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
