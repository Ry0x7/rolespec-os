"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/shared/ui/card"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "@/shared/ui/dialog"
import { formatDate } from "@/shared/lib/utils"
import { deleteCoverLetter } from "../actions/cover-letter.actions"

interface Props {
  coverLetter: {
    id: string
    createdAt: Date
    resume: { title: string }
    jobApplication: { id: string; companyName: string; jobTitle: string } | null
    contentExcerpt: string
  }
}

export function CoverLetterCard({ coverLetter }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (confirmDelete) {
      cancelDeleteRef.current?.focus()
    }
  }, [confirmDelete])

  useEffect(() => {
    if (!confirmDelete) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isDeleting) setConfirmDelete(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [confirmDelete, isDeleting])

  async function handleDelete() {
    setIsDeleting(true)
    const result = await deleteCoverLetter(coverLetter.id)
    setIsDeleting(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success("Cover letter deleted")
      setConfirmDelete(false)
    }
  }

  const application = coverLetter.jobApplication
  // Screen-reader-only: name the letter by its job when linked, otherwise by
  // the resume it was written from. "Standalone" was meaningless out loud.
  const deleteLabel = application
    ? `Delete cover letter for ${application.companyName} — ${application.jobTitle}`
    : coverLetter.resume.title
      ? `Delete cover letter for ${coverLetter.resume.title}`
      : "Delete cover letter"

  return (
    <div className="group relative">
      <Card className="h-full transition-colors hover:border-brand-700/50">
        <CardContent className="flex flex-col gap-2">
          {/* Which job this letter is for, and a way to it. A sibling of the
              editor link rather than a child: anchors cannot nest. `pr-8`
              keeps a long title clear of the hover delete button. */}
          <div className="min-w-0 pr-8">
            {application ? (
              <Link
                href={`/jobs/${application.id}`}
                className="block truncate rounded-sm font-semibold text-brand-400 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {application.companyName} — {application.jobTitle}
              </Link>
            ) : (
              <p className="truncate font-semibold text-muted-foreground">
                Not linked to a job
              </p>
            )}
          </div>
          <Link
            href={`/jobs/cover-letter/${coverLetter.id}`}
            className="flex flex-col gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="truncate text-sm text-muted-foreground">
              {coverLetter.resume.title}
            </p>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {coverLetter.contentExcerpt}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDate(coverLetter.createdAt.toISOString())}
            </p>
          </Link>
        </CardContent>
      </Card>

      <div className="absolute right-2 top-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-error"
          aria-label={deleteLabel}
          onClick={(e) => {
            e.preventDefault()
            setConfirmDelete(true)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => { if (!isDeleting) setConfirmDelete(false) }}
        maxWidth="max-w-sm"
        aria-labelledby="delete-cover-letter-dialog-title"
      >
        <DialogHeader>
          <h2
            id="delete-cover-letter-dialog-title"
            className="text-lg font-semibold"
          >
            Delete cover letter?
          </h2>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">
            This cover letter will be deleted. This action cannot be undone.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button
            ref={cancelDeleteRef}
            variant="ghost"
            size="sm"
            onClick={() => { if (!isDeleting) setConfirmDelete(false) }}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={isDeleting}
            onClick={handleDelete}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
