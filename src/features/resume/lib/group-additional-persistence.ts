/**
 * Per-resume preference for folding Skills and Certifications into one block.
 * It is presentation state, like the design customization, so it lives in
 * localStorage rather than the database: the resume content is unchanged and
 * the PDF export reads the same values.
 */
export interface GroupAdditionalPreference {
  enabled: boolean
  title: string
}

export const DEFAULT_GROUP_ADDITIONAL: GroupAdditionalPreference = {
  enabled: false,
  title: "Skills & Certifications",
}

const STORAGE_PREFIX = "resume-group-additional:"
const MAX_TITLE_LENGTH = 80

export function groupAdditionalStorageKey(resumeId: string): string {
  return `${STORAGE_PREFIX}${resumeId}`
}

/** Narrows stored JSON, falling back field by field instead of failing whole. */
export function parseGroupAdditional(raw: unknown): GroupAdditionalPreference {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_GROUP_ADDITIONAL }
  const value = raw as Record<string, unknown>
  const title =
    typeof value.title === "string" && value.title.trim().length > 0
      ? value.title.trim().slice(0, MAX_TITLE_LENGTH)
      : DEFAULT_GROUP_ADDITIONAL.title

  return {
    enabled: value.enabled === true,
    title,
  }
}

export function loadGroupAdditional(resumeId: string): GroupAdditionalPreference {
  if (typeof window === "undefined") return { ...DEFAULT_GROUP_ADDITIONAL }
  try {
    const raw = window.localStorage.getItem(groupAdditionalStorageKey(resumeId))
    if (!raw) return { ...DEFAULT_GROUP_ADDITIONAL }
    return parseGroupAdditional(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_GROUP_ADDITIONAL }
  }
}

export function saveGroupAdditional(
  resumeId: string,
  preference: GroupAdditionalPreference
): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      groupAdditionalStorageKey(resumeId),
      JSON.stringify(parseGroupAdditional(preference))
    )
  } catch {
    // Storage can be full or blocked; the current session still works.
  }
}
