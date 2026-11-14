"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { Button } from "@/shared/ui/button"
import { localCalendarDateString } from "@/shared/lib/dates"
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "@/shared/ui/dialog"
import {
  createJobApplication,
  updateJobApplicationStatus,
  type DuplicateJobApplicationResult,
} from "../actions/job-application.actions"
import {
  EMPTY_NEW_ROW_DRAFT,
  buildCreateFormData,
  needsAppliedStatusFollowUp,
  type NewRowDraft,
} from "./job-table-utils"
import { JOB_FORM_FIELDS, JobFormFields } from "./job-form-fields"
import { DuplicateJobNotice } from "./duplicate-job-notice"

/**
 * The dialog collects more than the table's new row did, but `buildCreateFormData`
 * only cares that every value is a string — the extra keys ride along.
 */
type CreateDraft = NewRowDraft & Record<string, string>

function readDraft(formData: FormData): CreateDraft {
  const draft: CreateDraft = { ...EMPTY_NEW_ROW_DRAFT }
  for (const field of JOB_FORM_FIELDS) {
    draft[field] = String(formData.get(field) ?? "")
  }
  return draft
}

interface CreateJobDialogProps {
  /**
   * Optional external control, so a second trigger (the `/jobs` empty-state CTA)
   * can open the same dialog. Omitted, the trigger button owns the state.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CreateJobDialog({
  open: controlledOpen,
  onOpenChange,
}: CreateJobDialogProps = {}) {
  const router = useRouter()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] =
    useState<DuplicateJobApplicationResult | null>(null)
  /** The refused draft, kept so "Add anyway" can resubmit it unchanged. */
  const [refusedDraft, setRefusedDraft] = useState<CreateDraft | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) firstFieldRef.current?.focus()
  }, [open])

  function handleClose() {
    if (isSaving) return
    setOpen(false)
    setError(null)
    setDuplicate(null)
    setRefusedDraft(null)
    triggerRef.current?.focus()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submitDraft(readDraft(new FormData(event.currentTarget)), false)
  }

  async function submitDraft(draft: CreateDraft, force: boolean) {
    setIsSaving(true)
    setError(null)
    setDuplicate(null)
    const createFormData = buildCreateFormData(draft)
    // A create that lands directly on a terminal status stamps `outcomeAt` the
    // same way `updateJobApplicationStatus` stamps it below: the client's own
    // calendar day, never the server's.
    createFormData.set("clientToday", localCalendarDateString())
    const result = await createJobApplication(createFormData, { force })
    // Nothing was written: the notice replaces the plain error so the user can
    // open what they already track, or insist.
    if (result && "code" in result) {
      setIsSaving(false)
      setDuplicate(result)
      setRefusedDraft(draft)
      return
    }
    if (result?.error) {
      setIsSaving(false)
      setError(result.error)
      return
    }

    // `dateApplied` is only stamped on a transition TO APPLIED, so an APPLIED
    // application is created at the default status and then transitioned.
    if (needsAppliedStatusFollowUp(draft) && result?.id) {
      const statusResult = await updateJobApplicationStatus(
        result.id,
        ApplicationStatus.APPLIED,
        localCalendarDateString()
      )
      if (statusResult?.error) {
        setIsSaving(false)
        setOpen(false)
        toast.error(
          "Application added, but the status could not be set to Applied. Please set it manually."
        )
        router.refresh()
        return
      }
    }

    setIsSaving(false)
    setOpen(false)
    const createdId = result?.id
    toast.success(
      "Application added",
      createdId
        ? {
            action: {
              label: "Open",
              onClick: () => router.push(`/jobs/${createdId}`),
            },
          }
        : undefined
    )
    router.refresh()
  }

  return (
    <>
      <Button ref={triggerRef} size="lg" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add application
      </Button>

      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="max-w-2xl"
        aria-labelledby="create-job-dialog-title"
      >
        <DialogHeader>
          <h2 id="create-job-dialog-title" className="text-lg font-semibold">
            Add application
          </h2>
        </DialogHeader>

        {/* The form owns the column so its submit button can live in the
            footer while only the fields scroll. */}
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="space-y-4">
            <JobFormFields ref={firstFieldRef} idPrefix="create-job" />

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
            {duplicate?.code === "POSSIBLE_DUPLICATE" && refusedDraft ? (
              <Button
                type="button"
                variant="ghost"
                disabled={isSaving}
                onClick={() => void submitDraft(refusedDraft, true)}
              >
                Add anyway
              </Button>
            ) : null}
            <Button type="submit" loading={isSaving}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  )
}
