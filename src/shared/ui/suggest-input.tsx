"use client"

import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react"
import { cn } from "@/shared/lib/utils"

interface SuggestInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Static suggestion values; typing filters them, free text stays allowed. */
  suggestions: readonly string[]
  /**
   * Opt in to comma-separated list behaviour. Off by default because a single
   * value can legitimately contain a comma (e.g. "Nurse, RN").
   */
  multiple?: boolean
}

/**
 * The part of the value the user is currently typing. Some of these inputs take
 * a comma-separated list (the bulk skills fields), where only the text after the
 * last comma is the term being completed.
 */
function lastSegment(value: string): string {
  const at = value.lastIndexOf(",")
  return at === -1 ? value : value.slice(at + 1)
}

/**
 * Puts a picked suggestion into the value. A comma-less value is replaced
 * outright, as before; in a list only the final segment is replaced, so picking
 * "TypeScript" while "React, Type" is typed yields "React, TypeScript" instead
 * of throwing the earlier entries away.
 */
function applySelection(current: string, picked: string): string {
  const at = current.lastIndexOf(",")
  if (at === -1) return picked
  return `${current.slice(0, at + 1)} ${picked}`
}

/**
 * A text input with a styled suggestion dropdown. Replaces native
 * `<datalist>`, whose popup cannot be styled or positioned and renders as a
 * viewport-sized panel in Chromium once the list grows.
 *
 * The input itself stays uncontrolled so plain FormData submission and
 * `form.reset()` keep working; internal state only mirrors the value to
 * filter the list.
 */
export function SuggestInput({
  suggestions,
  multiple = false,
  className,
  onInput,
  onKeyDown,
  onFocus,
  onBlur,
  ...props
}: SuggestInputProps) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  // Refocusing after a pick fires a focus event; it must not reopen the list.
  const skipNextFocusOpen = useRef(false)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)

  // form.reset() clears the uncontrolled input; mirror that here.
  useEffect(() => {
    const form = inputRef.current?.form
    if (!form) return
    function handleReset() {
      setQuery("")
      setOpen(false)
      setHighlighted(-1)
    }
    form.addEventListener("reset", handleReset)
    return () => form.removeEventListener("reset", handleReset)
  }, [])

  const trimmed = (multiple ? lastSegment(query) : query).trim().toLowerCase()
  const filtered = trimmed
    ? suggestions.filter((suggestion) =>
        suggestion.toLowerCase().includes(trimmed)
      )
    : [...suggestions]
  const expanded = open && filtered.length > 0

  function select(value: string) {
    const input = inputRef.current
    // Read the element, not `query`: an uncontrolled input can hold a
    // `defaultValue` the mirror never saw.
    const current = input ? input.value : query
    const next = multiple ? applySelection(current, value) : value
    if (input) input.value = next
    setQuery(next)
    setOpen(false)
    setHighlighted(-1)
    skipNextFocusOpen.current = true
    inputRef.current?.focus()
    skipNextFocusOpen.current = false
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (!expanded) {
        setOpen(true)
        setHighlighted(0)
      } else {
        setHighlighted((index) => (index + 1) % filtered.length)
      }
    } else if (event.key === "ArrowUp" && expanded) {
      event.preventDefault()
      setHighlighted((index) =>
        index <= 0 ? filtered.length - 1 : index - 1
      )
    } else if (event.key === "Enter" && expanded && highlighted >= 0) {
      // Only intercept submission while a suggestion is highlighted.
      event.preventDefault()
      select(filtered[highlighted])
    } else if (event.key === "Escape" && expanded) {
      setOpen(false)
      setHighlighted(-1)
    }
    onKeyDown?.(event)
  }

  return (
    <div className="relative">
      <input
        {...props}
        ref={inputRef}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          expanded && highlighted >= 0 ? `${listId}-${highlighted}` : undefined
        }
        autoComplete="off"
        className={cn(
          "flex h-10 w-full rounded-md border border-border bg-muted px-3 py-1 text-base text-foreground shadow-sm transition-colors sm:h-9 sm:text-sm",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        onInput={(event) => {
          setQuery(event.currentTarget.value)
          setOpen(true)
          setHighlighted(-1)
          onInput?.(event)
        }}
        onFocus={(event) => {
          if (!skipNextFocusOpen.current) setOpen(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setOpen(false)
          setHighlighted(-1)
          onBlur?.(event)
        }}
        onKeyDown={handleKeyDown}
      />
      {expanded && (
      <ul
        id={listId}
        role="listbox"
        className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-lg"
      >
        {filtered.map((suggestion, index) => (
          <li
            key={suggestion}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === highlighted}
            className={cn(
              "cursor-pointer px-3 py-1.5 text-sm",
              index === highlighted
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            // mousedown so selection lands before the input's blur closes the list
            onMouseDown={(event) => {
              event.preventDefault()
              select(suggestion)
            }}
            onMouseEnter={() => setHighlighted(index)}
          >
            {suggestion}
          </li>
        ))}
      </ul>
      )}
    </div>
  )
}
