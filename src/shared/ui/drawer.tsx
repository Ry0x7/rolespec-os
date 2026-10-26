"use client"

import {
  memo,
  useRef,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { X } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import {
  subscribeToNothing,
  useModalKeydownTrap,
  useModalScrollLockAndFocus,
} from "./modal-internals"

/**
 * Tailwind's scanner only picks up classes that appear as literal strings in
 * source — `lg:${width}` would never match. This maps the common `max-w-*`
 * scale to its pre-written `lg:` form so both halves are literal here, with
 * an unprefixed fallback (unstyled at `lg`, but never a build error) for
 * anything outside the map.
 */
const WIDTH_LG_CLASS: Record<string, string> = {
  "max-w-xs": "lg:max-w-xs",
  "max-w-sm": "lg:max-w-sm",
  "max-w-md": "lg:max-w-md",
  "max-w-lg": "lg:max-w-lg",
  "max-w-xl": "lg:max-w-xl",
  "max-w-2xl": "lg:max-w-2xl",
  "max-w-3xl": "lg:max-w-3xl",
}

export interface DrawerProps {
  open: boolean
  /**
   * Called for Escape, backdrop click and the X button. Callers own any guard
   * (e.g. an in-flight save) so the drawer stays dumb.
   */
  onClose: () => void
  children: ReactNode
  /** Tailwind max-width class for the desktop panel. Ignored below `lg`, where it is full-width. */
  width?: string
  /**
   * Below `lg` the sheet grows to 94dvh instead of capping at 85dvh — for
   * content that wants to FILL the sheet (a live document preview measuring
   * its own scroll container) rather than size to whatever it contains.
   * Unused at `lg` and up, where the panel is already `h-full`.
   */
  fullHeight?: boolean
  /** Extra classes on the panel. */
  className?: string
  /** Set false for a drawer whose only exit must go through its own buttons. */
  showCloseButton?: boolean
  "aria-label"?: string
  "aria-labelledby"?: string
}

/**
 * Controlled modal shell, portalled to `document.body`. Renders nothing when
 * closed (and nothing before mount, so SSR and hydration agree) — same
 * contract as `Dialog`.
 *
 * Placement is responsive by Tailwind class only (no JS media query, so no
 * hydration mismatch): a bottom sheet below `lg`, a right-side panel at `lg`
 * and up. A single `x`/`y` framer transform cannot switch axis with a media
 * query, so both breakpoints share one plain opacity+scale entrance instead
 * of a slide — a correct fade beats a broken slide.
 *
 * Use `DrawerHeader` / `DrawerBody` / `DrawerFooter` when content can outgrow
 * the panel, so only the body scrolls and the header/footer stay put.
 */
export const Drawer = memo(function Drawer({
  open,
  onClose,
  children,
  width = "max-w-md",
  fullHeight = false,
  className,
  showCloseButton = true,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  // False during SSR and the first client render, true afterwards — the portal
  // target only exists in the browser.
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false)
  const reduceMotion = useReducedMotion()

  useModalKeydownTrap(open, onClose, panelRef)
  useModalScrollLockAndFocus(open, mounted, panelRef)

  if (!mounted) return null

  const duration = reduceMotion ? 0 : 0.2

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[var(--z-overlay)] flex items-end justify-center lg:items-stretch lg:justify-end">
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration }}
            className="absolute inset-0 bg-black/70"
            onClick={onClose}
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration }}
            className={cn(
              // Bottom sheet below `lg`: full width, anchored bottom, rounded
              // top corners, capped at 85dvh. Right panel at `lg` and up: full
              // height, anchored right, rounded left corners.
              "relative z-10 flex w-full flex-col overflow-y-auto rounded-t-lg border-t border-border bg-card p-4 text-card-foreground shadow-2xl focus:outline-none sm:p-6",
              fullHeight ? "h-[94dvh] max-h-[94dvh]" : "max-h-[85dvh]",
              "lg:h-full lg:max-h-full lg:rounded-t-none lg:rounded-l-lg lg:border-t-0 lg:border-l",
              WIDTH_LG_CLASS[width] ?? width,
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
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
})

/**
 * The slots below cancel the panel's own padding on the axes they own, so a
 * `DrawerBody` scrollbar and a `DrawerFooter` border reach the panel edge
 * while slot-less consumers keep the plain padded box. Mirrors Dialog's slots.
 */
const GUTTER = "-mx-4 px-4 sm:-mx-6 sm:px-6"

export function DrawerHeader({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
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
export function DrawerBody({
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

export function DrawerFooter({
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
