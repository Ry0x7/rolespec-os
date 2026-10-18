"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Briefcase,
  ChevronDown,
  Download,
  Eye,
  Loader2,
  Save,
  ScanText,
  Sparkles,
  Wand2,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/shared/ui/badge"
import { Button, buttonVariants } from "@/shared/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu"
import { generateResume } from "@/features/export/actions/generate"
import { exportResumePdf } from "@/features/export/actions/export-pdf"
import { jobDetailHref } from "@/features/jobs/lib/job-detail-href"
import { cn } from "@/shared/lib/utils"
import { analysisMode, atsVariant, scoreLabel, topIssue } from "../lib/ats-score"
import { useResumeStore } from "../hooks/use-resume-store"
import { ResumeKindBadge } from "./resume-kind-badge"

interface Props {
  /**
   * Manual save. Owned by the editor, which mounts the single autosave hook.
   * Awaitable so Download PDF can flush unsaved edits before the server renders
   * the resume — the action reads the saved content, not the store.
   */
  onSave: () => void | Promise<void>
  /**
   * Set for a job-tailored resume: the job this resume was created for, so the
   * round trip from /jobs/[id] → tailor → editor has a way back. Also set for
   * any other resume opened from a job via `?jobId=`.
   */
  linkedJob?: { id: string; title: string } | null
}

export function EditorHeader({ onSave, linkedJob }: Props) {
  const resume = useResumeStore((s) => s.resume)
  const atsResults = useResumeStore((s) => s.atsResults)
  const atsStale = useResumeStore((s) => s.atsStale)
  const isAnalyzing = useResumeStore((s) => s.isAnalyzing)
  const saveStatus = useResumeStore((s) => s.saveStatus)
  const isDirty = useResumeStore((s) => s.isDirty)
  const generateStatus = useResumeStore((s) => s.generateStatus)
  const lastExport = useResumeStore((s) => s.lastExport)
  const exportStale = useResumeStore((s) => s.exportStale)
  const lastSavedAt = useResumeStore((s) => s.lastSavedAt)
  const isEnhancing = useResumeStore((s) => s.isEnhancing)
  const enhanceSuggestions = useResumeStore((s) => s.enhanceSuggestions)
  const groupAdditional = useResumeStore((s) => s.groupAdditional)
  const groupAdditionalTitle = useResumeStore((s) => s.groupAdditionalTitle)
  const customization = useResumeStore((s) => s.customization)
  const setGenerateStatus = useResumeStore((s) => s.setGenerateStatus)
  const setLastExport = useResumeStore((s) => s.setLastExport)
  const applyGeneratedSections = useResumeStore((s) => s.applyGeneratedSections)
  const setOpenInspector = useResumeStore((s) => s.setOpenInspector)
  const [isPending, startTransition] = useTransition()
  const [isDownloading, setIsDownloading] = useState(false)

  const isGenerating = generateStatus === "generating" || isPending
  const isSaving = saveStatus === "saving"
  const saveState = isSaving
    ? "Saving…"
    : isDirty
      ? "Unsaved changes"
      : lastSavedAt
        ? `Saved ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : null
  // An empty resume renders an empty page, so the plain download waits for
  // something to put on it.
  const hasContent = !!resume?.sections?.some((s) => s.items.length > 0)

  // Plain PDF of the saved content — no AI, so it works without an API key.
  async function handleDownload() {
    if (!resume || isDownloading) return
    setIsDownloading(true)
    try {
      // The action renders from the database, so unsaved edits have to land
      // first or the file would be one revision behind the preview.
      if (isDirty) await onSave()

      const result = await exportResumePdf(resume.id, {
        groupAdditional,
        groupAdditionalTitle,
        customization,
      })

      if (!("success" in result) || !result.success) {
        toast.error(result.error ?? "Download failed")
        return
      }

      // Programmatic anchor rather than window.open: the click happens after an
      // await, which popup blockers treat as untrusted.
      const link = document.createElement("a")
      link.href = result.pdfUrl
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      document.body.appendChild(link)
      link.click()
      link.remove()
    } finally {
      setIsDownloading(false)
    }
  }

  function handleGenerate() {
    if (!resume) return
    startTransition(async () => {
      setGenerateStatus("generating")
      const result = await generateResume(resume.id, {
        groupAdditional,
        groupAdditionalTitle,
        customization,
      })

      if ("success" in result && result.success) {
        setGenerateStatus("success")
        setLastExport({ templateUrls: result.templateUrls })
        // Generate persisted AI-optimized content; reflect it in the editor so
        // the preview shows (and paginates) what was actually exported. A
        // store with unsaved edits is left alone — the user's edits win.
        applyGeneratedSections(result.sections)
        // The AI pass fails soft, so a "success" can still mean the files carry
        // the untouched content. Say which one happened.
        if (result.optimized === false) {
          toast.success(
            result.optimizeFallbackReason === "ai_key_required"
              ? "Exported without AI optimization — no AI key configured."
              : result.optimizeFallbackReason === "ai_daily_limit"
                ? "Exported without AI optimization — daily AI limit reached."
                : "Exported without AI optimization."
          )
        } else {
          toast.success("Resume generated successfully!")
        }
      } else {
        setGenerateStatus("error")
        toast.error(result.error ?? "Generation failed")
      }
    })
  }

  // A derived resume links to its source; a master names its origin.
  // An archived source is named but not linked.
  const lineage = resume?.sourceResume?.status === "ARCHIVED" ? (
    <span className="max-w-[12rem] truncate sm:max-w-xs">
      From {resume.sourceResume.title}
    </span>
  ) : resume?.sourceResume ? (
    <Link
      href={`/resumes/${resume.sourceResume.id}`}
      className="max-w-[12rem] truncate rounded-sm transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
    >
      From {resume.sourceResume.title}
    </Link>
  ) : resume?.variant === "MASTER" && resume.origin === "profile" ? (
    <span>From Career Profile</span>
  ) : null

  return (
    // Sticky so primary actions stay reachable while the page itself scrolls
    // below `xl`; at `xl` the panes scroll instead and this header is already
    // pinned above them by the editor's own flex column, so the sticky rule
    // is a no-op there rather than a second, conflicting stack. `top-14`
    // parks it under the app shell's own sticky header (h-14) instead of
    // behind it — at `xl` that header's column doesn't scroll past this one,
    // so `top-0` is correct there. Opaque background: the section list must
    // not show through while scrolling under it. `xl:px-6` matches the panes'
    // own `xl:p-6`, so both switch on the same breakpoint as the split.
    <div className="sticky top-14 z-[var(--z-sticky)] flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3 xl:top-0 xl:px-6">
      <div className="flex items-center gap-3">
        <Link href="/resumes">
          <Button variant="ghost" size="icon" aria-label="Back to resumes" title="Back to resumes">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="font-semibold">{resume?.title ?? "Resume"}</h1>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            {/* What kind of resume this is, named the same way as its card on
                /resumes. A pill, so it needs no separator after it. */}
            {resume?.variant && (
              <ResumeKindBadge
                variant={resume.variant}
                roleFamilyName={resume.roleFamilyName}
              />
            )}
            {/* Where this resume came from, as on its /resumes card. Pre-lineage
                rows carry neither field and show nothing here. */}
            {lineage && (
              <>
                {lineage}
                {(resume?.targetRole || saveState || linkedJob) && (
                  <span aria-hidden="true">·</span>
                )}
              </>
            )}
            {resume?.targetRole && <span>{resume.targetRole}</span>}
            {resume?.targetRole && saveState && <span aria-hidden="true">·</span>}
            {/* Autosave is silent on success, so the state has to live somewhere
                permanent — and unlike the Save button's label, this stays
                visible on mobile. */}
            {saveState && (
              <span role="status" aria-live="polite">
                {saveState}
              </span>
            )}
            {/* Round trip for a job-tailored resume. Lives on the meta line so
                it stays low-emphasis, and is width-capped so a long job title
                cannot push the header's action cluster off a phone. */}
            {linkedJob && (
              <>
                {(resume?.targetRole || saveState) && <span aria-hidden="true">·</span>}
                <Link
                  href={jobDetailHref(linkedJob.id, "prepare")}
                  className="max-w-[12rem] truncate rounded-sm transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
                >
                  Back to job: {linkedJob.title}
                </Link>
              </>
            )}
          </div>
        </div>
        {/* Status, not an expensive action: low-emphasis and grouped with the
            save state it explains, away from the money/file cluster. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onSave}
          disabled={saveStatus === "saving" || !isDirty}
          aria-label={saveStatus === "saving" ? "Saving" : isDirty ? "Save" : "Saved"}
          title={saveStatus === "saving" ? "Saving..." : isDirty ? "Save" : "Saved"}
        >
          {saveStatus === "saving" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="hidden sm:inline">Saving...</span>
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{isDirty ? "Save" : "Saved"}</span>
            </>
          )}
        </Button>
      </div>
      {/* Deliberately NOT a scroll container. An earlier pass gave this row
          `overflow-x-auto` to pre-empt six buttons overflowing a phone, but the
          labels are already `hidden sm:inline`, so at 320px the row measures
          278px against 278px of space — it never scrolled. What it did do was
          clip the Export menu: `DropdownMenuContent` is absolutely positioned,
          and `overflow-x: auto` computes `overflow-y` to `auto` as well, so the
          menu was cropped to the 32px height of this row. The parent's
          `flex-wrap` is what handles a genuinely cramped viewport — plus this
          row's own `flex-wrap`: with the 141px "Run Resume Quality" nudge the
          row measures 427px, wider than a 390px phone, so it wraps rather than
          pushing the page sideways. Wrapping does not clip the menu, but it
          drops Export to the left edge of the second row, where a right-aligned
          menu runs off-screen left. That happens below `md` (at `sm` the
          labels return and the row wraps again). So below `md` the Export menu
          positions against this row (`relative` here, `static` on the menu
          wrapper) and anchors to its left edge, which stays on-screen whether
          or not the row wraps; from `md` it is right-aligned under the trigger. */}
      <div className="relative flex flex-wrap items-center gap-2">
        {/* Below `xl` only — at `xl` and up the preview is the inline pane
            next to the editor and needs no toggle. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpenInspector("preview")}
          aria-label="Preview"
          title="Preview"
          className="xl:hidden"
        >
          <Eye className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Preview</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpenInspector("job")}
          aria-label="Job target"
          title="Job target"
        >
          <Briefcase className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Job target</span>
        </Button>

        {/* The analyze → fix loop, visible without opening the drawer: the
            first-run nudge, or the score plus the one issue worth acting on. */}
        <AnalysisStatus />

        {/* Replaces the old standalone Analyze button and ATSBadge: one
            control opens the inspector, which is where a disabled Analyze
            gets to explain itself — so this is never disabled. The score
            itself is rendered by `AnalysisStatus` above (mode-aware), so this
            control carries only the icon and the staleness flag. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpenInspector("ats")}
          aria-label={
            isAnalyzing
              ? "Analyzing"
              : atsResults
                ? `ATS score ${atsResults.overallScore}${atsStale ? ", outdated" : ""}`
                : "ATS analysis"
          }
          title={isAnalyzing ? "Analyzing..." : "ATS analysis"}
        >
          {isAnalyzing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ScanText className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">ATS</span>
          {atsResults && atsStale && !isAnalyzing && (
            <span className="text-xs text-amber-600 dark:text-amber-500">Outdated</span>
          )}
        </Button>

        {/* Opens the inspector rather than running the AI directly — the run
            moves inside, mirroring Analyze. Never disabled: the inspector is
            where the "needs an ATS analysis" gate gets to explain itself. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpenInspector("enhance")}
          aria-label={isEnhancing ? "Enhancing" : "Enhance"}
          title={isEnhancing ? "Enhancing..." : "Enhance"}
        >
          {isEnhancing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">Enhance</span>
          {enhanceSuggestions && enhanceSuggestions.length > 0 && !isEnhancing && (
            <span className="text-xs text-muted-foreground">
              {enhanceSuggestions.length}
            </span>
          )}
        </Button>

        {/* File-output actions collapse into one menu: they were six equal-
            weight peers before, which buried Generate — the one action that
            actually costs an AI call — among plain downloads. */}
        <DropdownMenu className="static md:relative">
          {/* DropdownMenuTrigger renders its own <button>, so it takes
              Button's variant classes directly rather than wrapping a
              <Button> (asChild isn't a trigger prop — see the account menu
              in shared/components/header.tsx for the same pattern). */}
          <DropdownMenuTrigger
            aria-label="Export"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <span className="hidden sm:inline">Export</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            label="Export"
            align="end"
            className="left-0 right-auto md:left-auto md:right-0"
          >
            {/* Always available: renders the current content, no AI key needed. */}
            <DropdownMenuItem
              onClick={handleDownload}
              disabled={isDownloading || !hasContent}
              aria-label={isDownloading ? "Preparing PDF" : "Download PDF"}
              title={
                !hasContent
                  ? "Add some content to download"
                  : isDownloading
                    ? "Preparing PDF..."
                    : "Download PDF of your current resume — no AI needed"
              }
            >
              {isDownloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {isDownloading ? "Preparing..." : "Download PDF"}
            </DropdownMenuItem>

            {lastExport && (() => {
              const urls = lastExport.templateUrls[resume?.template ?? "MINIMAL"]
              if (!urls) return null
              return (
                <DropdownMenuItem asChild>
                  <a
                    href={urls.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Download AI-optimized PDF"
                    title="Download AI-optimized PDF"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="flex flex-col items-start">
                      Download AI-optimized PDF
                      {/* Edits never revoke the files — the blob URLs stay
                          valid — so an edited resume only labels them as
                          behind the current content. */}
                      {exportStale && (
                        <span
                          className="text-xs text-muted-foreground"
                          title="Generated before your latest edits — Generate again for an up-to-date file"
                        >
                          outdated
                        </span>
                      )}
                    </span>
                  </a>
                </DropdownMenuItem>
              )
            })()}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={isGenerating}
          aria-label={isGenerating ? "Generating" : "Generate AI-optimized export"}
          title={
            isGenerating
              ? "Generating..."
              : "AI-optimized export — rewrites your content, needs an AI key"
          }
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="hidden sm:inline">Generating...</span>
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Generate</span>
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

/**
 * Header-level analysis state, so the analyze → fix loop is legible without
 * opening the drawer: either a first-run nudge, or the score and the single
 * issue worth acting on next.
 *
 * Reads the live store first and falls back to what the server hydrated, so a
 * reload of a previously analyzed resume still shows a score even if only the
 * denormalized `resume.atsScore` survived.
 */
function AnalysisStatus() {
  const resume = useResumeStore((s) => s.resume)
  const atsResults = useResumeStore((s) => s.atsResults)
  const isAnalyzing = useResumeStore((s) => s.isAnalyzing)
  const jobDescription = useResumeStore((s) => s.jobDescription)
  const setOpenInspector = useResumeStore((s) => s.setOpenInspector)

  // The server loader hands the resume to the client component, which copies it
  // into the store in an effect — so the first paint after navigation has an
  // empty store. Rendering the never-analyzed branch there makes an analyzed
  // job-match resume flash "Not analyzed yet" / "Run Resume Quality" before
  // flipping to its real score. `resume === null` is the only state that means
  // "not hydrated yet": `setResume` always sets it.
  if (resume === null) return null

  if (isAnalyzing) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="text-xs text-muted-foreground"
      >
        Analyzing…
      </span>
    )
  }

  const analysis = atsResults ?? resume?.latestAnalysis ?? null
  const score = analysis?.overallScore ?? resume?.atsScore ?? null

  if (score == null) {
    // A job description — retained from a past job-match run, or pasted into
    // the job-target panel this session — means the next run answers "does
    // this match the job", not "is this resume good", so the nudge is named
    // for the run the user would actually get.
    const hasJobDescription =
      !!resume?.jobDescription || jobDescription.trim().length > 0
    return (
      <div className="flex shrink-0 items-center gap-2">
        {/* `xl` for the same reason as the score chip's issue line: below it
            the toolbar has no room, and the button label already says what
            has not happened yet. */}
        <span className="hidden whitespace-nowrap text-xs text-muted-foreground xl:inline">
          Not analyzed yet
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpenInspector("ats")}
          className="whitespace-nowrap"
        >
          {hasJobDescription ? "Run analysis" : "Run Resume Quality"}
        </Button>
      </div>
    )
  }

  // Same derivation the resume card uses, so one score never reads as two
  // different questions on two surfaces.
  const kind = scoreLabel(analysisMode(analysis?.mode, !!resume?.jobDescription))
  const issue = topIssue(analysis?.issues)
  const issueText = issue ? issue.message : "No issues flagged"

  return (
    <button
      type="button"
      onClick={() => setOpenInspector("ats")}
      aria-label={`${kind} score ${score}, open analysis`}
      title={issueText}
      className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Badge variant={atsVariant(score)} size="sm">
        {kind} {score}
      </Badge>
      {/* One line only: an issue message is a sentence, and the toolbar has
          no room for two of them. The full text lives in the button's title
          and, in full, in the drawer. `xl` is the first width where the
          toolbar row measures narrower than the header even with this
          added — at `md` it pushed Generate past the right edge. */}
      <span className="hidden max-w-[16rem] truncate text-xs text-muted-foreground xl:block">
        {issueText}
      </span>
    </button>
  )
}
