"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Debounced autosave with optimistic status.
 * Call `save` on every keystroke; the hook waits `delay` ms of quiet,
 * then runs `fn` once. Returns idle | dirty | saving | saved | error.
 */
export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error"

export function useAutosave(delay = 800) {
  const [status, setStatus] = useState<AutosaveStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<(() => Promise<{ error?: string } | void>) | null>(null)

  const flush = useCallback(async () => {
    const fn = pending.current
    if (!fn) return
    pending.current = null
    if (timer.current) clearTimeout(timer.current)
    setStatus("saving")
    setError(null)
    try {
      const result = await fn()
      if (result && "error" in result && result.error) {
        setStatus("error")
        setError(result.error)
      } else {
        setStatus("saved")
      }
    } catch (err) {
      setStatus("error")
      setError(err instanceof Error ? err.message : "Save failed")
    }
  }, [])

  const save = useCallback(
    (fn: () => Promise<{ error?: string } | void>) => {
      pending.current = fn
      setStatus("dirty")
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [delay, flush]
  )

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  return { status, error, save, flush }
}

export function autosaveLabel(status: AutosaveStatus): string {
  switch (status) {
    case "idle":
      return "No unsaved changes"
    case "dirty":
      return "Typing… will save"
    case "saving":
      return "Saving…"
    case "saved":
      return "All changes saved"
    case "error":
      return "Save failed — retry"
  }
}
