"use client"

import { useState, useTransition } from "react"
import { ShieldAlert, ShieldCheck, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { formatDate } from "@/shared/lib/utils"
import type { JobRiskLevel, JobRiskSource } from "@/generated/prisma/enums"
import { assessJobRisk } from "../actions/job-risk.actions"
import { AddJobDescriptionButton } from "./job-edit-context"
import { RiskBadge } from "./risk-badge"

interface Props {
  jobApplicationId: string
  riskLevel: JobRiskLevel | null
  riskReasons: string[]
  riskSource: JobRiskSource | null
  /** ISO string — the page serialises the DateTime before it crosses to the client. */
  riskCheckedAt: string | null
  hasJobDescription: boolean
}

/** What the panel is currently showing: props until a check runs, then its result. */
interface RiskView {
  level: JobRiskLevel | null
  reasons: string[]
  source: JobRiskSource | null
  checkedAt: string | null
}

/**
 * Scam/red-flag surface for one tracked application. Create-time heuristics fill
 * this in for free; the button swaps in a model assessment on demand.
 */
export function JobRiskPanel({
  jobApplicationId,
  riskLevel,
  riskReasons,
  riskSource,
  riskCheckedAt,
  hasJobDescription,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Set once a check returns, so the panel updates even before revalidation lands.
  const [assessed, setAssessed] = useState<RiskView | null>(null)

  const view: RiskView = assessed ?? {
    level: riskLevel,
    reasons: riskReasons,
    source: riskSource,
    checkedAt: riskCheckedAt,
  }

  const hasAiCheck = view.source === "AI"
  const checkedLine =
    view.source === "AI"
      ? `AI assessment${view.checkedAt ? ` · ${formatDate(view.checkedAt)}` : ""}`
      : view.source === "HEURISTIC"
        ? "Heuristic check at save"
        : null

  function handleAssess() {
    setError(null)
    startTransition(async () => {
      const result = await assessJobRisk(jobApplicationId)
      if (result.success !== true) {
        const message = result.error ?? "Something went wrong. Please try again."
        setError(message)
        toast.error(message)
        return
      }
      setAssessed({
        level: result.level === "NONE" ? null : result.level,
        reasons: result.level === "NONE" ? [] : result.reasons,
        source: "AI",
        checkedAt: new Date().toISOString(),
      })
      toast.success(
        result.level === "NONE" ? "No red flags detected" : "Risk check complete",
      )
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Job risk
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {view.level ? (
          <div className="space-y-3">
            <RiskBadge level={view.level} />
            {view.reasons.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm marker:text-muted-foreground">
                {view.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        ) : view.source || view.checkedAt ? (
          <EmptyState
            variant="bare"
            icon={ShieldCheck}
            title="No red flags detected"
            description="Nothing in this posting matched the scam or ghost-job signals."
          />
        ) : (
          <EmptyState
            variant="bare"
            icon={ShieldAlert}
            title="Not checked yet"
            description="Run a check to see whether this posting looks like a ghost job or a scam."
          />
        )}

        {checkedLine && (
          <p className="text-xs text-muted-foreground">{checkedLine}</p>
        )}

        {error && <p className="text-xs text-error">{error}</p>}

        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!hasJobDescription && <AddJobDescriptionButton />}
            <Button
              type="button"
              // Blocked by a missing prerequisite, the CTA drops out of brand
              // violet — a dimmed primary button still reads as clickable.
              variant={hasJobDescription ? "default" : "secondary"}
              onClick={handleAssess}
              disabled={isPending || !hasJobDescription}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {isPending ? "Checking…" : hasAiCheck ? "Re-check" : "Run AI risk check"}
            </Button>
          </div>
          {!hasJobDescription && (
            <p className="text-xs text-muted-foreground">
              Add a job description to run a risk check.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
