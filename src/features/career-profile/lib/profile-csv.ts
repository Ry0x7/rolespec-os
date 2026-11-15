import type { CapabilityRow, EvidenceRow } from "../types"

/** CSV cell escaping: quotes, commas and newlines are wrapped in quotes. */
function esc(value: string | null | undefined): string {
  const s = value ?? ""
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function iso(date: Date | null): string {
  return date ? new Date(date).toISOString().slice(0, 10) : ""
}

/** Evidence rows → CSV text. Pure, no AI, no network. */
export function evidenceToCsv(rows: EvidenceRow[]): string {
  const header = "kind,title,organization,details,outcome,startDate,endDate"
  const lines = rows.map((r) =>
    [r.kind, esc(r.title), esc(r.organization), esc(r.details), esc(r.outcome), iso(r.startDate), iso(r.endDate)].join(",")
  )
  return [header, ...lines].join("\n")
}

/** Capabilities → CSV text. Pure, no AI, no network. */
export function capabilitiesToCsv(rows: CapabilityRow[]): string {
  const header = "name,category,selfAssessment,notes"
  const lines = rows.map((r) =>
    [esc(r.name), esc(r.category), r.selfAssessment ?? "", esc(r.notes)].join(",")
  )
  return [header, ...lines].join("\n")
}

function splitLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export interface ParsedEvidenceRow {
  kind: string
  title: string
  organization?: string
  details?: string
  outcome?: string
  startDate?: string
  endDate?: string
}

/**
 * Parses an evidence CSV previously produced by `evidenceToCsv` (or
 * hand-edited to the same header). Returns valid rows plus per-line errors —
 * callers import only the valid rows and show the errors inline.
 */
export function parseEvidenceCsv(text: string): { rows: ParsedEvidenceRow[]; errors: string[] } {
  const rows: ParsedEvidenceRow[] = []
  const errors: string[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { rows, errors: ["File is empty"] }
  const header = splitLine(lines[0]).map((h) => h.toLowerCase())
  const idx = (name: string) => header.indexOf(name)
  const kindIdx = idx("kind")
  const titleIdx = idx("title")
  if (kindIdx === -1 || titleIdx === -1) {
    return { rows, errors: ['Header must include at least "kind" and "title"'] }
  }
  const orgIdx = idx("organization")
  const detIdx = idx("details")
  const outIdx = idx("outcome")
  const startIdx = idx("startdate")
  const endIdx = idx("enddate")

  for (let n = 1; n < lines.length; n++) {
    const cols = splitLine(lines[n])
    const kind = (cols[kindIdx] ?? "").toUpperCase()
    const title = cols[titleIdx] ?? ""
    if (!title) {
      errors.push(`Line ${n + 1}: missing title — skipped`)
      continue
    }
    if (!kind) {
      errors.push(`Line ${n + 1}: missing kind — skipped`)
      continue
    }
    rows.push({
      kind,
      title,
      organization: orgIdx >= 0 ? cols[orgIdx] : undefined,
      details: detIdx >= 0 ? cols[detIdx] : undefined,
      outcome: outIdx >= 0 ? cols[outIdx] : undefined,
      startDate: startIdx >= 0 ? cols[startIdx] : undefined,
      endDate: endIdx >= 0 ? cols[endIdx] : undefined,
    })
    if (rows.length >= 500) {
      errors.push("Stopped at 500 rows — split larger files first")
      break
    }
  }
  return { rows, errors }
}

/** Triggers a browser download for CSV text without any server round-trip. */
export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
