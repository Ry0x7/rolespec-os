"use client"

import { useState } from "react"
import { FileText, IdCard, Sparkles, Upload, X } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { Select } from "@/shared/ui/select"
import { LINKEDIN_PDF_MAX_BYTES } from "../constants/linkedin"

/** Resume choices for the optional "rate against my resume" context. */
export interface LinkedinResumeOption {
  id: string
  title: string
  atsScore: number | null
}

interface LinkedinSourcePanelProps {
  isPending: boolean
  isAssisting: boolean
  error: string | null
  onRate: (file: File | null) => void
  onAssist: (file: File | null) => void
  /** One-click rate + suggestions. Absent on surfaces that only need one action. */
  onRateAndAssist?: (file: File | null) => void
  /** Name of the last successfully read export — reassurance a re-run reuses it. */
  lastFileName?: string | null
  onError: (message: string | null) => void
  resumeOptions: LinkedinResumeOption[]
  selectedResumeId: string
  onSelectedResumeIdChange: (id: string) => void
}

/**
 * Top of the LinkedIn editor: the PDF source, the optional context linked to
 * this run, and the two paid actions. Context is per-run — nothing is persisted,
 * so the fields always start empty.
 */
export function LinkedinSourcePanel({
  isPending,
  isAssisting,
  error,
  onRate,
  onAssist,
  onRateAndAssist,
  lastFileName,
  onError,
  resumeOptions,
  selectedResumeId,
  onSelectedResumeIdChange,
}: LinkedinSourcePanelProps) {
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  /** Either action locks the picker so the file can't change mid-request. */
  const busy = isPending || isAssisting

  function selectFile(candidate: File) {
    if (candidate.type !== "application/pdf") {
      setFile(null)
      onError("Only PDF files are supported — use LinkedIn's “Save to PDF” export.")
      return
    }
    if (candidate.size > LINKEDIN_PDF_MAX_BYTES) {
      setFile(null)
      onError("That file is over 5 MB. Upload the PDF LinkedIn exports.")
      return
    }
    onError(null)
    setFile(candidate)
  }

  return (
    <Card className="space-y-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <IdCard className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Profile source
          </CardTitle>
        </div>
        <CardDescription>
          LinkedIn → your profile → Resources/More → Save to PDF, then drop the
          export here. One file powers both the score and the rewrites.
        </CardDescription>
      </CardHeader>

      <div
        className={cn(
          "rounded-md border-2 border-dashed p-4 transition-colors",
          dragOver
            ? "border-brand-500 bg-brand-500/10"
            : file
              ? "border-brand-700/60 bg-brand-700/5"
              : "border-border"
        )}
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (busy) return
          const dropped = e.dataTransfer.files[0]
          if (dropped) selectFile(dropped)
        }}
      >
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
            {file ? (
              <FileText className="h-4 w-4 text-brand-400" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            {file ? (
              <>
                <p className="max-w-full truncate text-sm font-medium text-foreground">
                  {file.name}
                </p>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">
                  {(file.size / 1024).toFixed(0)} KB
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Drop your LinkedIn PDF here, or choose a file — PDF up to 5 MB.
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <label
              htmlFor="linkedin-pdf"
              className={cn(
                "inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-foreground transition-colors",
                "hover:bg-muted active:bg-input",
                "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring",
                busy && "pointer-events-none opacity-50"
              )}
            >
              {file ? "Replace" : "Choose PDF"}
              <input
                id="linkedin-pdf"
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                disabled={busy}
                aria-describedby={error ? "linkedin-pdf-error" : undefined}
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  const selected = e.target.files?.[0]
                  if (selected) selectFile(selected)
                  e.target.value = ""
                }}
              />
            </label>

            {file && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label="Clear selected PDF"
                onClick={() => {
                  setFile(null)
                  onError(null)
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Linked context
          </h4>
          <span className="text-xs text-muted-foreground">Optional</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Attach a resume and the rating compares your profile against it too.
          Used for this run only.
        </p>

        <div className="space-y-2">
          <label
            htmlFor="linkedin-resume"
            className="text-xs font-medium text-muted-foreground"
          >
            Resume (optional)
          </label>
          <Select
            id="linkedin-resume"
            value={selectedResumeId}
            disabled={busy || resumeOptions.length === 0}
            onChange={(e) => onSelectedResumeIdChange(e.target.value)}
          >
            <option value="">None</option>
            {resumeOptions.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.atsScore == null
                  ? resume.title
                  : `${resume.title} — ATS ${resume.atsScore}`}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && (
        <p id="linkedin-pdf-error" role="alert" className="text-sm text-error">
          {error}
        </p>
      )}

      {lastFileName && !file && (
        <p className="text-xs text-muted-foreground">
          Last read: <span className="font-medium">{lastFileName}</span> —
          drop the same export to re-run without hunting for it.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {onRateAndAssist && (
          <Button
            type="button"
            loading={isPending || isAssisting}
            disabled={!file || busy}
            onClick={() => onRateAndAssist(file)}
            className="w-full sm:w-auto"
          >
            {isPending || isAssisting ? (
              "Working..."
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Rate + suggestions in one click
              </>
            )}
          </Button>
        )}

        <Button
          type="button"
          variant="secondary"
          loading={isPending}
          disabled={!file || busy}
          onClick={() => onRate(file)}
          className="w-full sm:w-auto"
        >
          {isPending ? "Rating..." : "Rate profile (no suggestions)"}
        </Button>

        <Button
          type="button"
          variant="secondary"
          loading={isAssisting}
          disabled={!file || busy}
          onClick={() => onAssist(file)}
          className="w-full sm:w-auto"
        >
          {isAssisting ? (
            "Writing..."
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Generate suggestions
            </>
          )}
        </Button>
      </div>
    </Card>
  )
}
