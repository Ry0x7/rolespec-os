import React from "react"

import { ExpandIcon } from "./icons"

export interface MockGalleryItem {
  title: string
  caption: string
  render: () => React.ReactNode
}

/**
 * A live product mock in a device frame. Hovering lifts the frame toward the
 * reader; clicking Expand opens the same HTML at full size, so nothing is ever
 * a downscaled screenshot.
 */
export function MockStage({
  item,
  onExpand,
}: {
  item: MockGalleryItem
  onExpand: () => void
}) {
  return (
    <div className="mock-stage">
      <div className="mock-stage-bezel">{item.render()}</div>
      <button
        type="button"
        className="mock-stage-expand"
        onClick={onExpand}
        aria-label={`Expand ${item.title} preview`}
      >
        <ExpandIcon />
        Expand
      </button>
    </div>
  )
}

function stepDialogFocus(dialog: HTMLDialogElement) {
  const focusable = dialog.querySelector<HTMLElement>(
    "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
  )
  focusable?.focus()
}

/**
 * Native <dialog> keeps the enlarged mock in the top layer, traps focus and
 * closes on Escape. The mock is real HTML, so it stays sharp at any size.
 */
export function MockDialog({
  open,
  items,
  index,
  onIndexChange,
  onClose,
}: {
  open: boolean
  items: MockGalleryItem[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const previouslyFocused = React.useRef<HTMLElement | null>(null)
  const titleId = React.useId()
  const count = items.length
  const current = items[index] ?? items[0]

  React.useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    if (!dialog.open) dialog.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    if (dialog.open) stepDialogFocus(dialog)
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0)

    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      if (dialog.open) dialog.close()
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  if (count === 0 || !current) return null

  function step(direction: number) {
    if (count < 2) return
    onIndexChange((index + direction + count) % count)
  }

  function close() {
    dialogRef.current?.close()
    onClose()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault()
      step(1)
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      step(-1)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="mock-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      {open && (
        <div className="mock-dialog-inner">
          <div className="mock-dialog-head">
            <div className="mock-dialog-heading">
              <p>RoleSpec OS · Live preview</p>
              <h2 id={titleId}>{current.title}</h2>
            </div>
            <div className="mock-dialog-actions">
              {count > 1 && (
                <span className="mock-dialog-count" aria-live="polite">
                  {index + 1} / {count}
                </span>
              )}
              <button
                ref={closeRef}
                type="button"
                className="mock-dialog-close"
                onClick={close}
                aria-label="Close preview"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div className="mock-dialog-media">
            <div className="mock-dialog-stage">{current.render()}</div>
          </div>

          <div className="mock-dialog-foot">
            <p>{current.caption}</p>
            {count > 1 && (
              <div className="mock-dialog-nav">
                <span className="mock-dialog-tip">Use ← → to browse · Esc to close</span>
                <button type="button" onClick={() => step(-1)} aria-label="Previous preview">
                  ← Previous
                </button>
                <button type="button" onClick={() => step(1)} aria-label="Next preview">
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </dialog>
  )
}
