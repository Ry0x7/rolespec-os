"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { Trash2 } from "lucide-react"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Card } from "@/shared/ui/card"
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "@/shared/ui/dialog"
import { toast } from "sonner"
import { formatDate } from "@/shared/lib/utils"
import { analysisMode, atsVariant, scoreLabel } from "../lib/ats-score"
import type { ATSAnalysisMode, ResumeOrigin, ResumeSource } from "../hooks/use-resume-store"
import { deleteResume } from "../actions"
import { ResumeKindBadge } from "./resume-kind-badge"

// Re-exported: the thresholds now live in `../lib/ats-score` so the editor
// header can share them without importing this card.
export { atsVariant }

interface ResumeCardProps {
  resume: {
    id: string
    title: string
    targetRole: string | null
    variant: "MASTER" | "ROLE_FAMILY" | "JOB_TAILORED"
    roleFamily: { name: string } | null
    jobApplication: { id: string; jobTitle: string; companyName: string } | null
    template: string
    atsScore: number | null
    // Present when this resume has ever been analyzed. It names the question
    // the score answered, so the badge cannot label a quality run "ATS".
    latestAnalysis?: { mode: ATSAnalysisMode; overallScore: number } | null
    // Where this resume came from. A derived resume names its source; a
    // master built from the Career Profile says so. Both are absent on
    // pre-lineage rows.
    sourceResume?: ResumeSource | null
    origin?: ResumeOrigin | null
    updatedAt: Date
  }
}

export function ResumeCard({ resume }: ResumeCardProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)

  // Focus Cancel button when modal opens
  useEffect(() => {
    if (showConfirm) {
      cancelRef.current?.focus()
    }
  }, [showConfirm])

  // Return focus to trigger when modal closes (skip on initial mount)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (!showConfirm) {
      triggerRef.current?.focus()
    }
  }, [showConfirm])

  // Close on Escape
  useEffect(() => {
    if (!showConfirm) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isDeleting) setShowConfirm(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [showConfirm, isDeleting])

  async function handleDelete() {
    setIsDeleting(true)
    const result = await deleteResume(resume.id)
    setIsDeleting(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success("Resume archived")
    }
    setShowConfirm(false)
  }

  // Same precedence as the editor header's score chip: the latest analysis
  // wins over the denormalized `atsScore`, and the label names the question
  // that score answered. With no analysis row to read a mode off, the card
  // infers it from the resume's job target: a resume tied to an application (or
  // tailored to one) scored against a job description, so it reads as ATS;
  // master and role-family fallbacks read as quality.
  const score = resume.latestAnalysis?.overallScore ?? resume.atsScore
  const hasJobTarget =
    resume.jobApplication != null || resume.variant === "JOB_TAILORED"
  const scoreKind = scoreLabel(
    analysisMode(resume.latestAnalysis?.mode, hasJobTarget)
  )

  const originText =
    resume.variant === "MASTER" && resume.origin === "profile"
      ? "From Career Profile"
      : null
  const showJobLink =
    resume.variant === "JOB_TAILORED" && resume.jobApplication != null

  return (
    <>
      <Card
        variant="interactive"
        className="group relative h-full has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">
              <Link
                href={`/resumes/${resume.id}`}
                className="rounded-sm transition-colors after:absolute after:inset-0 after:rounded-lg after:content-[''] group-hover:text-brand-400 focus-visible:outline-none"
              >
                {resume.title}
              </Link>
            </h3>
            {resume.targetRole && (
              <p className="truncate text-sm text-muted-foreground">
                {resume.targetRole}
              </p>
            )}
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <ResumeKindBadge
                variant={resume.variant}
                roleFamilyName={resume.roleFamily?.name}
              />
              {resume.sourceResume?.status === "ARCHIVED" ? (
                // An archived source has no editor to open, so it is named only.
                <span className="truncate text-xs text-muted-foreground">
                  From {resume.sourceResume.title}
                </span>
              ) : resume.sourceResume ? (
                <Link
                  href={`/resumes/${resume.sourceResume.id}`}
                  className="relative z-10 truncate rounded-sm text-xs text-muted-foreground underline-offset-4 hover:text-brand-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  From {resume.sourceResume.title}
                </Link>
              ) : (
                originText && (
                  <span className="truncate text-xs text-muted-foreground">
                    {originText}
                  </span>
                )
              )}
              {showJobLink && (resume.sourceResume || originText) && (
                <span aria-hidden="true" className="text-xs text-muted-foreground">
                  ·
                </span>
              )}
              {showJobLink && resume.jobApplication && (
                <Link
                  href={`/jobs/${resume.jobApplication.id}`}
                  className="relative z-10 truncate rounded-sm text-xs text-muted-foreground underline-offset-4 hover:text-brand-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {resume.jobApplication.jobTitle} —{" "}
                  {resume.jobApplication.companyName}
                </Link>
              )}
            </div>
          </div>
          <Button
            ref={triggerRef}
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setShowConfirm(true)}
            aria-label={`Delete ${resume.title}`}
            className="relative z-10 -mr-2 -mt-2 h-8 w-8 shrink-0 hover:text-error"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" size="sm" className="capitalize">
            {resume.template.toLowerCase()}
          </Badge>
          {score != null && (
            <Badge variant={atsVariant(score)} size="sm">
              {scoreKind} {score}
            </Badge>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            Updated {formatDate(resume.updatedAt)}
          </span>
        </div>
      </Card>

      <Dialog
        open={showConfirm}
        onClose={() => { if (!isDeleting) setShowConfirm(false) }}
        maxWidth="max-w-sm"
        aria-labelledby={`delete-dialog-title-${resume.id}`}
      >
        <DialogHeader>
          <h2
            id={`delete-dialog-title-${resume.id}`}
            className="text-lg font-semibold"
          >
            Delete resume?
          </h2>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">
            This resume will move to Archived. You can restore it from the
            Archived section below.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="ghost"
            onClick={() => setShowConfirm(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete Resume"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}
