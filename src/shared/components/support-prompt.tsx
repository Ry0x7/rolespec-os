"use client"

import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Heart, X } from "lucide-react"

import { readGuidedTourStatus } from "@/shared/lib/guided-tour"
import {
  SUPPORT_PROMPT_STORAGE_KEY,
  SUPPORT_URL,
  answerSupportPrompt,
  parseSupportPromptState,
  recordVisit,
  shouldShowSupportPrompt,
  type SupportPromptAnswer,
  type SupportPromptState,
} from "@/shared/lib/support-prompt"

/** Lets the first screen of the day settle before anything slides in. */
const SHOW_DELAY_MS = 8_000

function readState(): SupportPromptState {
  try {
    return parseSupportPromptState(window.localStorage.getItem(SUPPORT_PROMPT_STORAGE_KEY))
  } catch {
    return parseSupportPromptState(null)
  }
}

function writeState(state: SupportPromptState) {
  try {
    window.localStorage.setItem(SUPPORT_PROMPT_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Blocked storage only means the prompt may ask again; nothing breaks.
  }
}

/**
 * A small, dismissible card asking for support on Ko-fi. It waits until the
 * workspace has been used on a few different days, stays out of the way of the
 * first-run tour, and respects "Maybe later" and "Don't show again".
 */
export function SupportPrompt() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const now = new Date()
    const state = recordVisit(readState(), now)
    writeState(state)
    // The tour card sits in the same corner; never stack the two.
    if (readGuidedTourStatus() === null || !shouldShowSupportPrompt(state, now)) return
    const timer = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const answer = useCallback((choice: SupportPromptAnswer) => {
    writeState(answerSupportPrompt(readState(), choice, new Date()))
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") answer("LATER")
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, answer])

  if (!open) return null

  return createPortal(
    <div
      role="dialog"
      aria-labelledby="support-prompt-title"
      aria-describedby="support-prompt-body"
      className="fixed bottom-4 right-4 z-[80] w-[min(23rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600/15 text-brand-400">
          <Heart className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="support-prompt-title" className="text-sm font-semibold">
            Enjoying RoleSpec?
          </h2>
          <p id="support-prompt-body" className="mt-1 text-xs leading-5 text-muted-foreground">
            It is free, private and built by one person. If it has helped your search, a coffee on
            Ko-fi keeps it going. Everything keeps working either way.
          </p>
        </div>
        <button
          type="button"
          onClick={() => answer("LATER")}
          aria-label="Close"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => answer("LATER")}
          className="inline-flex min-h-9 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Maybe later
        </button>
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => answer("SUPPORTED")}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-brand-700 px-3 text-sm font-medium text-white hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <Heart className="h-4 w-4" aria-hidden="true" />
          Support on Ko-fi
        </a>
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => answer("NEVER")}
          className="inline-flex min-h-8 items-center rounded-md px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Don&apos;t show again
        </button>
      </div>
    </div>,
    document.body
  )
}
