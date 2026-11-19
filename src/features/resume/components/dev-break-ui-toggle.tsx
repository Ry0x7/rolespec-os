"use client"

import { useState, useSyncExternalStore } from "react"
import { type BreakUiFixtureMode } from "../dev/break-ui-fixtures"

const MODES: { value: BreakUiFixtureMode; label: string }[] = [
  { value: "demo", label: "Demo" },
  { value: "worst", label: "Worst" },
  { value: "empty", label: "Empty (0)" },
  { value: "one", label: "One (1)" },
  { value: "huge", label: "Max (12+)" },
]

function subscribeToNothing(): () => void {
  return () => {}
}

function readBreakUiParam(): string | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") {
    return null
  }
  return new URLSearchParams(window.location.search).get("breakui")
}

function parseBreakUiMode(raw: string | null): BreakUiFixtureMode {
  if (
    raw === "worst" ||
    raw === "empty" ||
    raw === "one" ||
    raw === "huge" ||
    raw === "demo"
  ) {
    return raw
  }
  if (raw === "1" || raw === "true") {
    return "worst"
  }
  return "demo"
}

/**
 * Dev-only `break-ui` fixture switcher.
 *
 * Activates only when `process.env.NODE_ENV !== "production"` AND the URL has
 * `?breakui=1` (or `?breakui=<mode>`). This keeps unit tests and normal dev
 * sessions untouched while giving browser stress tests an instant one-click
 * toggle across `demo`, `worst`, `empty`, `one`, and `huge`.
 */
export function useDevBreakUiMode(): [
  BreakUiFixtureMode,
  (mode: BreakUiFixtureMode) => void,
  boolean,
] {
  const rawParam = useSyncExternalStore(
    subscribeToNothing,
    readBreakUiParam,
    () => null
  )
  const [overrideMode, setOverrideMode] = useState<BreakUiFixtureMode | null>(
    null
  )
  const enabled = Boolean(rawParam)
  const mode = overrideMode ?? parseBreakUiMode(rawParam)

  return [mode, setOverrideMode, enabled]
}

export function DevBreakUiToggle({
  mode,
  onChange,
  enabled,
}: {
  mode: BreakUiFixtureMode
  onChange: (mode: BreakUiFixtureMode) => void
  enabled: boolean
}) {
  if (process.env.NODE_ENV === "production" || !enabled) return null

  return (
    <div
      data-break-ui-toggle
      role="region"
      aria-label="Break-UI fixture switcher"
      className="fixed bottom-3 right-3 z-50 flex flex-wrap items-center gap-1 rounded-full border border-amber-500/50 bg-background/95 px-2.5 py-1 text-[11px] shadow-lg backdrop-blur"
    >
      <span className="px-1 font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
        break-ui
      </span>
      {MODES.map((option) => (
        <button
          key={option.value}
          type="button"
          data-break-ui-mode={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={mode === option.value}
          className={`rounded-full px-2 py-0.5 font-medium transition-colors ${
            mode === option.value
              ? "bg-amber-500 text-black"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
