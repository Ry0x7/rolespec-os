/**
 * How far a resume save may trail an analysis and still be that analysis's own
 * write. `analyzeATS` stores the analysis and stamps `resume.atsScore` in one
 * transaction, so `resume.updatedAt` always lands a few tens of milliseconds
 * after `ATSAnalysis.createdAt` (55–59 ms observed on the dev DB). Autosave
 * waits 8 s after the last edit, so a real edit made after a run finishes
 * always clears this window.
 */
export const ANALYSIS_OWN_WRITE_MS = 5_000

/**
 * Whether the stored analysis predates the resume's last save — the reload
 * counterpart of the editor's client-side `atsStale` flag, which otherwise
 * resets to "current" on every load.
 *
 * Residual: `resume.updatedAt` moves on any resume write (title, template,
 * target role), not only on section content, so such a write also reads as
 * outdated — the same framing the export staleness check uses.
 */
export function isAnalysisOutdated(
  resumeUpdatedAt: Date,
  analysisCreatedAt: Date,
): boolean {
  return resumeUpdatedAt.getTime() - analysisCreatedAt.getTime() > ANALYSIS_OWN_WRITE_MS
}
