"use client"

import {
  useRef,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import {
  subscribeToNothing,
  useModalKeydownTrap,
  useModalScrollLockAndFocus,
} from "./modal-internals"

export interface DialogProps {
  open: boolean
  /**
   * Called for Escape, backdrop click and the X button. Callers own any guard
   * (e.g. an in-flight delete) so the dialog stays dumb.
   */
  onClose: () => void
  children: ReactNode
  /** Tailwind max-width class for the panel. */
  maxWidth?: string
  /** Extra classes on the panel. */
  className?: string
  /** Set false for a dialog whose only exit must go through its own buttons. */
  showCloseButton?: boolean
  "aria-label"?: string
  "aria-labelledby"?: string
}

/**
 * Controlled modal shell, portalled to `document.body`. Renders nothing when
 * closed (and nothing before mount, so SSR and hydration agree).
 *
 * The panel is a flex column capped at 85dvh. Children dumped straight in still
 * work; use `DialogHeader` / `DialogBody` / `DialogFooter` when the content can
 * outgrow the viewport, so only the body scrolls and the footer stays put.
 */
export function Dialog({
  open,
  onClose,
  children,
  maxWidth = "max-w-lg",
  className,
  showCloseButton = true,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // False during SSR and the first client render, true afterwards — the portal
  // target only exists in the browser.
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false)

  useModalKeydownTrap(open, onClose, panelRef)
  useModalScrollLockAndFocus(open, mounted, panelRef)

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
        className={cn(
          // Opaque surface: every dialog reads the same regardless of what sits
          // behind it (the ATS view sits over a white resume preview).
          // `overflow-y-auto` is the fallback for consumers that dump children
          // straight in: they scroll as a whole, as they always did. Consumers
          // using DialogBody never reach it — the body absorbs the overflow.
          "relative z-10 flex w-full max-h-[85dvh] flex-col overflow-y-auto rounded-lg border border-border bg-card p-4 text-card-foreground shadow-2xl focus:outline-none sm:p-6",
          maxWidth,
          className
        )}
      >
        {children}
        {showCloseButton ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

/**
 * The slots below cancel the panel's own padding on the axes they own, so a
 * `DialogBody` scrollbar and a `DialogFooter` border reach the panel edge while
 * slot-less consumers keep the plain padded box.
 */
const GUTTER = "-mx-4 px-4 sm:-mx-6 sm:px-6"

export function DialogHeader({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // The rule keeps scrolled body content from bleeding into the title.
        "shrink-0 space-y-1 border-b border-border pb-3 pr-8",
        GUTTER,
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/** The only scrolling region. `min-h-0` is what lets it shrink inside the flex column. */
export function DialogBody({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto py-4", GUTTER, className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function DialogFooter({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4 -mb-4 pb-4 sm:-mb-6 sm:pb-6",
        GUTTER,
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
