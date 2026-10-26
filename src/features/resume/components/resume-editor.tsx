"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { motion } from "framer-motion"
import { Briefcase } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { useMediaQuery } from "@/shared/hooks/use-media-query"
import { useResumeStore, type ResumeData, type LastExport } from "../hooks/use-resume-store"
import { useAutosave } from "../hooks/use-autosave"
import { useUnsavedGuard } from "../hooks/use-unsaved-guard"
import { getJobDescriptionForResume } from "../actions/get-job-description"
import dynamic from "next/dynamic"
import { SectionPanel } from "./section-panel"
import { type JobOption } from "./job-target-panel"
import { ResumePreview } from "./resume-preview"
import { EditorHeader } from "./editor-header"

// AI inspectors + mobile sheet load on demand so the first paint ships only
// the editing pane + preview. Each is client-only and opens via
// `openInspector`, so a placeholder-free dynamic import never shifts layout.
const JobTargetDrawer = dynamic(() => import("./job-target-drawer").then((m) => m.JobTargetDrawer), {
  ssr: false,
})
const ATSDrawer = dynamic(() => import("./ats-drawer").then((m) => m.ATSDrawer), { ssr: false })
const EnhanceDrawer = dynamic(() => import("./enhance-drawer").then((m) => m.EnhanceDrawer), {
  ssr: false,
})
const ResumePreviewSheet = dynamic(
  () => import("./resume-preview-sheet").then((m) => m.ResumePreviewSheet),
  { ssr: false }
)

/**
 * Tailwind's default `xl` breakpoint — keep in sync with the `xl:` classes below.
 *
 * Deliberately NOT `lg` (1024px), which is where the split used to kick in: the
 * app shell's sidebar is a fixed 240px, so a 1024px viewport left the two panes
 * ~383px and ~392px wide and the preview painted a 344px-wide A4 page (scale
 * 0.578) — measurably worse than the single-column layout with the preview
 * sheet. The split only pays for itself once each pane can hold a readable page.
 */
const DESKTOP_QUERY = "(min-width: 1280px)"

interface Props {
  resume: ResumeData
  initialExport?: LastExport | null
  /** Server-computed: the stored export predates the resume's last save. */
  initialStale?: boolean
  /** Saved jobs the Job Target panel can pull a description from. */
  jobOptions?: JobOption[]
  /** From `/resumes/[id]?jobId=` — prefills the job description once. */
  initialJobId?: string
  /** Set for a job-tailored resume — the header links back to that job. */
  linkedJob?: { id: string; title: string } | null
}

export function ResumeEditor({
  resume,
  initialExport,
  initialStale,
  jobOptions,
  initialJobId,
  linkedJob,
}: Props) {
  const setResume = useResumeStore((s) => s.setResume)
  const setLastExport = useResumeStore((s) => s.setLastExport)
  const setExportStale = useResumeStore((s) => s.setExportStale)
  const atsResults = useResumeStore((s) => s.atsResults)
  const isAnalyzing = useResumeStore((s) => s.isAnalyzing)
  const enhanceSuggestions = useResumeStore((s) => s.enhanceSuggestions)
  const isEnhancing = useResumeStore((s) => s.isEnhancing)
  const storeResume = useResumeStore((s) => s.resume)
  const jobDescription = useResumeStore((s) => s.jobDescription)
  const setJobDescription = useResumeStore((s) => s.setJobDescription)
  const setOpenInspector = useResumeStore((s) => s.setOpenInspector)

  useEffect(() => {
    // Server components hand us fresh object identities on every refresh; only
    // hydrate when we actually switched resumes, otherwise a background refresh
    // would wipe in-progress client state (isDirty, ATS results, active section).
    if (useResumeStore.getState().resume?.id === resume.id) return
    setResume(resume)
    setLastExport(initialExport ?? null)
    // `setLastExport` always clears staleness (a fresh Generate calls it), so the
    // server's verdict has to be applied after it.
    setExportStale(initialStale ?? false)
  }, [resume, initialExport, initialStale, setResume, setLastExport, setExportStale])

  // Job Target's drawer only mounts while open, so the deep-link prefill has
  // to live somewhere that is always mounted — this component — or a
  // `/resumes/[id]?jobId=` visit would silently prefill nothing until the
  // user happened to open the drawer. One-shot: a router.refresh() must not
  // clobber whatever the user has typed into the description since.
  const jobPrefilledRef = useRef(false)
  useEffect(() => {
    if (jobPrefilledRef.current || !initialJobId) return
    jobPrefilledRef.current = true
    getJobDescriptionForResume(initialJobId).then((result) => {
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      setJobDescription(result.jobDescription)
    })
  }, [initialJobId, setJobDescription])

  // The inspector replaces the inline block this used to scroll to — instead,
  // open it. Keyed on the isAnalyzing true -> false transition (not on
  // atsResults itself) because setResume seeds atsResults from
  // resume.latestAnalysis, which would otherwise open the drawer on mount for
  // anyone with a previously saved analysis.
  const wasAnalyzingRef = useRef(isAnalyzing)

  useEffect(() => {
    const wasAnalyzing = wasAnalyzingRef.current
    wasAnalyzingRef.current = isAnalyzing
    if (!wasAnalyzing || isAnalyzing || !atsResults) return
    // A run started from the Enhance drawer (Re-analyze) keeps the user where
    // they are: switching to the ATS drawer would unmount Enhance and throw
    // away the before/after score comparison it is rendering. Read from the
    // store rather than subscribing so a plain inspector change never re-runs
    // this effect.
    if (useResumeStore.getState().openInspector === "enhance") return
    setOpenInspector("ats")
  }, [isAnalyzing, atsResults, setOpenInspector])

  // Same story for Enhance, now an inspector rather than an inline block —
  // open it instead of scrolling to it. Same guard shape as ATS above: keyed
  // on the isEnhancing true -> false transition so it never fires on mount.
  const wasEnhancingRef = useRef(isEnhancing)

  useEffect(() => {
    const wasEnhancing = wasEnhancingRef.current
    wasEnhancingRef.current = isEnhancing
    if (!wasEnhancing || isEnhancing || !enhanceSuggestions) return
    setOpenInspector("enhance")
  }, [isEnhancing, enhanceSuggestions, setOpenInspector])

  // Single autosave owner: the hook keeps its own debounce timer and in-flight
  // guard, so a second mount (the header used to have one) would run two timers
  // and could fire overlapping saves. The header gets the manual save handler
  // from here instead.
  const { performSave } = useAutosave()
  useUnsavedGuard()

  // Ctrl/Cmd+S saves without leaving the keyboard — browsers would otherwise
  // open the Save-page dialog and the keystroke would be lost.
  useEffect(() => {
    function handleSaveShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        performSave()
      }
    }
    window.addEventListener("keydown", handleSaveShortcut)
    return () => window.removeEventListener("keydown", handleSaveShortcut)
  }, [performSave])

  // Single source of truth for where `ResumePreview` mounts: the inline pane
  // at `xl` and up, the sheet below it — never both, so there is only ever
  // one A4 measurement mirror and one ResizeObserver pair. A CSS-only
  // `hidden xl:block` couldn't give that guarantee, because the inline pane
  // would still be mounted (just invisible) while the sheet's own copy was
  // open. `useMediaQuery` defaults to `false` on the server and the first
  // client render, then corrects before paint (see the hook's own comment),
  // so this never mismatches hydration.
  const isDesktop = useMediaQuery(DESKTOP_QUERY)

  return (
    // `h-auto` below `xl`: on a narrow screen the editor is one ordinary
    // document that scrolls with the page. At `xl` it becomes a fixed-height
    // workspace so only the two panes scroll — 3.5rem is the sticky app header
    // (`h-14` in shared/components/header.tsx), and the page wrapper has
    // already cancelled `main`'s padding, so this is exactly the space below it
    // rather than 48px more than it (which used to give the page a second
    // scrollbar on top of the panes').
    <div className="flex h-auto flex-col xl:h-[calc(100dvh-3.5rem)]">
      <EditorHeader onSave={performSave} linkedJob={linkedJob} />
      {/* Grid rather than flex-basis so the split ratio is one declaration —
          a future drag-to-resize only has to swap the template for a custom
          property. `minmax(0,…)` is what stops a wide preview page from
          forcing the column wider than its share. */}
      <div className="flex flex-1 flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:overflow-hidden">
        {/* layoutScroll: framer needs to know this ancestor scrolls, otherwise
            drag/layout measurements go stale once the pane is scrolled. */}
        <motion.div
          layoutScroll
          className="min-w-0 border-b border-border p-4 xl:overflow-y-auto xl:border-b-0 xl:border-r xl:p-6"
        >
          {/* The pane is now as wide as half a 1920px display; form fields at
              that measure are unpleasant to read and to fill in. The editing
              column keeps a comfortable measure and the extra width goes to the
              preview, which is the thing that actually benefits from it. */}
          <div className="mx-auto w-full max-w-3xl space-y-4">
            {/* Contextual summary, not the full form — Job Target used to be a
                permanent block of saved-job picker, textarea and up to 20
                keyword chips. "Change" opens the same content in a drawer. */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-medium">
                  Target: {storeResume?.targetRole ?? "No target role"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {/* Empty until the store has the resume: `setResume` copies
                      the loader's job description in from an effect, so the
                      first paint of an attached-JD resume would otherwise read
                      "No job target" and then flip. */}
                  {storeResume === null
                    ? null
                    : jobDescription.trim().length > 0
                      ? `Job description attached (${jobDescription.length} characters)`
                      : "No job target — Analyze checks overall resume quality. Add one to check job match."}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpenInspector("job")}
                aria-label="Change job target"
              >
                <Briefcase className="h-3.5 w-3.5 text-sky-500" />
                Change
              </Button>
            </div>
            <SectionPanel />
          </div>
        </motion.div>
        {/* Desktop only — below `xl` the preview lives in `ResumePreviewSheet`
            instead (opened from the toolbar's Preview button), never both at
            once. `data-preview-pane` is what the preview's fit-page zoom
            measures — it needs the height of the SCROLL container, not of the
            page stack inside it. */}
        {isDesktop && (
          <div
            data-preview-pane
            className="min-w-0 bg-muted/30 p-4 xl:overflow-y-auto xl:p-6"
          >
            <ResumePreview />
          </div>
        )}
      </div>
      <JobTargetDrawer jobOptions={jobOptions} initialJobId={initialJobId} />
      <ATSDrawer />
      <EnhanceDrawer />
      {!isDesktop && <ResumePreviewSheet />}
    </div>
  )
}
