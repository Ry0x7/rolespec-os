import type { ATSAnalysisMode as DbATSAnalysisMode } from "@/generated/prisma/enums"
import type { ATSAnalysisMode, ATSIssue } from "../hooks/use-resume-store"

/**
 * ATS score colour thresholds. Lifted out of `resume-card` so the resume list
 * and the editor header colour the same number the same way — a score must
 * never read as two different states on two surfaces.
 */
export function atsVariant(score: number): "success" | "warning" | "error" {
  return score >= 75 ? "success" : score >= 50 ? "warning" : "error"
}

/**
 * Which question a score answered. Rows written before quality mode carry no
 * marker; a retained job description is exactly what distinguishes the two,
 * matching the server's own inference in `resumes/[id]/page.tsx`.
 */
export function analysisMode(
  mode: ATSAnalysisMode | null | undefined,
  hasJobDescription: boolean
): ATSAnalysisMode {
  return mode ?? (hasJobDescription ? "job-match" : "quality")
}

/** The persisted `ATSAnalysis.mode` column as the client-side mode string. */
export function analysisModeFromDb(mode: DbATSAnalysisMode): ATSAnalysisMode {
  return mode === "JOB_MATCH" ? "job-match" : "quality"
}

/** The client-side mode string as the persisted `ATSAnalysis.mode` column. */
export function analysisModeToDb(mode: ATSAnalysisMode): DbATSAnalysisMode {
  return mode === "job-match" ? "JOB_MATCH" : "QUALITY"
}

/**
 * The prefix a score is allowed to carry. A quality run never claims ATS pass
 * likelihood, so the resume list and the editor header must name the same
 * number the same way.
 */
export function scoreLabel(mode: ATSAnalysisMode): "Quality" | "ATS" {
  return mode === "quality" ? "Quality" : "ATS"
}

/** Worst first. Mirrors the drawer's critical → warning → info grouping. */
export const SEVERITY_RANK: Record<ATSIssue["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

/**
 * The single issue worth putting in a header: the first issue at the highest
 * severity present. Strict `<` keeps the model's own ordering inside a
 * severity, so this is the same issue the drawer lists first.
 */
export function topIssue(issues: ATSIssue[] | undefined | null): ATSIssue | null {
  if (!issues || issues.length === 0) return null
  let best = issues[0]
  for (const issue of issues) {
    if (SEVERITY_RANK[issue.severity] < SEVERITY_RANK[best.severity]) best = issue
  }
  return best
}
