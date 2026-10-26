"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, History, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { exportResumePdf } from "../actions/export-pdf"
import {
  getExportHistory,
  type ExportHistoryEntry,
} from "../actions/get-export-history.action"

interface ExportHistoryProps {
  resumeId: string
}

const TEMPLATE_LABELS: Record<string, string> = {
  MINIMAL: "Minimal",
  MODERN: "Modern",
  HARVARD: "Harvard",
  CORPORATE: "Corporate",
  EXECUTIVE: "Executive",
  CREATIVE: "Creative",
  TECH: "Tech",
  ELEGANT: "Elegant",
}

/**
 * Past template batches for one resume, newest first. Each batch links
 * straight to its stored PDFs (same-origin authenticated route), and the
 * "Download current" button re-renders the live resume without AI.
 */
export function ExportHistory({ resumeId }: ExportHistoryProps) {
  const [entries, setEntries] = useState<ExportHistoryEntry[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDownloading, setIsDownloading] = useState(false)

  // Reloads the list after an export; only ever called from event handlers.
  const refresh = useCallback(async () => {
    try {
      const result = await getExportHistory(resumeId)
      setEntries(result.data ?? [])
      if (result.error) toast.error(result.error)
    } catch {
      setEntries([])
      toast.error("Couldn't load export history.")
    } finally {
      setIsLoading(false)
    }
  }, [resumeId])

  // Kick-off only: the request starts here, but every state update lands in a
  // promise callback — the effect body itself never sets state during commit.
  useEffect(() => {
    let active = true
    getExportHistory(resumeId)
      .then((result) => {
        if (!active) return
        setEntries(result.data ?? [])
        if (result.error) toast.error(result.error)
      })
      .catch(() => {
        if (!active) return
        setEntries([])
        toast.error("Couldn't load export history.")
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [resumeId])

  async function downloadCurrent() {
    if (isDownloading) return
    setIsDownloading(true)
    try {
      const result = await exportResumePdf(resumeId)
      if ("pdfUrl" in result && result.pdfUrl) {
        window.open(result.pdfUrl, "_blank", "noopener")
        // A fresh batch now exists server-side — show it without a reload.
        await refresh()
        return
      }
      toast.error(result.error ?? "Download failed. Please try again.")
    } catch {
      toast.error("Download failed. Please try again.")
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <Card className="space-y-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-brand-400" aria-hidden="true" />
            Export history
          </CardTitle>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isDownloading}
            onClick={downloadCurrent}
          >
            {isDownloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isDownloading ? "Rendering…" : "Download current"}
          </Button>
        </div>
        <CardDescription>
          Every full export, newest first — one click to grab any template again.
        </CardDescription>
      </CardHeader>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading history…</p>
      ) : !entries || entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No exports yet. Generate once and every template batch will be kept
          here for one-click re-download.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-md border border-border p-3"
            >
              <p className="text-xs text-muted-foreground">
                Version {entry.version} ·{" "}
                {new Date(entry.createdAt).toLocaleString()}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(entry.templates).map(([template, urls]) => (
                  <a
                    key={template}
                    href={urls.pdfUrl}
                    target="_blank"
                    rel="noopener"
                    download
                    className={buttonVariants({
                      variant: "secondary",
                      size: "sm",
                    })}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    {TEMPLATE_LABELS[template] ?? template}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
