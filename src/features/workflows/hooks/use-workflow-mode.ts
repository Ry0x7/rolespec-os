"use client"

import { useEffect, useState } from "react"
import type { WorkflowRunDTO } from "../types"

export type PreparationMode = WorkflowRunDTO["mode"]
const KEY = "rolespec-workflow-mode"
const CHANGE = "rolespec-workflow-mode-change"

export function useWorkflowMode() {
  const [mode, setMode] = useState<PreparationMode>("MANUAL")
  useEffect(() => {
    const read = (event?: Event) => {
      if (event instanceof CustomEvent && (event.detail === "MANUAL" || event.detail === "AGENT_ASSISTED")) { setMode(event.detail); return }
      try { setMode(localStorage.getItem(KEY) === "AGENT_ASSISTED" ? "AGENT_ASSISTED" : "MANUAL") } catch { /* Device storage is optional. */ }
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
