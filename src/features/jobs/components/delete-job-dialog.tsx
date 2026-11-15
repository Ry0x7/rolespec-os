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
import { deleteJobApplication } from "../actions/job-application.actions"

interface DeleteJobDialogProps {
  application: { id: string; companyName: string }
  open: boolean
  onClose: () => void
  /** Runs after a successful delete — the caller decides refresh vs navigate. */
  onDeleted: () => void
}

/**
 * The confirm-and-delete dialog shared by the `/jobs` card and the job detail
 * page, so both surfaces stay on the same copy.
 */
export function DeleteJobDialog({
  application,
  open,
  onClose,
  onDeleted,
}: DeleteJobDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    setIsDeleting(true)
    const result = await deleteJobApplication(application.id)
    setIsDeleting(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    toast.success("Application deleted")
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
      aria-labelledby={`delete-job-${application.id}-title`}
    >
      <DialogHeader>
        <h2
          id={`delete-job-${application.id}-title`}
          className="text-lg font-semibold text-foreground"
        >
          Delete application?
        </h2>
      </DialogHeader>
      <DialogBody>
        <p className="text-sm text-muted-foreground">
          Delete {application.companyName}? Linked cover letters will be
          unlinked, not deleted.
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
