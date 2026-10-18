"use client"

import { useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Loader2,
  ScanText,
  Wand2,
  XCircle,
} from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Drawer, DrawerBody, DrawerHeader } from "@/shared/ui/drawer"
import {
  useResumeStore,
  type ATSResults as ATSResultsType,
  type ATSIssue,
  type Section,
} from "../hooks/use-resume-store"
import { useATSTrigger } from "../hooks/use-ats-trigger"
import { useEnhanceTrigger } from "../hooks/use-enhance-trigger"
import { ATSViewDialog } from "./ats-view-dialog"
import { ScoreDelta } from "./enhance-drawer"
import { findMatchingSectionId } from "../lib/match-issue-section"
import { collectEnhanceTargets } from "../lib/enhance-targets"

/**
 * ATS analysis as a contextual inspector (spec section 7) — replaces the
 * ~2000px inline block that used to sit inside the editing pane. Opened by
 * `openInspector === "ats"`, set either from the toolbar `ATS` button or
 * automatically when a fresh analysis lands (see `resume-editor.tsx`).
 */
export function ATSDrawer() {
  const openInspector = useResumeStore((s) => s.openInspector)
  const setOpenInspector = useResumeStore((s) => s.setOpenInspector)
  const atsResults = useResumeStore((s) => s.atsResults)
  const atsStale = useResumeStore((s) => s.atsStale)
  const previousScore = useResumeStore((s) => s.atsPreviousScore)
  const isAnalyzing = useResumeStore((s) => s.isAnalyzing)
  const atsError = useResumeStore((s) => s.atsError)
  const jobDescription = useResumeStore((s) => s.jobDescription)
  const sections = useResumeStore((s) => s.resume?.sections)
  const setActiveSection = useResumeStore((s) => s.setActiveSection)
  const [isATSViewOpen, setIsATSViewOpen] = useState(false)
  const { trigger: triggerAnalyze } = useATSTrigger()
  const { trigger: triggerEnhance, isEnhancing } = useEnhanceTrigger()

  const hasJobDescription = jobDescription.trim().length > 0
  // A run with no job target answers "is this a strong resume?" instead of
  // "does this match the job?" — the keyword half of the report does not apply.
  // Before the first run there is no `mode` to read, so fall back to the same
  // job-description signal the hint below uses — otherwise a never-analyzed
  // resume with no job target is titled "ATS Analysis" while the header nudge
  // that opened this drawer says "Run Resume Quality".
  const isQuality = atsResults ? atsResults.mode === "quality" : !hasJobDescription

  function jumpToSection(sectionId: string) {
    setActiveSection(sectionId)
    setOpenInspector(null)
    // The drawer unmounts on close, so the scroll has to wait one frame for
    // the section to actually be in the DOM (it always was — the editor pane
    // stays mounted underneath — but the drawer's own exit transition can
    // still be mid-flight).
    requestAnimationFrame(() => {
      document
        .getElementById(`resume-section-${sectionId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }

  /**
   * Hands one issue's section to Enhance: a run over that section only. The
   * trigger records the focus once the run actually starts.
   */
  function fixWithEnhance(sectionId: string) {
    setOpenInspector("enhance")
    void triggerEnhance({ sectionId })
  }

  return (
    <Drawer
      open={openInspector === "ats"}
      onClose={() => setOpenInspector(null)}
      width="max-w-lg"
      aria-label="ATS analysis"
    >
      <DrawerHeader>
        <h2 className="text-sm font-semibold">
          {isQuality ? "Resume Quality" : "ATS Analysis"}
        </h2>
      </DrawerHeader>
      <DrawerBody className="space-y-4">
        {atsResults && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <ScoreGauge score={atsResults.overallScore} />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {isQuality ? "Quality Score" : "ATS Score"}: {atsResults.overallScore}
              </p>
              <p className="text-xs text-muted-foreground">
                {getScoreLabel(atsResults.overallScore, isQuality)}
              </p>
              {/* Same "was M, +Δ" line the Enhance drawer shows after a re-run. */}
              {previousScore !== null && !isAnalyzing && (
                <ScoreDelta results={atsResults} previousScore={previousScore} />
              )}
            </div>
          </div>
        )}

        {atsResults && atsStale && !isAnalyzing && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Outdated: the resume changed since this analysis ran. Re-analyze to
            see current results.
          </div>
        )}

        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={triggerAnalyze}
            disabled={isAnalyzing}
            aria-label={isAnalyzing ? "Analyzing" : atsResults ? "Re-analyze" : "Analyze"}
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <ScanText className="h-3.5 w-3.5 text-violet-500" />
                {atsResults ? "Re-analyze" : "Analyze"}
              </>
            )}
          </Button>
          {!hasJobDescription && !isAnalyzing && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              No job target — this checks overall resume quality.{" "}
              <button
                type="button"
                onClick={() => setOpenInspector("job")}
                className="font-medium text-brand-400 underline-offset-2 hover:underline"
              >
                Add a job target
              </button>{" "}
              to check job match.
            </p>
          )}
        </div>

        {isAnalyzing && <AnalyzingState />}

        {atsError && !isAnalyzing && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">{atsError}</p>
          </div>
        )}

        {atsResults && !isAnalyzing && (
          <>
            <CategoryScores scores={atsResults.scores} isQuality={isQuality} />
            {atsResults.issues.length > 0 && (
              <IssuesList
                issues={atsResults.issues}
                sections={sections}
                onJump={jumpToSection}
                onFixWithEnhance={fixWithEnhance}
                isEnhancing={isEnhancing}
              />
            )}
            {atsResults.suggestions.length > 0 && (
              <SuggestionsList suggestions={atsResults.suggestions} />
            )}
            {!isQuality && atsResults.missingKeywords && atsResults.missingKeywords.length > 0 && (
              <MissingKeywords keywords={atsResults.missingKeywords} />
            )}
          </>
        )}

        {/* Available even before the first scan — the plain-text preview
            does not depend on an analysis. */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setIsATSViewOpen(true)}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            View as ATS
          </button>
        </div>
      </DrawerBody>

      <ATSViewDialog open={isATSViewOpen} onClose={() => setIsATSViewOpen(false)} />
    </Drawer>
  )
}

function AnalyzingState() {
  return (
    <div className="rounded-lg border border-border bg-card p-5" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <div>
          <h3 className="font-semibold text-foreground">Analyzing ATS Compatibility...</h3>
          <p className="text-xs text-muted-foreground">Checking formatting, keywords, and impact</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 w-16 animate-pulse rounded bg-muted" />
            <div className="h-2 flex-1 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ScoreGauge({ score }: { score: number }) {
  const radius = 28
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = getScoreColor(score)

  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 64 64">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-muted"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">
        {score}
      </span>
    </div>
  )
}

function CategoryScores({
  scores,
  isQuality,
}: {
  scores: ATSResultsType["scores"]
  isQuality?: boolean
}) {
  const categories = [
    { key: "formatting", label: "Formatting" },
    { key: "keywords", label: "Keywords" },
    { key: "impact", label: "Impact" },
    { key: "completeness", label: "Completeness" },
    { key: "readability", label: "Readability" },
  ] as const

  // `scores.keywords` is unweighted and meaningless without a job description,
  // so a quality run does not show a row for it.
  const visible = isQuality
    ? categories.filter((category) => category.key !== "keywords")
    : categories

  return (
    <div className="space-y-2">
      {visible.map(({ key, label }) => {
        const value = scores[key]
        // Quality rows carry `keywords: null`; the filter above already drops
        // the row, this keeps the render safe for any other null.
        if (value === null) return null
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span className="w-24 text-muted-foreground">{label}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                style={{
                  width: `${value}%`,
                  backgroundColor: getScoreColor(value),
                }}
              />
            </div>
            <span className="w-7 text-right font-medium">{value}</span>
          </div>
        )
      })}
    </div>
  )
}

function IssuesList({
  issues,
  sections,
  onJump,
  onFixWithEnhance,
  isEnhancing,
}: {
  issues: ATSIssue[]
  sections: Section[] | undefined
  onJump: (sectionId: string) => void
  onFixWithEnhance: (sectionId: string) => void
  isEnhancing: boolean
}) {
  const critical = issues.filter((i) => i.severity === "critical")
  const warnings = issues.filter((i) => i.severity === "warning")
  const infos = issues.filter((i) => i.severity === "info")
  // Sections Enhance has text to rewrite in — the same collection the trigger
  // sends, so the button never leads to a "nothing to enhance" dead end.
  const enhanceableSectionIds = new Set(
    collectEnhanceTargets(sections ?? []).map((target) => target.sectionId)
  )

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Issues
      </h4>
      {[...critical, ...warnings, ...infos].map((issue, idx) => (
        <IssueItem
          key={idx}
          issue={issue}
          sections={sections}
          onJump={onJump}
          onFixWithEnhance={onFixWithEnhance}
          enhanceableSectionIds={enhanceableSectionIds}
          isEnhancing={isEnhancing}
        />
      ))}
    </div>
  )
}

function IssueItem({
  issue,
  sections,
  onJump,
  onFixWithEnhance,
  enhanceableSectionIds,
  isEnhancing,
}: {
  issue: ATSIssue
  sections: Section[] | undefined
  onJump: (sectionId: string) => void
  onFixWithEnhance: (sectionId: string) => void
  enhanceableSectionIds: ReadonlySet<string>
  isEnhancing: boolean
}) {
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

  const matchedSectionId = findMatchingSectionId(sections, issue.section)
  const matchedSection = sections?.find((s) => s.id === matchedSectionId)

  return (
    <div className="flex gap-2 rounded-md border border-border bg-background p-2.5 text-xs">
      <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${color}`} />
      <div className="space-y-1">
        <p className="text-foreground">{issue.message}</p>
        {issue.suggestion && (
          <p className="text-muted-foreground">{issue.suggestion}</p>
        )}
        {matchedSectionId && matchedSection && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => onJump(matchedSectionId)}
              aria-label={`Go to ${matchedSection.title} section`}
              className="inline-flex items-center gap-1 font-medium text-brand-400 underline-offset-2 hover:underline"
            >
              Go to {matchedSection.title}
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
            {enhanceableSectionIds.has(matchedSectionId) && (
              <button
                type="button"
                onClick={() => onFixWithEnhance(matchedSectionId)}
                disabled={isEnhancing}
                aria-label={`Fix ${matchedSection.title} with Enhance`}
                className="inline-flex items-center gap-1 font-medium text-brand-400 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
              >
                <Wand2 className="h-3 w-3" aria-hidden="true" />
                Fix with Enhance
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SuggestionsList({
  suggestions,
}: {
  suggestions: ATSResultsType["suggestions"]
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Suggestions
      </h4>
      {suggestions.map((s, idx) => (
        <div key={idx} className="flex gap-2 rounded-md border border-border bg-background p-2.5 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-green-600 dark:text-green-500" />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">{s.title}</p>
            <p className="text-muted-foreground">{s.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function MissingKeywords({ keywords }: { keywords: string[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Missing keywords
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {keywords.map((keyword) => (
          <span
            key={keyword}
            className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground"
          >
            {keyword}
          </span>
        ))}
      </div>
    </div>
  )
}

function getScoreColor(score: number): string {
  if (score >= 75) return "#22c55e"
  if (score >= 50) return "#f59e0b"
  return "#ef4444"
}

function getScoreLabel(score: number, isQuality = false): string {
  // A quality run never saw a job description, so it cannot speak to whether
  // this resume passes a particular ATS filter.
  if (isQuality) {
    if (score >= 90) return "Excellent — a strong resume on its own merits"
    if (score >= 75) return "Good — a few refinements left"
    if (score >= 50) return "Fair — the fixes below are worth making"
    return "Needs work — start with the issues below"
  }
  if (score >= 90) return "Excellent — highly ATS-friendly"
  if (score >= 75) return "Good — likely to pass most ATS filters"
  if (score >= 50) return "Fair — needs improvement for ATS"
  return "Needs work — may be filtered out by ATS"
}
