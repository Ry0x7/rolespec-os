"use client"

import { useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react"
import { cn } from "@/shared/lib/utils"

// Mirrors MAX_BULLET_LENGTH in ../../services/enhance-ats.ts (the AI/ATS pipeline
// cap). Duplicated rather than imported: that module is server-side (it pulls in
// the AI generation layer, which pulls in prisma), so importing it here would
// drag server code into a client bundle. Keep the two in sync.
const BULLET_SOFT_CAP = 220

// Counter stays hidden until the bullet is long enough to be worth watching.
const COUNTER_VISIBLE_FROM = 180

interface Props {
  value: string
  onChange: (value: string) => void
  /** Enter is an "add a bullet below and focus it" gesture, never a newline. */
  onEnter?: () => void
  /** Backspace in an already-empty bullet removes it. */
  onRemoveEmpty?: () => void
  placeholder?: string
  className?: string
  /** Lets the owning editor keep a handle on the field for focus management. */
  registerRef?: (el: HTMLTextAreaElement | null) => void
}

export function BulletTextarea({
  value,
  onChange,
  onEnter,
  onRemoveEmpty,
  placeholder,
  className,
  registerRef,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Runs on mount and on every value change, so externally driven rewrites
  // (AI enhance apply, reorder) resize the field too, not just typing.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      onEnter?.()
      return
    }
    if (e.key === "Backspace" && value.length === 0 && onRemoveEmpty) {
      e.preventDefault()
      onRemoveEmpty()
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = e.clipboardData.getData("text")
    if (!/[\r\n]/.test(pasted)) return
    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    const cleaned = pasted.replace(/\s*[\r\n]+\s*/g, " ")
    onChange(value.slice(0, start) + cleaned + value.slice(end))
  }

  const charCount = value.length
  const showCounter = charCount > COUNTER_VISIBLE_FROM
  const overCap = charCount > BULLET_SOFT_CAP

  return (
    <div className={cn("flex-1 space-y-1", className)}>
      <textarea
        ref={(el) => {
          ref.current = el
          registerRef?.(el)
        }}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
        className={cn(
          "block w-full resize-none overflow-hidden rounded-md border border-border bg-muted px-3 py-2 text-base text-foreground shadow-sm transition-colors sm:text-sm",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      />
      {showCounter && (
        <p
          className={cn(
            "text-right text-[11px]",
            overCap ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
          )}
        >
          {charCount}/{BULLET_SOFT_CAP}
        </p>
      )}
    </div>
  )
}
