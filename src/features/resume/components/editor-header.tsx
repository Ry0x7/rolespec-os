"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Briefcase,
  ChevronDown,
  Download,
  Eye,
  FileText,
  GitCompare,
  History,
  Loader2,
  Save,
  ScanText,
  Sparkles,
  Wand2,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/shared/ui/badge"
import { Button, buttonVariants } from "@/shared/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu"
import { generateResume } from "@/features/export/actions/generate"
import { exportResumePdf } from "@/features/export/actions/export-pdf"
import { jobDetailHref } from "@/features/jobs/lib/job-detail-href"
import { cn } from "@/shared/lib/utils"
import { analysisMode, atsVariant, scoreLabel, topIssue } from "../lib/ats-score"
import { useResumeStore } from "../hooks/use-resume-store"
import { ResumeKindBadge } from "./resume-kind-badge"
import { ResumeComparisonDrawer } from "./resume-comparison-drawer"
import { ResumeHistoryDrawer } from "./resume-history-drawer"
import { ResumePdfDrawer } from "./resume-pdf-drawer"

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
  const [showCompare, setShowCompare] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showPdf, setShowPdf] = useState(false)

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

  // The Tools menu carries the analysis entry, so its label has to say which
  // run the user would actually get. Before hydration the safe default is the
  // general quality run; the drawer explains the rest.
  const analysis = atsResults ?? resume?.latestAnalysis ?? null
  const hasScore = (analysis?.overallScore ?? resume?.atsScore ?? null) != null
  const analysisLabel = hasScore
    ? "ATS analysis"
    : resume?.jobDescription
      ? "Run analysis"
      : "Run Resume Quality"

  // Plain PDF of the saved content — no AI, so it works without an API key.
  async function handleDownload(singlePage = false) {
    if (!resume || isDownloading) return
    setIsDownloading(true)
    try {
      // The action renders from the database, so unsaved edits have to land
      // first or the file would be one revision behind the preview.
      if (isDirty) await onSave()
      if (useResumeStore.getState().isDirty || useResumeStore.getState().saveStatus === "saving") {
        toast.error("Save your pending edits before downloading the PDF.")
        return
      }

      const result = await exportResumePdf(resume.id, {
        groupAdditional,
        groupAdditionalTitle,
        customization,
        singlePage,
      })

      if (!("success" in result) || !result.success) {
        toast.error(result.error ?? "Download failed")
        return
      }

      // The one-page option never fails the download when the content cannot
      // fit; it says plainly that the tightest supported layout still spilled.
      if (
        singlePage &&
        "singlePageSatisfied" in result &&
        !result.singlePageSatisfied &&
        result.warning
      ) {
        toast.warning(result.warning)
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
    } catch {
      toast.error("Could not prepare the PDF. Your edits are preserved; please retry.")
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
        applyGeneratedSections(result.sections, result.version)
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
    // pinned above them by the editor's own flex column. `top-14` parks it
    // under the app shell's sticky header (h-14) instead of behind it.
    <div className="sticky top-14 z-[var(--z-sticky)] border-b border-border bg-background xl:top-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4 xl:px-6">
        {/* Title block: can shrink to nothing, never pushes the actions off. */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
          <Link href="/resumes" className="shrink-0">
            <Button variant="ghost" size="icon" aria-label="Back to resumes" title="Back to resumes">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold leading-tight sm:text-base">
              {resume?.title ?? "Resume"}
            </h1>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              {/* What kind of resume this is, named the same way as its card on
                  /resumes. */}
              {resume?.variant && (
                <ResumeKindBadge
                  variant={resume.variant}
                  roleFamilyName={resume.roleFamilyName}
                />
              )}
              {/* Where this resume came from, as on its /resumes card. */}
              {lineage && (
                <>
                  {lineage}
                  {(resume?.targetRole || saveState || linkedJob) && (
                    <span aria-hidden="true">·</span>
                  )}
                </>
              )}
              {resume?.targetRole && <span className="truncate">{resume.targetRole}</span>}
              {resume?.targetRole && saveState && <span aria-hidden="true">·</span>}
              {saveState && (
                <span role="status" aria-live="polite">
                  {saveState}
                </span>
              )}
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
        </div>

        {/* Actions: three durable controls (Save, Tools, Export) plus the one
            primary action. `flex-wrap` handles a genuinely cramped phone; the
            row itself must never become a scroll container, or it would clip
            the two dropdown menus. */}
        <div
          data-editor-actions
          className="relative flex flex-wrap items-center justify-end gap-1.5 sm:gap-2"
        >
          <AnalysisStatus />

          <Button
            variant="ghost"
            size="sm"
            onClick={onSave}
            disabled={saveStatus === "saving" || !isDirty}
            aria-label={saveStatus === "saving" ? "Saving" : isDirty ? "Save" : "Saved"}
            title={saveStatus === "saving" ? "Saving..." : isDirty ? "Save" : "Saved"}
            className="px-2"
          >
            {saveStatus === "saving" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="hidden md:inline">Saving...</span>
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                <span className="hidden md:inline">{isDirty ? "Save" : "Saved"}</span>
              </>
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Tools"
              title="Resume tools"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Wrench className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Tools</span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              label="Resume tools"
              align="end"
              className="left-0 right-auto w-60 max-w-[calc(100vw-2rem)] sm:left-auto sm:right-0"
            >
              <DropdownMenuLabel>Prepare</DropdownMenuLabel>
              {/* Below `xl` only: at `xl` the preview is the inline pane and
                  this would open the sheet that is not mounted there. */}
              <DropdownMenuItem
                onClick={() => setOpenInspector("preview")}
                aria-label="Preview"
                className="xl:hidden"
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                Preview resume
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setOpenInspector("job")}
                aria-label="Job target"
              >
                <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                Job target
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setOpenInspector("ats")}
                aria-label={analysisLabel}
              >
                {isAnalyzing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ScanText className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span className="flex-1">{analysisLabel}</span>
                {atsResults && atsStale && !isAnalyzing && (
                  <span className="text-xs text-amber-600 dark:text-amber-500">Outdated</span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setOpenInspector("enhance")}
                aria-label="Enhance"
              >
                {isEnhancing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span className="flex-1">Enhance with AI</span>
                {enhanceSuggestions && enhanceSuggestions.length > 0 && !isEnhancing && (
                  <span className="text-xs text-muted-foreground">
                    {enhanceSuggestions.length}
                  </span>
                )}
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Review</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setShowHistory(true)}
                aria-label="Resume history and validation"
              >
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                History and checks
              </DropdownMenuItem>
              {resume?.variant === "JOB_TAILORED" && resume?.sourceResume?.id && (
                <DropdownMenuItem
                  onClick={() => setShowCompare(true)}
                  aria-label="Compare with source resume and rollback"
                >
                  <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                  Compare with source
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* File-output actions stay in one menu: Generate is the only action
              that costs an AI call and must not look like another download. */}
          <DropdownMenu className="static md:relative">
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
              <DropdownMenuItem onClick={() => setShowPdf(true)} disabled={!hasContent} aria-label="Preview generated PDF">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />Preview generated PDF
              </DropdownMenuItem>
              {/* Always available: renders the current content, no AI key needed. */}
              <DropdownMenuItem
                onClick={() => handleDownload()}
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

              {/* ATS-oriented option: same template and content, progressively
                  tighter presentation until the real PDF fits one page. */}
              <DropdownMenuItem
                onClick={() => handleDownload(true)}
                disabled={isDownloading || !hasContent}
                aria-label="Download one-page ATS PDF"
                title="Fit this resume on one ATS-friendly page — no AI needed"
              >
                {isDownloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                Download one-page PDF
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

      {showHistory && resume?.id && <ResumeHistoryDrawer resumeId={resume.id} open={showHistory} onClose={() => setShowHistory(false)} />}
      {showPdf && resume?.id && <ResumePdfDrawer resumeId={resume.id} onSave={onSave} open={showPdf} onClose={() => setShowPdf(false)} />}
      {showCompare && resume?.id && (
        <ResumeComparisonDrawer
          resumeId={resume.id}
          open={showCompare}
          onOpenChange={setShowCompare}
        />
      )}
    </div>
  )
}

/**
 * Header-level analysis state, so the analyze → fix loop is legible without
 * opening the Tools menu: either a quiet "not analyzed" line, or the score and
 * the single issue worth acting on next. The action that starts the run lives
 * in Tools, which is where the label can also explain what the run will check.
 *
 * Reads the live store first and falls back to what the server hydrated, so a
 * reload of a previously analyzed resume still shows a score even if only the
 * denormalized `resume.atsScore` survived.
 */
function AnalysisStatus() {
  const resume = useResumeStore((s) => s.resume)
  const atsResults = useResumeStore((s) => s.atsResults)
  const isAnalyzing = useResumeStore((s) => s.isAnalyzing)
  const setOpenInspector = useResumeStore((s) => s.setOpenInspector)

  // The server loader hands the resume to the client component, which copies it
  // into the store in an effect — so the first paint after navigation has an
  // empty store. Rendering the never-analyzed branch there makes an analyzed
  // job-match resume flash "Not analyzed yet" before flipping to its score.
  if (resume === null) return null

  if (isAnalyzing) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="whitespace-nowrap text-xs text-muted-foreground"
      >
        Analyzing…
      </span>
    )
  }

  const analysis = atsResults ?? resume?.latestAnalysis ?? null
  const score = analysis?.overallScore ?? resume?.atsScore ?? null

  if (score == null) {
    // The run itself is one click away in Tools; this is only a quiet cue.
    // `xl` because below it the header has no spare width, and the Tools menu
    // item already names the run.
    return (
      <span className="hidden whitespace-nowrap text-xs text-muted-foreground xl:inline">
        Not analyzed yet
      </span>
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
      {/* One line only: an issue message is a sentence, and the header has no
          room for two of them. The full text lives in the button's title and,
          in full, in the drawer. */}
      <span className="hidden max-w-[16rem] truncate text-xs text-muted-foreground xl:block">
        {issueText}
      </span>
    </button>
  )
}
