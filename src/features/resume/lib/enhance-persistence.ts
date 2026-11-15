import type { KeywordEvidence } from "@/shared/lib/evidence-grounding"
import type { EnhanceSuggestion } from "../hooks/use-resume-store"

/**
 * Enhance suggestions (and the originals Revert needs) live only in the client
 * store, so they are mirrored to localStorage per resume to survive a reload.
 * Bump the version whenever the stored shape changes; older payloads are
 * dropped rather than migrated.
 */
export const ENHANCE_STATE_VERSION = 1

export function enhanceStateKey(resumeId: string): string {
  return `rolespec:enhance:${resumeId}`
}

export interface PersistedEnhanceState {
  suggestions: EnhanceSuggestion[]
  grounding: KeywordEvidence[]
  focus: { sectionId: string } | null
}

const FIELDS = ["summary", "bullet", "skills"]
const VERDICTS = ["supported", "ambiguous", "unsupported"]

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isSuggestion(raw: unknown): raw is EnhanceSuggestion {
  if (!raw || typeof raw !== "object") return false
  const s = raw as Record<string, unknown>
  return (
    isString(s.id) &&
    isString(s.sectionId) &&
    isString(s.itemId) &&
    isString(s.original) &&
    isString(s.reason) &&
    FIELDS.includes(s.field as string) &&
    (s.status === "pending" || s.status === "applied") &&
    (s.action === "rewrite" || s.action === "remove") &&
    (s.suggested === undefined || isString(s.suggested)) &&
    (s.bulletIndex === undefined || typeof s.bulletIndex === "number")
  )
}

function isEvidence(raw: unknown): raw is KeywordEvidence {
  if (!raw || typeof raw !== "object") return false
  const e = raw as Record<string, unknown>
  return isString(e.keyword) && isString(e.reason) && VERDICTS.includes(e.verdict as string)
}

/**
 * Narrows unknown (localStorage) input to a persisted Enhance state. Malformed
 * rows are dropped; no valid row at all reads as nothing stored.
 */
export function parseEnhanceState(raw: unknown): PersistedEnhanceState | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  if (value.v !== ENHANCE_STATE_VERSION || !Array.isArray(value.suggestions)) return null

  const suggestions = value.suggestions.filter(isSuggestion)
  if (suggestions.length === 0) return null

  const grounding = Array.isArray(value.grounding) ? value.grounding.filter(isEvidence) : []
  const focusRaw = value.focus as Record<string, unknown> | null | undefined
  const focus =
    focusRaw && typeof focusRaw === "object" && isString(focusRaw.sectionId)
      ? { sectionId: focusRaw.sectionId }
      : null

  return { suggestions, grounding, focus }
}

export function loadEnhanceState(resumeId: string): PersistedEnhanceState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(enhanceStateKey(resumeId))
    if (!raw) return null
    return parseEnhanceState(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveEnhanceState(resumeId: string, state: PersistedEnhanceState): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      enhanceStateKey(resumeId),
      JSON.stringify({
        v: ENHANCE_STATE_VERSION,
        savedAt: new Date().toISOString(),
        suggestions: state.suggestions,
        grounding: state.grounding,
        focus: state.focus,
      })
    )
  } catch {
    // Storage can be full or blocked (private mode); suggestions stay in memory.
  }
}

export function clearEnhanceState(resumeId: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(enhanceStateKey(resumeId))
  } catch {
    // Blocked storage: nothing to clear.
  }
}
