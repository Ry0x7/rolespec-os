"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, ArrowRight, CircleHelp, X } from "lucide-react"
import {
  GUIDED_TOUR_EVENT,
  GUIDED_TOUR_STEPS,
  readGuidedTourStatus,
  writeGuidedTourStatus,
} from "@/shared/lib/guided-tour"

type Phase = "closed" | "prompt" | "tour"
type Placement = "right" | "left" | "above" | "below" | "center"

interface Position {
  top: number
  left: number
  placement: Placement
}

const TOOLTIP_WIDTH = 360
const VIEWPORT_GAP = 16

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function visibleRect(element: HTMLElement): DOMRect | null {
  const style = window.getComputedStyle(element)
  if (style.display === "none" || style.visibility === "hidden") return null
  const rect = element.getBoundingClientRect()
  if (rect.width < 4 || rect.height < 4) return null
  if (rect.bottom < 0 || rect.top > window.innerHeight) return null
  return rect
}

/**
 * The first-run tour. It is mounted once in the header (which every app route
 * shares), so no layout changes are needed. The prompt is opt-in; Help always
 * replays it. The overlay spotlights the real sidebar item and the card sits
 * beside it, with a centred fallback when the sidebar is hidden on mobile.
 */
export function GuidedTour() {
  const [phase, setPhase] = useState<Phase>("closed")
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [position, setPosition] = useState<Position>({
    top: VIEWPORT_GAP,
    left: VIEWPORT_GAP,
    placement: "center",
  })
  const tooltipRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  const step = GUIDED_TOUR_STEPS[index] ?? GUIDED_TOUR_STEPS[0]
  const isLast = index === GUIDED_TOUR_STEPS.length - 1

  const close = useCallback((status: "done" | "skipped") => {
    writeGuidedTourStatus(status)
    setPhase("closed")
    setRect(null)
    const target = previousFocus.current
    previousFocus.current = null
    if (target?.isConnected) target.focus()
  }, [])

  const start = useCallback(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setIndex(0)
    setRect(null)
    setPhase("tour")
  }, [])

  const next = useCallback(() => {
    if (isLast) {
      close("done")
      return
    }
    setIndex((current) => Math.min(current + 1, GUIDED_TOUR_STEPS.length - 1))
  }, [close, isLast])

  const back = useCallback(() => {
    setIndex((current) => Math.max(current - 1, 0))
  }, [])

  // Wait for hydration, then offer the tour once for this browser. A stored
  // "done" or "skipped" value means the user has already answered.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Never interrupt a tour the user started from Help while the prompt timer
      // was still pending.
      setPhase((current) =>
        current === "closed" && readGuidedTourStatus() === null ? "prompt" : current
      )
    }, 900)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    function onStart() {
      start()
    }
    window.addEventListener(GUIDED_TOUR_EVENT, onStart)
    return () => window.removeEventListener(GUIDED_TOUR_EVENT, onStart)
  }, [start])

  // Locate and measure the current target. Missing and hidden targets fall back
  // to a centred card, which is also the mobile experience.
  useEffect(() => {
    if (phase !== "tour") return
    function update() {
      if (!step.target) {
        setRect(null)
        return
      }
      const element = document.querySelector<HTMLElement>(step.target)
      setRect(element ? visibleRect(element) : null)
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [phase, step.target])

  // Keep the tooltip inside the viewport. Measuring after render means a long
  // step body can never push the Next button off-screen.
  useLayoutEffect(() => {
    if (phase !== "tour") return
    const tooltip = tooltipRef.current
    if (!tooltip) return

    const width = Math.min(tooltip.offsetWidth || TOOLTIP_WIDTH, window.innerWidth - VIEWPORT_GAP * 2)
    const height = tooltip.offsetHeight
    if (!rect) {
      setPosition({
        left: Math.max(VIEWPORT_GAP, (window.innerWidth - width) / 2),
        top: Math.max(VIEWPORT_GAP, (window.innerHeight - height) / 2),
        placement: "center",
      })
      return
    }

    const gap = 14
    const spaceRight = window.innerWidth - rect.right - gap
    const spaceLeft = rect.left - gap
    const spaceBelow = window.innerHeight - rect.bottom - gap
    const spaceAbove = rect.top - gap

    let placement: Placement
    let left: number
    let top: number

    if (spaceRight >= width) {
      placement = "right"
      left = rect.right + gap
      top = rect.top + rect.height / 2 - height / 2
    } else if (spaceLeft >= width) {
      placement = "left"
      left = rect.left - gap - width
      top = rect.top + rect.height / 2 - height / 2
    } else if (spaceBelow >= height || spaceBelow >= spaceAbove) {
      placement = "below"
      left = rect.left + rect.width / 2 - width / 2
      top = rect.bottom + gap
    } else {
      placement = "above"
      left = rect.left + rect.width / 2 - width / 2
      top = rect.top - gap - height
    }

    setPosition({
      left: clamp(left, VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP),
      top: clamp(top, VIEWPORT_GAP, window.innerHeight - height - VIEWPORT_GAP),
      placement,
    })
  }, [phase, rect, index])

  // Move focus into the card on every step, and restore it on close.
  useEffect(() => {
    if (phase !== "tour") return
    const frame = window.requestAnimationFrame(() => tooltipRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [phase, index])

  useEffect(() => {
    if (phase === "closed") return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        close("skipped")
        return
      }
      if (phase !== "tour") return

      if (event.key === "ArrowRight") {
        event.preventDefault()
        next()
        return
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        back()
        return
      }
      if (event.key !== "Tab") return

      const card = tooltipRef.current
      if (!card) return
      const focusables = Array.from(
        card.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusables.length === 0) {
        event.preventDefault()
        card.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && card.contains(active)
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [phase, close, next, back])

  if (typeof document === "undefined") return null

  const prompt = (
    <div
      role="dialog"
      aria-labelledby="tour-prompt-title"
      aria-describedby="tour-prompt-body"
      className="fixed bottom-4 right-4 z-[80] w-[min(23rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600/15 text-brand-400">
          <CircleHelp className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="tour-prompt-title" className="text-sm font-semibold">
            Want a 60-second tour?
          </h2>
          <p id="tour-prompt-body" className="mt-1 text-xs leading-5 text-muted-foreground">
            I will point out where your career info, jobs, agent runs and settings live.
          </p>
        </div>
        <button
          type="button"
          onClick={() => close("skipped")}
          aria-label="Dismiss the tour"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => close("skipped")}
          className="inline-flex min-h-9 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={start}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          Show me around
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )

  const tour = (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close the tour"
        onClick={() => close("skipped")}
        className="fixed inset-0 z-[70] cursor-default bg-transparent"
      />
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[71] rounded-xl border-2 border-brand-400"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.62)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[70] bg-black/65" />
      )}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-title"
        aria-describedby="guided-tour-body"
        tabIndex={-1}
        className="fixed z-[72] rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          top: position.top,
          left: position.left,
          width: `min(${TOOLTIP_WIDTH}px, calc(100vw - 2rem))`,
        }}
      >
        {position.placement !== "center" ? (
          <span
            aria-hidden="true"
            className={
              "absolute h-3 w-3 rotate-45 border-border bg-card " +
              (position.placement === "right"
                ? "-left-1.5 top-1/2 -translate-y-1/2 border-b border-l"
                : position.placement === "left"
                  ? "-right-1.5 top-1/2 -translate-y-1/2 border-r border-t"
                  : position.placement === "below"
                    ? "-top-1.5 left-1/2 -translate-x-1/2 border-l border-t"
                    : "-bottom-1.5 left-1/2 -translate-x-1/2 border-b border-r")
            }
          />
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Step {index + 1} of {GUIDED_TOUR_STEPS.length}
          </p>
          <button
            type="button"
            onClick={() => close("skipped")}
            aria-label="Close the tour"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <h2 id="guided-tour-title" className="mt-2 text-base font-semibold">
          {step.title}
        </h2>
        <p id="guided-tour-body" className="mt-1.5 text-sm leading-6 text-muted-foreground">
          {step.body}
        </p>
        {!rect && index < GUIDED_TOUR_STEPS.length - 1 ? (
          <p className="mt-2 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            On a phone, open the menu to find this section.
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={back}
            disabled={index === 0}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => close("done")}
              className="inline-flex min-h-9 items-center rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={next}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              {isLast ? "Finish" : "Next"}
              {isLast ? null : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </>
  )

  return (
    <>
      {phase === "prompt" ? createPortal(prompt, document.body) : null}
      {phase === "tour" ? createPortal(tour, document.body) : null}
    </>
  )
}
