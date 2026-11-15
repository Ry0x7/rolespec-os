"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "@/shared/ui/dialog"
import { deleteJobApplications } from "../actions/job-application.actions"

interface BulkDeleteJobsDialogProps {
  /** The selected application ids, in no particular order. */
  ids: string[]
  open: boolean
  onClose: () => void
  /** Runs after a successful delete — the caller clears its selection and refreshes. */
  onDeleted: () => void
}

function jobsWord(count: number): string {
  return count === 1 ? "job" : "jobs"
}

/**
 * Confirm-and-delete for the `/jobs` select mode, on the same dialog primitives
 * and toast as the single-row `DeleteJobDialog`.
 */
export function BulkDeleteJobsDialog({
  ids,
  open,
  onClose,
  onDeleted,
}: BulkDeleteJobsDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const count = ids.length

  async function handleDelete() {
    setIsDeleting(true)
    const result = await deleteJobApplications([...ids])
    setIsDeleting(false)
    if ("error" in result) {
      toast.error(result.error)
      return
    }
    const skipped = result.skippedIds.length
    toast.success(
      `Deleted ${result.deletedCount} ${jobsWord(result.deletedCount)}` +
        (skipped > 0 ? ` (${skipped} skipped)` : ""),
    )
    onClose()
    onDeleted()
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!isDeleting) onClose()
      }}
      maxWidth="max-w-sm"
      aria-labelledby="bulk-delete-jobs-title"
    >
      <DialogHeader>
        <h2
          id="bulk-delete-jobs-title"
          className="text-lg font-semibold text-foreground"
        >
          Delete {count} saved {jobsWord(count)}?
        </h2>
      </DialogHeader>
      <DialogBody>
        <p className="text-sm text-muted-foreground">
          This cannot be undone. It removes their postings too.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" disabled={isDeleting} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" loading={isDeleting} onClick={handleDelete}>
          Delete
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
