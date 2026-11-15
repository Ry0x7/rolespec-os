"use client"

import { useMemo } from "react"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "@/shared/ui/dialog"
import { serializeSections } from "../lib/serialize-sections"
import { useResumeStore } from "../hooks/use-resume-store"

interface ATSViewDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Shows the plain text an applicant tracking system extracts from the resume —
 * the exact string the ATS analyzer scores, rendered from the sections that are
 * in the editor right now.
 */
export function ATSViewDialog({ open, onClose }: ATSViewDialogProps) {
  const sections = useResumeStore((s) => s.resume?.sections)

  const text = useMemo(
    () => (sections ? serializeSections(sections) : ""),
    [sections]
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="max-w-2xl" aria-labelledby="ats-view-title">
      <DialogHeader>
        <h2 id="ats-view-title" className="text-lg font-semibold text-foreground">
          ATS view
        </h2>
        <p className="text-sm text-muted-foreground">
          This is what an applicant tracking system sees after parsing your
          resume.
        </p>
      </DialogHeader>

      <DialogBody>
        <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
          {text || "Nothing to show yet — add content to your resume."}
        </pre>
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
