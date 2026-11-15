"use client"

import { useState } from "react"
import { Copy, Mail, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import {
  draftArtifactsForJob,
  type ArtifactDrafts,
} from "../actions/draft-artifacts"

interface ArtifactQuickDraftsProps {
  jobApplicationId: string
  jobLabel: string
}

/**
 * One-click drafts for a tracked job: cover letter + outreach email side by
 * side, each with a copy button. Drafts are generated — not saved — so the
 * caller can edit before keeping them in the jobs workspace.
 */
export function ArtifactQuickDrafts({
  jobApplicationId,
  jobLabel,
}: ArtifactQuickDraftsProps) {
  const [drafts, setDrafts] = useState<ArtifactDrafts | null>(null)
  const [isDrafting, setIsDrafting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function draft() {
    if (isDrafting) return
    setIsDrafting(true)
    setError(null)
    try {
      const result = await draftArtifactsForJob(jobApplicationId)
      if (result.data) {
        setDrafts(result.data)
        toast.success("Drafts ready")
        return
      }
      const message = result.error ?? "Drafting failed. Please try again."
      setError(message)
      toast.error(message)
    } catch {
      const message = "Drafting failed. Please try again."
      setError(message)
      toast.error(message)
    } finally {
      setIsDrafting(false)
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Couldn't copy the ${label.toLowerCase()}.`)
    }
  }

  return (
    <Card className="space-y-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Cover letter + outreach
          </CardTitle>
          <Button
            type="button"
            size="sm"
            loading={isDrafting}
            disabled={isDrafting}
            onClick={draft}
          >
            {!isDrafting && (
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isDrafting
              ? "Drafting…"
              : drafts
                ? "Regenerate"
                : `Draft for ${jobLabel}`}
          </Button>
        </div>
        <CardDescription>
          One click writes both from your saved resume — copy, edit, then save
          them in your job tracker.
        </CardDescription>
      </CardHeader>

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}

      {drafts && (
        <div className="space-y-3">
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium">Cover letter</h4>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => copy(drafts.coverLetter, "Cover letter")}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy
              </Button>
            </div>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {drafts.coverLetter}
            </p>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium">
                Outreach{drafts.outreachSubject ? ` — ${drafts.outreachSubject}` : ""}
              </h4>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  copy(
                    drafts.outreachSubject
                      ? `Subject: ${drafts.outreachSubject}\n\n${drafts.outreachBody}`
                      : drafts.outreachBody,
                    "Outreach email"
                  )
                }
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy
              </Button>
            </div>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {drafts.outreachBody}
            </p>
          </div>
        </div>
      )}
    </Card>
  )
}
