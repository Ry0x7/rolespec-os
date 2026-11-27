"use client"

import { useEffect, useState } from "react"
import type { WorkflowRunDTO } from "../types"

export type PreparationMode = WorkflowRunDTO["mode"]

const MODES: readonly PreparationMode[] = ["MANUAL", "AGENT_ASSISTED", "AUTONOMOUS"]
function isMode(value: unknown): value is PreparationMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value)
}
const KEY = "rolespec-workflow-mode"
const CHANGE = "rolespec-workflow-mode-change"

/**
 * The product is agent-first: a new preparation runs the assisted pipeline
 * unless the owner explicitly chose the manual checklist. An old stored
 * `MANUAL` value is still honoured, so this changes only the default, not a
 * deliberate preference.
 */
export function useWorkflowMode() {
  const [mode, setMode] = useState<PreparationMode>("AGENT_ASSISTED")
  useEffect(() => {
    const read = (event?: Event) => {
      if (event instanceof CustomEvent && isMode(event.detail)) { setMode(event.detail); return }
      try { const stored = localStorage.getItem(KEY); setMode(isMode(stored) ? stored : "AGENT_ASSISTED") } catch { /* Device storage is optional. */ }
    }
    read()
    window.addEventListener("storage", read)
    window.addEventListener(CHANGE, read)
    return () => { window.removeEventListener("storage", read); window.removeEventListener(CHANGE, read) }
  }, [])
  function changeMode(value: PreparationMode) {
    setMode(value)
    try { localStorage.setItem(KEY, value) } catch { /* The current selection still works without storage. */ }
    window.dispatchEvent(new CustomEvent(CHANGE, { detail: value }))
  }
  return [mode, changeMode] as const
}
