"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw, Target } from "lucide-react"
import { toast } from "sonner"

import { QualificationSummary } from "@/features/discovery/components/qualification-summary"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { formatDate } from "@/shared/lib/utils"

import { recheckJobQualification } from "../actions/job-qualification.actions"
import { parseStoredQualification } from "../schemas/job-qualification.schema"

interface Props {
  jobApplicationId: string
  /** Straight off the `Job.qualification` Json column — shape unverified. */
  qualification: unknown
  /**
   * Replaces the snapshot's own next action. The stored one was written for the
   * discovery list, where the decision is whether to save at all ("Save it and
   * tailor a resume…"), so on a saved application the tracker's next step is
   * passed in instead — the same string the tracker row shows.
   */
  nextAction?: string
}

/**
 * "Why this job" — the deterministic verdict for this posting, replayed on the
 * detail page so the decision is still explainable later. Nothing here is AI
 * output.
 *
 * Still a snapshot rather than a live read: it shows what was true the last
 * time the check ran, which is why the date it was taken is on the card. What
 * it is *not* is permanent — "Re-check fit" re-runs the same deterministic pass
 * against the Career Profile as it stands today, for rows saved before a
 * profile edit and for rows saved before snapshots existed at all.
 *
 * A missing or unparseable column renders the empty state, not nothing: the
 * button is the only way back from "never checked".
 */
export function JobQualificationCard({
  jobApplicationId,
  qualification,
  nextAction,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const parsed = parseStoredQualification(qualification)

  function handleRecheck() {
    setError(null)
    // Read before the await, off the same `parsed` the button label reads, so
    // the toast cannot call a first check a re-check once the action returns.
    const hadSnapshot = parsed !== null
    startTransition(async () => {
      const result = await recheckJobQualification(jobApplicationId)
      if ("error" in result) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success(hadSnapshot ? "Fit re-checked" : "Fit checked")
      // The card renders server-parsed props, so the refreshed page is what
      // swaps the reasoning in — there is no client copy to patch.
      router.refresh()
    })
  }

  const recheckButton = (
    <Button
      type="button"
      variant={parsed ? "outline" : "default"}
      size="sm"
      onClick={handleRecheck}
      disabled={isPending}
    >
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      {isPending ? "Checking…" : parsed ? "Re-check fit" : "Check fit"}
    </Button>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Why this job</CardTitle>
        {parsed && (
          <p className="text-xs text-muted-foreground">
            Checked against your Career Profile
            {Number.isNaN(Date.parse(parsed.checkedAt))
              ? ""
              : ` on ${formatDate(parsed.checkedAt)}`}
            .
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {parsed ? (
          <QualificationSummary
            qualification={parsed.qualification}
            nextAction={nextAction}
            defaultExpanded
          />
        ) : (
          <EmptyState
            variant="bare"
            icon={Target}
            title="Not checked yet"
            description="This job was saved before fit was recorded. Check it against your Career Profile to see whether it is worth your time."
          />
        )}

        {error && <p className="text-xs text-error">{error}</p>}

        <div className="flex justify-end">{recheckButton}</div>
      </CardContent>
    </Card>
  )
}
