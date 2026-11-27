/**
 * The occasional "support RoleSpec" prompt.
 *
 * RoleSpec has no telemetry, so the prompt decides from a small record kept in
 * this browser only: which days the workspace was opened and what the owner
 * answered last time. It never appears on a first visit, never more than once
 * a month, and never again after "Don't show again".
 */

export const SUPPORT_URL = "https://ko-fi.com/ry0x7"

export const SUPPORT_PROMPT_STORAGE_KEY = "rolespec-support-prompt"

/** Distinct days the workspace must have been opened before the first ask. */
export const SUPPORT_PROMPT_MIN_DAYS = 3

/** "Maybe later" waits this long before asking again. */
export const SUPPORT_PROMPT_SNOOZE_DAYS = 30

/** Someone who already opened the support page is asked far less often. */
export const SUPPORT_PROMPT_THANKED_DAYS = 180

const DAY_MS = 86_400_000

export interface SupportPromptState {
  /** Local calendar days (YYYY-MM-DD) the workspace was opened, newest last. */
  days: string[]
  /** ISO time before which the prompt stays hidden. */
  snoozedUntil: string | null
  /** "Don't show again". */
  never: boolean
}

export const EMPTY_SUPPORT_PROMPT_STATE: SupportPromptState = { days: [], snoozedUntil: null, never: false }

export function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

/** Tolerates anything a user or an older build left in storage. */
export function parseSupportPromptState(raw: string | null): SupportPromptState {
  if (!raw) return EMPTY_SUPPORT_PROMPT_STATE
  try {
    const value = JSON.parse(raw) as Partial<SupportPromptState>
    return {
      days: Array.isArray(value.days) ? value.days.filter((day): day is string => typeof day === "string").slice(-SUPPORT_PROMPT_MIN_DAYS) : [],
      snoozedUntil: typeof value.snoozedUntil === "string" ? value.snoozedUntil : null,
      never: value.never === true,
    }
  } catch {
    return EMPTY_SUPPORT_PROMPT_STATE
  }
}

/** Records today's visit; only the last few days are kept. */
export function recordVisit(state: SupportPromptState, now: Date): SupportPromptState {
  const today = localDay(now)
  if (state.days.includes(today)) return state
  return { ...state, days: [...state.days, today].slice(-SUPPORT_PROMPT_MIN_DAYS) }
}

export function shouldShowSupportPrompt(state: SupportPromptState, now: Date): boolean {
  if (state.never) return false
  if (state.days.length < SUPPORT_PROMPT_MIN_DAYS) return false
  if (state.snoozedUntil && new Date(state.snoozedUntil).getTime() > now.getTime()) return false
  return true
}

export type SupportPromptAnswer = "SUPPORTED" | "LATER" | "NEVER"

export function answerSupportPrompt(state: SupportPromptState, answer: SupportPromptAnswer, now: Date): SupportPromptState {
  if (answer === "NEVER") return { ...state, never: true }
  const days = answer === "SUPPORTED" ? SUPPORT_PROMPT_THANKED_DAYS : SUPPORT_PROMPT_SNOOZE_DAYS
  return { ...state, snoozedUntil: new Date(now.getTime() + days * DAY_MS).toISOString() }
}
