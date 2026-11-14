"use client"

import { useState } from "react"
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  RotateCcw,
  ScanText,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { EmptyState } from "@/shared/components/empty-state"
import { Drawer, DrawerBody, DrawerHeader } from "@/shared/ui/drawer"
import {
  useResumeStore,
  type ATSResults,
  type EnhanceMutationResult,
  type EnhanceSuggestion,
} from "../hooks/use-resume-store"
import { useEnhanceTrigger } from "../hooks/use-enhance-trigger"
import { useATSTrigger } from "../hooks/use-ats-trigger"

/** Why an apply/revert could not be carried out, in the user's words. */
const FAILURE_MESSAGE: Record<"missing" | "stale", string> = {
  missing: "That section is no longer in your resume.",
  stale: "This text has changed — the suggestion no longer applies.",
}

/**
 * Above this many suggestions, groups default to collapsed so the drawer
 * opens onto a scannable list of section headers instead of a wall of rows —
 * below it, the set is short enough that collapsing would just cost a click.
 */
const COLLAPSE_THRESHOLD = 6

/**
 * Enhance as a contextual inspector (spec section 6) — replaces the inline
 * block that used to sit at the bottom of the editing pane. Opened by
 * `openInspector === "enhance"`, set either from the toolbar Enhance button
 * or automatically when a run lands (see `resume-editor.tsx`).
 */
export function EnhanceDrawer() {
  const openInspector = useResumeStore((s) => s.openInspector)
  const setOpenInspector = useResumeStore((s) => s.setOpenInspector)
  const atsResults = useResumeStore((s) => s.atsResults)
  const suggestions = useResumeStore((s) => s.enhanceSuggestions)
  const isEnhancing = useResumeStore((s) => s.isEnhancing)
  const enhanceError = useResumeStore((s) => s.enhanceError)
  const clearEnhanceError = useResumeStore((s) => s.clearEnhanceError)
  const grounding = useResumeStore((s) => s.enhanceGrounding)
  const sections = useResumeStore((s) => s.resume?.sections)
  const isAnalyzing = useResumeStore((s) => s.isAnalyzing)
  const atsError = useResumeStore((s) => s.atsError)
  const enhanceFocus = useResumeStore((s) => s.enhanceFocus)
  const setEnhanceFocus = useResumeStore((s) => s.setEnhanceFocus)
  const atsStale = useResumeStore((s) => s.atsStale)
  const previousScore = useResumeStore((s) => s.atsPreviousScore)
  const clearAtsPreviousScore = useResumeStore((s) => s.clearAtsPreviousScore)
  const { trigger: triggerEnhance } = useEnhanceTrigger()
  const { trigger: triggerAnalyze } = useATSTrigger()

  const appliedCount = suggestions?.filter((s) => s.status === "applied").length ?? 0
  // A Revert changes the resume too, so staleness — not only an applied row —
  // is reason enough to offer the re-score.
  const showReanalyze = appliedCount > 0 || (atsStale && atsResults !== null)
  const groups = groupBySectionTitle(suggestions, sections)
  const focusedSectionTitle = enhanceFocus
    ? (sections?.find((s) => s.id === enhanceFocus.sectionId)?.title ?? "one section")
    : null

  /**
   * A fresh Enhance run invalidates the comparison the last one produced. A
   * re-run keeps the current focus, so it stays on the same section.
   */
  function runEnhance() {
    clearAtsPreviousScore()
    triggerEnhance(enhanceFocus ?? undefined)
  }

  /** Drops a "Fix with Enhance" focus and runs over the whole resume. */
  function runWholeResume() {
    setEnhanceFocus(null)
    clearAtsPreviousScore()
    triggerEnhance()
  }

  /**
   * Closes the analyze → propose → apply loop: re-scores the sections as they
   * now stand, via the same trigger (and therefore the same mode derivation)
   * the ATS drawer uses. The store records the "before" score when the new
   * analysis lands.
   */
  function runReanalyze() {
    void triggerAnalyze()
  }

  return (
    <Drawer
      open={openInspector === "enhance"}
      onClose={() => setOpenInspector(null)}
      width="max-w-lg"
      aria-label="AI enhancements"
    >
      <DrawerHeader>
        <h2 className="text-sm font-semibold">AI Enhancements</h2>
      </DrawerHeader>
      <DrawerBody className="space-y-4">
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={runEnhance}
            disabled={isEnhancing || !atsResults}
            aria-label={isEnhancing ? "Enhancing" : suggestions ? "Re-run" : "Enhance"}
          >
            {isEnhancing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Enhancing...
              </>
            ) : (
              <>
                <Wand2 className="h-3.5 w-3.5 text-brand-400" />
                {suggestions ? "Re-run" : "Enhance"}
              </>
            )}
          </Button>
          {!atsResults && !isEnhancing && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Run Analyze first.{" "}
              <button
                type="button"
                onClick={() => setOpenInspector("ats")}
                className="font-medium text-brand-400 underline-offset-2 hover:underline"
              >
                Open ATS analysis
              </button>
            </p>
          )}
          {focusedSectionTitle !== null && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Focused on{" "}
              <span className="font-medium text-foreground">{focusedSectionTitle}</span>
              {" · "}
              <button
                type="button"
                onClick={runWholeResume}
                disabled={isEnhancing}
                className="font-medium text-brand-400 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
              >
                Enhance whole resume
              </button>
            </p>
          )}
        </div>

        {isEnhancing && (
          <div className="rounded-lg border border-border bg-card p-5" role="status" aria-live="polite">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
              <div>
                <h3 className="font-semibold text-foreground">Enhancing with AI...</h3>
                <p className="text-xs text-muted-foreground">
                  Rewriting the text your last analysis flagged
                </p>
              </div>
            </div>
          </div>
        )}

        {/* The error sits above the list rather than replacing it — applied rows
            still need to be revertable after a failed re-run. */}
        {enhanceError && !isEnhancing && (
          <div
            role="alert"
            className="flex items-start justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
          >
            <p className="text-sm text-destructive">{enhanceError}</p>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={clearEnhanceError}
              aria-label="Dismiss error"
              title="Dismiss error"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Requirements the run refused to claim. Shown as information, not as a
            failure: the only honest way to close the gap is real evidence. This
            renders on its own regardless of the suggestion list — it is the UI
            half of the evidence-grounding feature line and must not be tied to
            suggestions existing. */}
        {!isEnhancing && grounding.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <div className="min-w-0 space-y-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Not added ({grounding.length})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The job asks for these, but your resume does not back them yet.
                    Add the real experience and run Analyze again — nothing here was
                    claimed on your behalf.
                  </p>
                </div>
                <ul className="space-y-1">
                  {grounding.map((note) => (
                    <li key={note.keyword} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{note.keyword}</span>
                      {" — "}
                      {note.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {suggestions && !isEnhancing && (
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Suggestions ({suggestions.length})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {suggestions.length === 0
                      ? "No rewrites needed — your resume already covers the ATS findings."
                      : `${appliedCount} of ${suggestions.length} applied`}
                  </p>
                  {/* How the score moved after the applied rewrites. Never
                      styled as an error: a dip is information about this
                      resume, not something the user did wrong. */}
                  {previousScore !== null && atsResults && !isAnalyzing && (
                    <ScoreDelta results={atsResults} previousScore={previousScore} />
                  )}
                  {/* Only in the re-analyze context, so a stale error from the
                      ATS drawer does not show when no re-score was offered. */}
                  {atsError && !isAnalyzing && showReanalyze && (
                    <p role="alert" className="text-xs text-destructive">
                      {atsError}
                    </p>
                  )}
                </div>
              </div>
              {showReanalyze && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={runReanalyze}
                  disabled={isAnalyzing}
                  aria-label={isAnalyzing ? "Re-analyzing" : "Re-analyze"}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Re-analyzing...
                    </>
                  ) : (
                    <>
                      <ScanText className="h-3.5 w-3.5 text-violet-500" />
                      Re-analyze
                    </>
                  )}
                </Button>
              )}
            </div>

            {suggestions.length > 0 && (
              <div className="space-y-2 px-4 py-3">
                {groups.map((group) => (
                  <SuggestionGroup
                    key={group.sectionId}
                    title={group.title}
                    suggestions={group.suggestions}
                    defaultOpen={suggestions.length <= COLLAPSE_THRESHOLD}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Pre-run state: the drawer can be opened from the toolbar before any
            run exists, and used to show nothing but the button above. The copy
            deliberately promises only rewording of what the resume already
            evidences — Enhance never invents skills or experience. */}
        {!suggestions && !isEnhancing && (
          <EmptyState
            icon={Wand2}
            title="No suggestions yet"
            description="Enhance reads through your resume and proposes clearer wording for the text your last analysis flagged. Every rewrite is grounded in the evidence already in your resume and profile — it never adds skills or experience you have not shown."
            action={
              <p className="max-w-xs text-xs text-muted-foreground">
                Suggestions appear in this panel, grouped by section, and you apply or
                revert each one on its own. Use the Enhance button above to start a run.
              </p>
            }
          />
        )}
      </DrawerBody>
    </Drawer>
  )
}

/**
 * "Quality 71 (was 65, +6)" — how the score moved on the last re-analysis.
 * Shared with the ATS drawer so both inspectors narrate the same run the same
 * way. Never styled as an error: a dip is information about this resume, not
 * something the user did wrong.
 */
export function ScoreDelta({
  results,
  previousScore,
}: {
  results: Pick<ATSResults, "overallScore" | "mode">
  previousScore: number
}) {
  return (
    <p
      className={`mt-1 text-xs font-medium ${
        results.overallScore > previousScore
          ? "text-green-600 dark:text-green-500"
          : "text-muted-foreground"
      }`}
    >
      {results.mode === "quality" ? "Quality" : "ATS"} {results.overallScore} (was{" "}
      {previousScore}, {formatScoreDelta(results.overallScore - previousScore)})
    </p>
  )
}

/** Signed score movement, with a real minus sign and an explicit "no change". */
function formatScoreDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `−${Math.abs(delta)}`
  return "±0"
}

interface PositionedSuggestion {
  suggestion: EnhanceSuggestion
  /** 1-based position in the flat suggestion list — kept stable across
   * grouping so an aria-label (e.g. "Apply suggestion 3") stays unique across
   * groups instead of restarting at 1 in every section. */
  position: number
}

interface SuggestionGroupData {
  sectionId: string
  title: string
  suggestions: PositionedSuggestion[]
}

/**
 * Groups by the resume section a suggestion targets, in first-seen order —
 * stable and cheap, and matches the order the suggestions themselves arrived
 * in rather than re-sorting by the section list.
 */
function groupBySectionTitle(
  suggestions: EnhanceSuggestion[] | null,
  sections: { id: string; title: string }[] | undefined
): SuggestionGroupData[] {
  if (!suggestions) return []
  const bySectionId = new Map<string, PositionedSuggestion[]>()
  suggestions.forEach((suggestion, index) => {
    const positioned = { suggestion, position: index + 1 }
    const list = bySectionId.get(suggestion.sectionId)
    if (list) list.push(positioned)
    else bySectionId.set(suggestion.sectionId, [positioned])
  })
  return Array.from(bySectionId.entries()).map(([sectionId, list]) => ({
    sectionId,
    title: sections?.find((s) => s.id === sectionId)?.title ?? "Other",
    suggestions: list,
  }))
}

function SuggestionGroup({
  title,
  suggestions,
  defaultOpen,
}: {
  title: string
  suggestions: PositionedSuggestion[]
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [showDismissed, setShowDismissed] = useState(false)
  const applyEnhanceSuggestion = useResumeStore((s) => s.applyEnhanceSuggestion)
  const appliedCount = suggestions.filter(({ suggestion }) => suggestion.status === "applied").length
  const dismissedCount = suggestions.filter(({ suggestion }) => suggestion.dismissed).length
  const applicable = suggestions.filter(
    ({ suggestion }) => suggestion.status === "pending" && !suggestion.dismissed
  )
  const visible = suggestions.filter(({ suggestion }) => showDismissed || !suggestion.dismissed)

  /**
   * Applies every pending, non-dismissed row in this section through the same
   * store call the per-row buttons use, so each one keeps its own staleness
   * check — a row whose text changed is skipped, never overwritten.
   */
  function applyAll() {
    const total = applicable.length
    let applied = 0
    for (const { suggestion } of applicable) {
      if (applyEnhanceSuggestion(suggestion.id).ok) applied += 1
    }
    const skipped = total - applied
    const message = `Applied ${applied} of ${total}${
      skipped > 0 ? ` · ${skipped} skipped (content changed)` : ""
    }`
    if (skipped === 0) toast.success(message)
    else if (applied === 0) toast.error(message)
    else toast.info(message)
  }

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs font-medium text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
          {title} ({suggestions.length})
        </span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {appliedCount} of {suggestions.length} applied
        </span>
      </button>
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2 text-[11px]">
        <button
          type="button"
          onClick={applyAll}
          disabled={applicable.length === 0}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-violet-600 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-violet-400"
        >
          <CheckCircle2 className="h-3 w-3" />
          Apply all ({applicable.length})
        </button>
        {dismissedCount > 0 && (
          <span className="text-muted-foreground">
            {dismissedCount} dismissed ·{" "}
            <button
              type="button"
              onClick={() => {
                setShowDismissed((v) => !v)
                setOpen(true)
              }}
              aria-expanded={showDismissed}
              aria-label={showDismissed ? "Hide dismissed" : "Show dismissed"}
              className="font-medium text-brand-400 underline-offset-2 hover:underline"
            >
              {showDismissed ? "Hide" : "Show"}
            </button>
          </span>
        )}
      </div>
      {open && visible.length > 0 && (
        <div className="space-y-2 border-t border-border p-2">
          {visible.map(({ suggestion, position }) => (
            <SuggestionRow key={suggestion.id} suggestion={suggestion} position={position} />
          ))}
        </div>
      )}
    </div>
  )
}

function SuggestionRow({
  suggestion,
  position,
}: {
  suggestion: EnhanceSuggestion
  position: number
}) {
  const applyEnhanceSuggestion = useResumeStore((s) => s.applyEnhanceSuggestion)
  const revertEnhanceSuggestion = useResumeStore((s) => s.revertEnhanceSuggestion)
  const dismissEnhanceSuggestion = useResumeStore((s) => s.dismissEnhanceSuggestion)
  const undismissEnhanceSuggestion = useResumeStore((s) => s.undismissEnhanceSuggestion)
  const isApplied = suggestion.status === "applied"
  const isDismissed = !isApplied && suggestion.dismissed === true
  const isRemoval = suggestion.action === "remove"

  function report(result: EnhanceMutationResult, successMessage: string) {
    if (result.ok) {
      toast.success(successMessage)
      return
    }
    toast.error(FAILURE_MESSAGE[result.reason])
  }

  return (
    <div
      className={`space-y-2 rounded-md border border-border bg-background p-2.5 text-xs ${
        isDismissed ? "opacity-60" : ""
      }`}
    >
      <p className="text-muted-foreground">{suggestion.reason}</p>
      {isRemoval && (
        <p className="inline-flex items-center gap-1 rounded-md bg-red-600/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
          <Trash2 className="h-3 w-3" />
          Suggest removing
        </p>
      )}
      {/* del/ins carry the "replaced by" relationship for assistive tech; the
          strike-through is spelled out rather than left to UA defaults. A
          removal has no replacement, so it shows the del on its own. */}
      <del className="block text-muted-foreground line-through">{suggestion.original}</del>
      {!isRemoval && (
        <ins className="block leading-relaxed text-foreground no-underline">
          {suggestion.suggested}
        </ins>
      )}
      <div className="flex justify-end gap-1">
        {isDismissed ? (
          <button
            type="button"
            onClick={() => undismissEnhanceSuggestion(suggestion.id)}
            aria-label={`Restore suggestion ${position}`}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="h-3 w-3" />
            Restore
          </button>
        ) : isApplied ? (
          <button
            type="button"
            onClick={() =>
              report(
                revertEnhanceSuggestion(suggestion.id),
                isRemoval ? "Bullet restored." : "Reverted to your original text."
              )
            }
            aria-label={
              isRemoval ? `Restore bullet ${position}` : `Revert suggestion ${position}`
            }
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="h-3 w-3" />
            {isRemoval ? "Restore" : "Revert"}
          </button>
        ) : isRemoval ? (
          <>
            <button
              type="button"
              onClick={() => dismissEnhanceSuggestion(suggestion.id)}
              aria-label={`Dismiss suggestion ${position}`}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => report(applyEnhanceSuggestion(suggestion.id), "Bullet removed.")}
              aria-label={`Remove bullet ${position}`}
              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-500 active:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="h-3 w-3" />
              Remove
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => dismissEnhanceSuggestion(suggestion.id)}
              aria-label={`Dismiss suggestion ${position}`}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => report(applyEnhanceSuggestion(suggestion.id), "Suggestion applied.")}
              aria-label={`Apply suggestion ${position}`}
              className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CheckCircle2 className="h-3 w-3" />
              Apply
            </button>
          </>
        )}
      </div>
    </div>
  )
}
