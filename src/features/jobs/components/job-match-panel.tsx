"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Target, Sparkles, PenLine, ArrowRight } from "lucide-react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Select } from "@/shared/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { formatDate } from "@/shared/lib/utils"
import { resumeEditorHref } from "@/features/resume/lib/resume-editor-href"
import { analyzeJobMatch } from "../actions/job-match.actions"
import { AddJobDescriptionButton } from "./job-edit-context"

export interface JobMatchResumeOption {
  id: string
  title: string
  atsScore?: number | null
}

interface JobMatchResult {
  matchScore: number
  summary: string
  matchedKeywords: string[]
  missingKeywords: string[]
  suggestions: string[]
}

/** The last stored analysis, read off the job row on the server. */
export interface JobMatchInitial {
  matchScore: number
  summary: string
  matchedKeywords: string[]
  missingKeywords: string[]
  suggestions: string[]
  /** The resume the stored result was measured against; may no longer exist. */
  resumeId: string | null
  /** ISO timestamp, or null on a row written before this was tracked. */
  checkedAt: string | null
}

interface Props {
  jobApplicationId: string
  hasJobDescription: boolean
  resumeOptions: JobMatchResumeOption[]
  initialMatch?: JobMatchInitial | null
  /** The resume chosen for this application, if one has been. */
  chosenResumeId?: string | null
}

function scoreColor(score: number) {
  if (score >= 80) return "text-success"
  if (score >= 60) return "text-warning"
  return "text-error"
}

export function JobMatchPanel({
  jobApplicationId,
  hasJobDescription,
  resumeOptions,
  initialMatch,
  chosenResumeId,
}: Props) {
  const [isPending, startTransition] = useTransition()
  // The stored result's resume is still shown, labelled with what it was
  // actually measured against.
  const storedResume = initialMatch?.resumeId
    ? resumeOptions.find((option) => option.id === initialMatch.resumeId)
    : undefined
  // The resume chosen for the application wins the default, ahead of whatever
  // an older match happened to be run against: the page should not offer three
  // selects that quietly disagree about which resume this job uses. The user can
  // still switch to re-measure a different pair.
  const chosenResume = chosenResumeId
    ? resumeOptions.find((option) => option.id === chosenResumeId)
    : undefined
  const [resumeId, setResumeId] = useState(
    chosenResume?.id ?? storedResume?.id ?? resumeOptions[0]?.id ?? ""
  )

  // Changing the application's resume upstream re-renders this panel without
  // remounting it, so the initial state above would go stale and the two selects
  // would disagree again. Keyed on the chosen id alone, so a local override the
  // user made survives every other re-render.
  const chosenResumeOptionId = chosenResume?.id
  const [lastChosenResumeId, setLastChosenResumeId] = useState(chosenResumeOptionId)
  if (chosenResumeOptionId && chosenResumeOptionId !== lastChosenResumeId) {
    // Adjusting state during render, the documented alternative to an effect:
    // it re-runs this render before the DOM is touched, with no extra pass.
    setLastChosenResumeId(chosenResumeOptionId)
    setResumeId(chosenResumeOptionId)
  }
  const [result, setResult] = useState<JobMatchResult | null>(
    initialMatch
      ? {
          matchScore: initialMatch.matchScore,
          summary: initialMatch.summary,
          matchedKeywords: initialMatch.matchedKeywords,
          missingKeywords: initialMatch.missingKeywords,
          suggestions: initialMatch.suggestions,
        }
      : null
  )
  // Cleared on the first new run: the stored provenance line stops describing
  // what is on screen the moment a fresh analysis replaces it.
  const [storedMeta, setStoredMeta] = useState(
    initialMatch
      ? {
          resumeTitle: storedResume?.title ?? null,
          // Product Delete on a resume archives it and `resumeOptions` only
          // carries live ones, so a stored id with no matching option means the
          // snapshot was measured against a resume the user has since archived.
          // Worth saying, because the score on screen is about a resume that is
          // no longer in play.
          resumeArchived: Boolean(initialMatch.resumeId) && !storedResume,
          checkedAt: initialMatch.checkedAt,
        }
      : null
  )
  /**
   * The resume editor prefills its ATS job description from `?jobId`, so the
   * hand-off only needs the selected resume plus this job.
   */
  const editorHref = resumeId ? resumeEditorHref(resumeId, jobApplicationId) : null

  function handleAnalyze() {
    if (!resumeId) return
    startTransition(async () => {
      const response = await analyzeJobMatch({ jobApplicationId, resumeId })
      if ("error" in response) {
        toast.error(response.error)
        return
      }
      setStoredMeta(null)
      setResult({
        matchScore: response.matchScore,
        summary: response.summary,
        matchedKeywords: response.matchedKeywords,
        missingKeywords: response.missingKeywords,
        suggestions: response.suggestions,
      })
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Resume Match
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {resumeOptions.length === 0 ? (
          <EmptyState
            variant="bare"
            icon={Target}
            title="No resume to match"
            description="Create a resume first, then come back to score it against this job."
            action={
              <Link
                href="/resumes"
                className={buttonVariants({ variant: "outline" })}
              >
                Go to resumes
              </Link>
            }
          />
        ) : (
          <>
            <div className="space-y-2">
              <label
                htmlFor="job-match-resume"
                className="text-xs font-medium text-muted-foreground"
              >
                Resume
              </label>
              <Select
                id="job-match-resume"
                value={resumeId}
                onChange={(e) => setResumeId(e.target.value)}
                disabled={isPending}
              >
                <option value="">Select a resume…</option>
                {resumeOptions.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.atsScore == null
                      ? resume.title
                      : `${resume.title} — ATS ${resume.atsScore}`}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {!hasJobDescription && <AddJobDescriptionButton />}
                {editorHref && (
                  <Link
                    href={editorHref}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    <PenLine className="h-4 w-4" aria-hidden="true" />
                    Open in resume editor
                  </Link>
                )}
                <Button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={isPending || !resumeId}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  {isPending ? "Analyzing…" : "Analyze match"}
                </Button>
              </div>
              {/* A missing description does not block the run here, it just
                  makes the score guesswork — so this stays a note, not a block. */}
              {!hasJobDescription && (
                <p className="text-xs text-muted-foreground">
                  Add a job description for an accurate match.
                </p>
              )}
            </div>
          </>
        )}

        {isPending && <JobMatchSkeleton />}

        {!isPending && result && (
          <div className="space-y-4 border-t border-border pt-4">
            <div className="flex items-baseline gap-2">
              <span className={`text-4xl font-bold ${scoreColor(result.matchScore)}`}>
                {result.matchScore}
              </span>
              <span className="text-sm text-muted-foreground">/ 100 match</span>
            </div>

            {storedMeta && (
              <p className="text-xs text-muted-foreground">
                {`Last checked against ${
                  storedMeta.resumeTitle ??
                  (storedMeta.resumeArchived
                    ? "a resume that has since been archived"
                    : "a deleted resume")
                }`}
                {storedMeta.checkedAt ? ` · ${formatDate(storedMeta.checkedAt)}` : ""}
                {storedMeta.resumeArchived ? " — re-check for a current score." : ""}
              </p>
            )}

            <p className="text-sm">{result.summary}</p>

            {result.matchedKeywords.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Matched</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.matchedKeywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.missingKeywords.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Missing</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.missingKeywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-error ring-1 ring-error/40"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.suggestions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Suggestions</p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {result.suggestions.map((suggestion) => (
                    <li key={suggestion}>{suggestion}</li>
                  ))}
                </ul>
              </div>
            )}

            {editorHref &&
              (result.missingKeywords.length > 0 || result.suggestions.length > 0) && (
                <Link
                  href={editorHref}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Fix these in the resume editor
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Stand-in for the score + keyword chips + suggestions stack while a match runs.
 * The analyze call is a ~30–60 s AI round trip, so the panel needs more feedback
 * than a button label (same approach as `LinkedinResultsSkeleton`).
 */
export function JobMatchSkeleton() {
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <p className="text-xs text-muted-foreground" role="status">
        Analyzing your resume against this job — usually takes 30–60 seconds.
      </p>
      <div aria-hidden="true" className="space-y-4">
        <div className="h-10 w-24 animate-pulse rounded bg-muted" />
        <div className="space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-5 w-16 animate-pulse rounded-full bg-muted" />
          ))}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
    </div>
  )
}
