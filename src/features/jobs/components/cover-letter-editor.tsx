"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { ConfirmDialog } from "@/shared/ui/confirm-dialog"
import { GroundingNotice } from "@/shared/components/grounding-notice"
import { updateCoverLetterContent, improveCoverLetter } from "../actions/cover-letter.actions"
import { CoverLetterSuggestionsPanel } from "./cover-letter-suggestions-panel"
import { CoverLetterChat } from "./cover-letter-chat"
import type { CoverLetterSuggestions } from "./cover-letter-suggestions-panel"

export interface CoverLetterDetail {
  id: string
  content: string
  suggestions: CoverLetterSuggestions | null
  jobDescription: string
  resume: { title: string }
  jobApplication: { id: string; companyName: string; jobTitle: string } | null
}

interface Props {
  coverLetter: CoverLetterDetail
}

const UNSAVED_MESSAGE =
  "This cover letter has unsaved changes. They will be lost if you leave now."

export function CoverLetterEditor({ coverLetter }: Props) {
  const router = useRouter()
  const [content, setContent] = useState(coverLetter.content)
  const [savedContent, setSavedContent] = useState(coverLetter.content)
  const [isSaving, setIsSaving] = useState(false)
  const [isImproving, setIsImproving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** The letter as it was immediately before the last Improve, for one-level undo. */
  const [preImproveContent, setPreImproveContent] = useState<string | null>(null)
  /** Href of a link click held back by the unsaved-changes guard. */
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  const isDirty = content !== savedContent
  const application = coverLetter.jobApplication

  /**
   * Writes `text` through the same action the Save button uses. `clearRevert`
   * is false for the auto-save that follows an Improve, so the Revert
   * affordance survives its own persistence.
   */
  const persist = useCallback(
    async (text: string, { clearRevert }: { clearRevert: boolean }) => {
      setIsSaving(true)
      setSaveError(null)
      const result = await updateCoverLetterContent(coverLetter.id, text)
      setIsSaving(false)
      if (result?.error) {
        setSaveError(result.error)
        toast.error(result.error)
        return false
      }
      setSavedContent(text)
      if (clearRevert) setPreImproveContent(null)
      toast.success("Saved")
      return true
    },
    [coverLetter.id]
  )

  async function handleSave() {
    await persist(content, { clearRevert: true })
  }

  async function handleRevert() {
    const previous = preImproveContent
    if (previous === null) return
    setContent(previous)
    await persist(previous, { clearRevert: true })
  }

  // Tab close / reload guard.
  useEffect(() => {
    if (!isDirty) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isDirty])

  // Client-side navigation guard. App Router gives no route-change event to
  // cancel, so intercept the link click itself (the "← Cover Letters" link on
  // the detail page, the sidebar, anything else) before Next's router sees it.
  useEffect(() => {
    if (!isDirty) return
    function handleClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target as Element | null
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor) return
      // The Download TXT button clicks a synthetic download anchor.
      if (anchor.hasAttribute("download")) return
      if (anchor.target && anchor.target !== "_self") return
      const href = anchor.getAttribute("href") ?? ""
      if (href.startsWith("#")) return
      // The confirm is a dialog now, so it cannot answer synchronously: always
      // cancel the click and re-issue the navigation if the user confirms.
      e.preventDefault()
      e.stopPropagation()
      setPendingHref(href)
    }
    document.addEventListener("click", handleClick, true)
    return () => document.removeEventListener("click", handleClick, true)
  }, [isDirty])

  function handleDownload() {
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "cover-letter.txt"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleImprove(instruction: string) {
    setIsImproving(true)
    try {
      const result = await improveCoverLetter(coverLetter.id, content, instruction)
      if (result.error) {
        toast.error(result.error)
      } else if (result.improved) {
        const previous = content
        const improved = result.improved
        setContent(improved)
        setPreImproveContent(previous)
        // The user asked for a rewrite, not a draft: persist it immediately so
        // navigating away cannot silently discard a ~20 s AI call.
        await persist(improved, { clearRevert: false })
      }
    } finally {
      setIsImproving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="min-w-0">
          <h2 className="font-semibold">
            {application
              ? `${application.companyName} — ${application.jobTitle}`
              : "Cover Letter"}
          </h2>
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>{coverLetter.resume.title}</span>
            {/* Round trip for a letter written for a tracked job — same idiom
                as the resume editor's header. Low-emphasis on the meta line,
                width-capped so a long job title cannot push the action
                cluster off a phone. */}
            {application && (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  href={`/jobs/${application.id}`}
                  className="max-w-[12rem] truncate rounded-sm transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
                >
                  Back to job: {application.jobTitle}
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saveError && (
            <p className="text-sm text-destructive">{saveError}</p>
          )}
          {isDirty && (
            <p className="text-sm text-muted-foreground">Unsaved changes</p>
          )}
          {preImproveContent !== null && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevert}
              disabled={isSaving || isImproving}
            >
              Revert
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            Download TXT
          </Button>
        </div>
      </div>

      {/* Requirements the letter mentions that the resume does not back. Shown
          above the text, not in the sidebar: it has to be read before the user
          treats the draft as finished. */}
      <GroundingNotice
        claimed={coverLetter.suggestions?.grounding?.claimed ?? []}
        namedAsGap={coverLetter.suggestions?.grounding?.namedAsGap ?? []}
        label="letter"
      />

      {/* Editor + AI tools */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <textarea
            aria-label="Cover letter content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full min-h-[400px] lg:min-h-[calc(100dvh-14rem)] rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
          />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-1 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100dvh-6.5rem)]">
          <div className="lg:shrink-0">
            <CoverLetterChat onImprove={handleImprove} isImproving={isImproving} />
          </div>
          {coverLetter.suggestions && (
            <div className="lg:min-h-0 lg:overflow-y-auto">
              <CoverLetterSuggestionsPanel suggestions={coverLetter.suggestions} />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingHref !== null}
        title="Leave without saving?"
        description={UNSAVED_MESSAGE}
        confirmLabel="Leave"
        cancelLabel="Stay"
        destructive
        onCancel={() => setPendingHref(null)}
        onConfirm={() => {
          const href = pendingHref
          setPendingHref(null)
          if (href) router.push(href)
        }}
      />
    </div>
  )
}
