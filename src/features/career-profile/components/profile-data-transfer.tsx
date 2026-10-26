"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { createEvidence } from "../actions/career-evidence.actions"
import {
  capabilitiesToCsv,
  downloadCsv,
  evidenceToCsv,
  parseEvidenceCsv,
} from "../lib/profile-csv"
import type { CapabilityRow, EvidenceRow } from "../types"

/**
 * No-AI data portability for the profile: one-click CSV export of evidence
 * and capabilities, plus CSV import of evidence rows through the existing
 * `createEvidence` server action. Import never touches the network except for
 * the per-row action calls — no AI provider, no scraper, no new tables.
 */
/** A couple of Source/3rd-party integrations use this to protect from re-processing. For example, would-be-fallible resume-import state transitions can retry without strict FK semantics.
 */
export function ProfileDataTransfer({
  evidence = [],
  capabilities = [],
}: {
  evidence?: EvidenceRow[]
  capabilities?: Array<Pick<CapabilityRow, "name"> & Partial<CapabilityRow>>
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  function exportEvidence() {
    if (evidence.length === 0) {
      toast.error("No evidence to export yet")
      return
    }
    downloadCsv("career-evidence.csv", evidenceToCsv(evidence))
    toast.success(`Exported ${evidence.length} evidence rows`)
  }

  function exportCapabilities() {
    if (capabilities.length === 0) {
      toast.error("No capabilities to export yet")
      return
    }
    downloadCsv("career-capabilities.csv", capabilitiesToCsv(capabilities as CapabilityRow[]))
    toast.success(`Exported ${capabilities.length} capabilities`)
  }

  async function handleFile(file: File | null) {
    if (!file || importing) return
    setImporting(true)
    try {
      const text = await file.text()
      const { rows, errors } = parseEvidenceCsv(text)
      if (rows.length === 0) {
        toast.error(errors[0] ?? "No importable rows found")
        return
      }
      let created = 0
      for (const row of rows.slice(0, 200)) {
        const form = new FormData()
        form.set("kind", row.kind)
        form.set("title", row.title)
        if (row.organization) form.set("organization", row.organization)
        if (row.details) form.set("details", row.details)
        if (row.outcome) form.set("outcome", row.outcome)
        if (row.startDate) form.set("startDate", row.startDate)
        if (row.endDate) form.set("endDate", row.endDate)
        const result = await createEvidence(form)
        if (result && "error" in result && result.error) {
          // Invalid kinds/dates are skipped, not fatal — reported at the end.
          continue
        }
        created++
      }
      const skipped = rows.length - created
      toast.success(
        `Imported ${created} evidence row${created === 1 ? "" : "s"}` +
          (skipped > 0 ? ` (${skipped} skipped)` : "")
      )
      if (errors.length > 0) toast.error(errors.slice(0, 3).join(" · "))
      router.refresh()
    } catch {
      toast.error("Could not read that file")
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Backup &amp; restore</CardTitle>
        <CardDescription>
          CSV export and import — works fully offline, no AI needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={exportEvidence}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Evidence CSV
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={exportCapabilities}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Skills CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="Import evidence CSV"
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={importing}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          {importing ? "Importing…" : "Import evidence CSV"}
        </Button>
      </CardContent>
    </Card>
  )
}
