/**
 * The six career-profile sections, in page order. LinkedIn import is a tool,
 * not a record of anything the user has filled in, so it never gets a
 * complete/incomplete signal — `complete` stays `null` for it.
 */
export type ProfileSectionKey =
  | "contact"
  | "preferences"
  | "target-roles"
  | "linkedin-import"
  | "evidence"
  | "capabilities"

export interface ProfileSectionNavItem {
  key: ProfileSectionKey
  label: string
  complete: boolean | null
}

/** The minimal, already-fetched facts each section's completeness depends on. */
export interface SectionCompletenessInput {
  contactFullName: string | null
  contactEmail: string | null
  experienceLevel: string | null
  activeTargetRoleCount: number
  evidenceCount: number
  capabilityCount: number
}

export function computeSectionCompleteness(
  input: SectionCompletenessInput
): ProfileSectionNavItem[] {
  return [
    {
      key: "contact",
      label: "Contact",
      complete: Boolean(input.contactFullName?.trim() && input.contactEmail?.trim()),
    },
    {
      key: "preferences",
      label: "Preferences",
      complete: input.experienceLevel !== null,
    },
    {
      key: "target-roles",
      label: "Target roles",
      complete: input.activeTargetRoleCount > 0,
    },
    {
      key: "linkedin-import",
      label: "LinkedIn import",
      complete: null,
    },
    {
      key: "evidence",
      label: "Evidence",
      complete: input.evidenceCount > 0,
    },
    {
      key: "capabilities",
      label: "Capabilities",
      complete: input.capabilityCount > 0,
    },
  ]
}

/** Excludes neutral (`null`) items — LinkedIn import never counts toward the total. */
export function summarizeSectionCompleteness(items: ProfileSectionNavItem[]): {
  complete: number
  total: number
} {
  const scored = items.filter((item) => item.complete !== null)
  return {
    complete: scored.filter((item) => item.complete === true).length,
    total: scored.length,
  }
}
