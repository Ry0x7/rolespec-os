"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FileText } from "lucide-react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Select } from "@/shared/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { resumeEditorHref } from "@/features/resume/lib/resume-editor-href"
import { selectJobApplicationResume } from "../actions/job-application.actions"
import {
  resumeTierLabel,
  resumeTierRank,
  type ResumeTier,
} from "../services/resume-tier"

export interface JobResumeOption extends ResumeTier {
  id: string
  title: string
}

interface Props {
  jobApplicationId: string
  /** Persisted choice, or null when the user has not picked one yet. */
  selectedResumeId: string | null
  resumeOptions: JobResumeOption[]
  /** Deterministic suggestion computed on the server; null when there are no resumes. */
  recommendation: { resumeId: string; reason: string } | null
}

/**
 * Which resume this application goes out with. Compact on purpose: the answer is
 * one line, and the recommendation exists so the common case is one click rather
 * than a decision.
 *
 * The select shows the *effective* resume — the explicit choice, else the
 * recommendation — because that is the one Resume Match, the email and the
 * cover letters actually use. Showing the persisted value there made the picker
 * say "No resume selected" while the rest of the page worked from the
 * recommendation. When what is shown is only the recommendation it is labelled
 * as unsaved, and "Use recommended" is still the way to commit it.
 */
export function JobResumePanel({
  jobApplicationId,
  selectedResumeId,
  resumeOptions,
  recommendation,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // Optimistic so the select does not snap back while the action is in flight.
  // The persisted choice, optimistic so the select does not snap back while the
  // action is in flight. `null` means "nothing chosen", which is not the same
  // as the recommendation the select may be displaying.
  const [chosen, setChosen] = useState<string | null>(selectedResumeId)
  // Resync when the server's value changes (a refresh after another control —
  // e.g. Mark applied — saved the choice). Adjusting state during render is
  // React's recommended pattern for this; the optimistic value above survives
  // because the refreshed prop then equals it.
  const [syncedResumeId, setSyncedResumeId] = useState(selectedResumeId)
  if (selectedResumeId !== syncedResumeId) {
    setSyncedResumeId(selectedResumeId)
    setChosen(selectedResumeId)
  }

  // Stable within a tier, so the server's most-recent-first order survives.
  const groupedOptions = [...resumeOptions].sort(
    (a, b) => resumeTierRank(a) - resumeTierRank(b)
  )

  const selectedResume = resumeOptions.find((resume) => resume.id === chosen)
  const recommendedResume = recommendation
    ? resumeOptions.find((resume) => resume.id === recommendation.resumeId)
    : undefined

  // What every other panel on the page will use, and therefore what the picker
  // has to display. Falls back to "" only when there is nothing at all.
  const effectiveResumeId = chosen ?? recommendedResume?.id ?? ""
  // Shown, but not yet the user's decision.
  const showsUnsavedRecommendation = chosen === null && Boolean(recommendedResume)

  function persist(resumeId: string) {
    const previous = chosen
    setChosen(resumeId || null)
    startTransition(async () => {
      const result = await selectJobApplicationResume(
        jobApplicationId,
        resumeId || null
      )
      if ("error" in result) {
        setChosen(previous)
        toast.error(result.error)
        return
      }
      toast.success(resumeId ? "Resume selected" : "Resume cleared")
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Resume
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {resumeOptions.length === 0 ? (
          <EmptyState
            variant="bare"
            icon={FileText}
            title="No resume to send"
            description="Create a resume first, then come back and pick the one this job gets."
            action={
              <Link
                href={`/resumes?tailorJobId=${encodeURIComponent(jobApplicationId)}`}
                className={buttonVariants({ variant: "outline" })}
              >
                Go to resumes
              </Link>
            }
          />
        ) : (
          <>
            {selectedResume ? (
              <p className="text-sm">
                Applying with{" "}
                <Link
                  href={resumeEditorHref(selectedResume.id, jobApplicationId)}
                  className="rounded-sm text-brand-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {selectedResume.title}
                </Link>
              </p>
            ) : recommendedResume && recommendation ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Recommended:{" "}
                  <span className="text-foreground">{recommendedResume.title}</span>{" "}
                  — {recommendation.reason}
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending}
                  onClick={() => persist(recommendation.resumeId)}
                >
                  Use recommended
                </Button>
              </div>
            ) : null}

            <div className="space-y-2">
              <label
                htmlFor="job-resume-choice"
                className="text-xs font-medium text-muted-foreground"
              >
                {selectedResume ? "Change resume" : "Or pick another"}
                {showsUnsavedRecommendation && (
                  <> <span className="font-normal">(recommended, not saved)</span></>
                )}
              </label>
              <Select
                id="job-resume-choice"
                value={effectiveResumeId}
                disabled={isPending}
                onChange={(event) => persist(event.target.value)}
              >
                <option value="">No resume selected</option>
                {groupedOptions.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.title} · {resumeTierLabel(resume)}
                  </option>
                ))}
              </Select>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
