"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FileText, IdCard, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { LINKEDIN_PDF_MAX_BYTES } from "@/features/linkedin/constants/linkedin"
import {
  LINKEDIN_ERROR_MESSAGES,
  validateLinkedinFile,
} from "@/features/linkedin/hooks/use-linkedin"
import { GENERIC_ERROR } from "@/shared/lib/rating/constants"
import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"

/** Counts the route reports back for one import run. */
interface ImportCounts {
  evidenceCreated: number
  evidenceSkipped: number
  capabilitiesCreated: number
  capabilitiesSkipped: number
}

/**
 * Inline copy for `POST /api/career-profile/import-linkedin`. The upload codes
 * are shared with the LinkedIn routes; only the throttle and failure copy differ.
 */
const IMPORT_ERROR_MESSAGES: Record<string, string> = {
  ...LINKEDIN_ERROR_MESSAGES,
  RATE_LIMITED: "Too many imports. Wait a few minutes and try again.",
  IMPORT_FAILED: "The import failed. Please try again.",
}

/** "Added 4 items, 2 already there" — skips are reported, never swallowed. */
function summarizeImport(counts: ImportCounts): string {
  const parts: string[] = []
  if (counts.evidenceCreated > 0) {
    parts.push(
      `${counts.evidenceCreated} ${counts.evidenceCreated === 1 ? "item" : "items"} to confirm`
    )
  }
  if (counts.capabilitiesCreated > 0) {
    parts.push(
      `${counts.capabilitiesCreated} ${counts.capabilitiesCreated === 1 ? "skill" : "skills"}`
    )
  }
  const skipped = counts.evidenceSkipped + counts.capabilitiesSkipped
  const added = parts.length === 0 ? "Nothing new to add" : `Imported ${parts.join(" and ")}`
  return skipped === 0 ? added : `${added}, ${skipped} already existed`
}

/**
 * Upload path from LinkedIn's own profile export into the review flow. Nothing
 * imported is treated as confirmed: evidence arrives as a candidate the user
 * confirms row by row in the Evidence card, skills arrive unconfirmed.
 */
export function ImportLinkedinCard() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function selectFile(candidate: File) {
    const invalid = validateLinkedinFile(candidate)
    if (invalid) {
      setFile(null)
      setError(invalid)
      return
    }
    setError(null)
    setFile(candidate)
  }

  async function handleImport() {
    if (busy) return
    const invalid = validateLinkedinFile(file)
    if (invalid || !file) {
      setError(invalid)
      return
    }

    setBusy(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch("/api/career-profile/import-linkedin", {
        method: "POST",
        body: formData,
      })
      const payload: { data?: ImportCounts; error?: string; code?: string } = await res
        .json()
        .catch(() => ({}))

      if (res.ok && payload.data) {
        setFile(null)
        toast.success(summarizeImport(payload.data))
        // The new candidate rows are rendered by the server component above.
        router.refresh()
        return
      }

      setError(
        (payload.code && IMPORT_ERROR_MESSAGES[payload.code]) ||
          payload.error ||
          GENERIC_ERROR
      )
    } catch {
      setError("The import failed. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IdCard className="h-4 w-4 text-brand-400" aria-hidden="true" />
          Import from LinkedIn
        </CardTitle>
        <CardDescription>
          Upload the PDF from LinkedIn → your profile → Resources → Save to PDF.
          Imported items arrive as candidates for you to confirm.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className={cn(
            "rounded-md border-2 border-dashed p-3 transition-colors",
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
          <div className="flex flex-col items-center gap-3 sm:flex-row">
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
                  Drop your LinkedIn PDF here, or choose a file — PDF up to{" "}
                  {LINKEDIN_PDF_MAX_BYTES / (1024 * 1024)} MB.
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <label
                htmlFor="career-import-pdf"
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-foreground transition-colors",
                  "hover:bg-muted active:bg-input",
                  "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring",
                  busy && "pointer-events-none opacity-50"
                )}
              >
                {file ? "Replace" : "Choose PDF"}
                <input
                  id="career-import-pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  disabled={busy}
                  aria-describedby={error ? "career-import-error" : undefined}
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
                    setError(null)
                  }}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <p id="career-import-error" role="alert" className="text-sm text-error">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="button" loading={busy} disabled={!file || busy} onClick={handleImport}>
            {busy ? "Importing..." : "Import profile"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
