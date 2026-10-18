"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { Button } from "@/shared/ui/button"
import { Select } from "@/shared/ui/select"
import { generateCoverLetter } from "../actions/cover-letter.actions"

interface ResumeOption {
  id: string
  title: string
  atsScore?: number | null
}

interface ApplicationOption {
  id: string
  companyName: string
  jobTitle: string
  hasJobDescription: boolean
}

interface Props {
  resumes: ResumeOption[]
  applications: ApplicationOption[]
  defaultJobApplicationId?: string
  /**
   * Set when the page was opened for one specific application (`?jobId=`).
   * The link already said which job this is for, so the picker is replaced by
   * a context header and a fixed value.
   */
  lockedApplication?: ApplicationOption | null
  /**
   * The resume chosen for the locked application, when it is still one of
   * `resumes` — same precedence as the job page's email panel. The user can
   * still pick another one.
   */
  defaultResumeId?: string
  /** One line naming the recommended resume and its tier, when it is a
   * suggestion rather than the user's own stored choice. */
  resumeHint?: string | null
  /**
   * False when the form is mounted somewhere the user should stay — the Job
   * Detail drawer. The action then returns the new id instead of navigating,
   * and `onGenerated` receives it. Defaults to today's hard redirect.
   */
  redirect?: boolean
  /** Called with the new cover letter's id, `redirect={false}` only. */
  onGenerated?: (id: string) => void
  /**
   * `"bare"` drops the card chrome and the "Cover letter for:" line, for a
   * host that already names the job in its own header — the Job Detail drawer.
   */
  variant?: "card" | "bare"
}

/** Shown when the action never answered — a dropped request, not a rejection. */
const NETWORK_ERROR = "Couldn't reach RoleSpec — try again."

/**
 * A redirecting action reports itself by throwing. Catching that and showing a
 * network message would turn a working navigation into a fake failure, so it is
 * rethrown untouched. Same digest check `features/auth/actions.ts` makes —
 * `isRedirectError` only ships from a deep `next/dist/...` path, not a public one.
 */
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  )
}

const textareaClassName =
  "w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"

export function CoverLetterForm({
  resumes,
  applications,
  defaultJobApplicationId,
  lockedApplication,
  defaultResumeId,
  resumeHint,
  redirect = true,
  onGenerated,
  variant = "card",
}: Props) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobApplicationId, setJobApplicationId] = useState(
    lockedApplication?.id ?? defaultJobApplicationId ?? ""
  )

  const selectedHasJd = lockedApplication
    ? lockedApplication.hasJobDescription
    : (applications.find((a) => a.id === jobApplicationId)?.hasJobDescription ?? false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsGenerating(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    try {
      // On the redirecting path the action never returns, so the options object
      // is only sent when the caller asked to stay put.
      const result = redirect
        ? await generateCoverLetter(formData)
        : await generateCoverLetter(formData, { redirect: false })
      if (result && "error" in result && result.error) {
        setError(result.error)
        return
      }
      if (result && "id" in result && result.id) onGenerated?.(result.id)
    } catch (err) {
      // A navigation is not a failure: let it through untouched.
      if (isRedirectError(err)) throw err
      // A dropped connection rejects the action call, which used to leave the
      // button stuck on "Generating..." forever.
      setError(NETWORK_ERROR)
    } finally {
      // Always, so the form is usable again whichever way the call ended.
      setIsGenerating(false)
    }
  }

  const form = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Resume select */}
      <div className="space-y-2">
        <label htmlFor="resumeId" className="sr-only">
          Resume
        </label>
        <Select
          name="resumeId"
          id="resumeId"
          required
          defaultValue={defaultResumeId ?? ""}
        >
          <option value="" disabled>
            Select a resume...
          </option>
          {resumes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.atsScore == null ? r.title : `${r.title} — ATS ${r.atsScore}`}
            </option>
          ))}
        </Select>
        {resumeHint && (
          <p className="text-xs text-muted-foreground">{resumeHint}</p>
        )}
      </div>

      {/* Job application: a fixed value when the page was opened for one
          specific job — the header above already names it — otherwise a
          picker. */}
      {lockedApplication ? (
        <input type="hidden" name="jobApplicationId" value={lockedApplication.id} />
      ) : (
        <div className="space-y-2">
          <label htmlFor="jobApplicationId" className="sr-only">
            Job Application (optional)
          </label>
          <Select
            name="jobApplicationId"
            id="jobApplicationId"
            value={jobApplicationId}
            onChange={(e) => setJobApplicationId(e.target.value)}
          >
            <option value="">No linked application</option>
            {applications.map((a) => (
              <option key={a.id} value={a.id}>
                {a.companyName} — {a.jobTitle}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* Job description */}
      <div className="space-y-2">
        <label
          htmlFor={selectedHasJd ? undefined : "jobDescription"}
          className="text-sm font-medium"
        >
          Job Description
        </label>
        {selectedHasJd ? (
          // Omitting the textarea keeps `jobDescription` out of FormData, so
          // the action falls back to the one stored on the linked job.
          <p className="text-xs text-muted-foreground">
            Using the job description saved on this application.
          </p>
        ) : (
          <textarea
            name="jobDescription"
            id="jobDescription"
            required
            rows={8}
            minLength={20}
            placeholder="Paste the full job description here..."
            className={textareaClassName}
          />
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={isGenerating}>
        {isGenerating ? "Generating..." : "Generate Cover Letter"}
      </Button>
    </form>
  )

  // The drawer already carries a header naming the job, so the card title and
  // the "Cover letter for:" line would say it a second time inside a second box.
  if (variant === "bare") return form

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Generate Cover Letter</CardTitle>
        {/* Arrived from a job: say which one instead of asking again. */}
        {lockedApplication && (
          <p className="text-sm text-muted-foreground">
            Cover letter for: {lockedApplication.companyName} —{" "}
            {lockedApplication.jobTitle}
          </p>
        )}
      </CardHeader>
      <CardContent>{form}</CardContent>
    </Card>
  )
}
