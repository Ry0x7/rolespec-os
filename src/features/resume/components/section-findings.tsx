"use client"

import { AlertTriangle, Info, XCircle } from "lucide-react"
import { useResumeStore, type ATSIssue } from "../hooks/use-resume-store"
import { SEVERITY_RANK } from "../lib/ats-score"
import { findMatchingSectionId } from "../lib/match-issue-section"

/** Per-section findings are capped so one section cannot be buried in
 *  commentary (spec section 5: "do not crowd every section with AI
 *  commentary"). Three is enough to act on without reading a list. */
const MAX_FINDINGS_PER_SECTION = 3

/**
 * Routes the ATS analysis the user already ran to the section it names,
 * replacing the static `SectionTip` with something specific once an
 * analysis exists (spec section 5). Returns `null` when there is nothing
 * to say for this section, so callers can fall back to `SectionTip`.
 */
export function useSectionFindings(sectionId: string): ATSIssue[] {
  const issues = useResumeStore((s) => s.atsResults?.issues)
  const sections = useResumeStore((s) => s.resume?.sections)
  if (!issues || issues.length === 0) return []
  const matching = issues.filter(
    (issue) => findMatchingSectionId(sections, issue.section) === sectionId
  )
  return [...matching]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, MAX_FINDINGS_PER_SECTION)
}

export function SectionFindings({ findings }: { findings: ATSIssue[] }) {
  if (findings.length === 0) return null
  return (
    <div className="space-y-1.5">
      {findings.map((issue, idx) => (
        <FindingRow key={idx} issue={issue} />
      ))}
    </div>
  )
}

function FindingRow({ issue }: { issue: ATSIssue }) {
  const Icon =
    issue.severity === "critical"
      ? XCircle
      : issue.severity === "warning"
        ? AlertTriangle
        : Info
  const color =
    issue.severity === "critical"
      ? "text-red-600 dark:text-red-500"
      : issue.severity === "warning"
        ? "text-amber-600 dark:text-amber-500"
        : "text-blue-600 dark:text-blue-500"

  return (
    <div className="flex gap-2 rounded-md bg-muted/40 border border-border px-3 py-2 text-xs">
      <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${color}`} aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="text-foreground">{issue.message}</p>
        {issue.suggestion && (
          <p className="text-muted-foreground">{issue.suggestion}</p>
        )}
      </div>
    </div>
  )
}
