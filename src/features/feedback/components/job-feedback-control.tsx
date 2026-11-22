"use client"

import { useId, useState, useTransition } from "react"
import { toast } from "sonner"

import type { FeedbackVerdict } from "../types"
import { FEEDBACK_LABELS, FEEDBACK_VERDICTS } from "../types"
import { setJobFeedback } from "../actions/feedback.actions"

interface Props {
  postingKey: string
  jobId?: string | null
  title: string
  companyName: string
  location?: string | null
  url?: string | null
  initialVerdict?: FeedbackVerdict | null
  className?: string
  /** Shown after the select; useful where feedback changes the next ranking. */
  hint?: string
  onChanged?: (verdict: FeedbackVerdict | null) => void
}

/**
 * The user's own verdict, kept visually separate from posting facts and model
 * inferences. Clearing it deletes the row: "not judged" stays distinguishable
 * from "judged irrelevant".
 *
 * The select stays enabled during the write so keyboard focus survives. A
 * second change while the first is pending is ignored.
 */
export function JobFeedbackControl({
  postingKey,
  jobId,
  title,
  companyName,
  location,
  url,
  initialVerdict = null,
  className,
  hint,
  onChanged,
}: Props) {
  const [verdict, setVerdict] = useState<FeedbackVerdict | null>(initialVerdict)
  const [pending, startTransition] = useTransition()
  const descriptionId = useId()
  const label = `Your feedback on ${title} at ${companyName}${
    location ? `, ${location}` : ""
  }`

  // A server refresh can replace the row's stored verdict (another tab, a
  // revalidation); adjust during render rather than in an effect, so the old
  // value is never painted over the new one.
  const [lastInitial, setLastInitial] = useState(initialVerdict)
  if (initialVerdict !== lastInitial) {
    setLastInitial(initialVerdict)
    setVerdict(initialVerdict)
  }

  function change(next: FeedbackVerdict | null) {
    if (pending) return
    const previous = verdict
    setVerdict(next)
    startTransition(async () => {
      try {
        const result = await setJobFeedback({
          postingKey,
          jobId: jobId ?? null,
          title,
          companyName,
          url: url ?? null,
          verdict: next,
        })
        if ("error" in result) {
          setVerdict(previous)
          toast.error(result.error)
          return
        }
        onChanged?.(next)
      } catch {
        // A dropped connection rejects the server-action promise. Without this
        // the route error boundary replaced the whole page for one optional
        // note; revert the select and leave the rest of the screen usable.
        setVerdict(previous)
        toast.error("Could not save your feedback. Please try again.")
      }
    })
  }

  return (
    <span className={`inline-flex min-w-0 flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Your feedback</span>
        <select
          value={verdict ?? ""}
          aria-busy={pending}
          aria-describedby={descriptionId}
          onChange={(event) =>
            change((event.target.value || null) as FeedbackVerdict | null)
          }
          className="h-8 rounded-md border border-border bg-background px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={label}
          data-testid="job-feedback-select"
        >
          <option value="">Not set</option>
          {FEEDBACK_VERDICTS.map((option) => (
            <option key={option} value={option}>
              {FEEDBACK_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      {hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
      <span id={descriptionId} className="sr-only">
        {hint ? `${hint} ` : ""}
        This is your own note, not application status, and never changes your
        confirmed skills.
      </span>
      <span className="sr-only" role="status">
        {pending
          ? "Saving your feedback."
          : verdict
            ? `Your feedback saved as ${FEEDBACK_LABELS[verdict]}.`
            : ""}
      </span>
    </span>
  )
}
