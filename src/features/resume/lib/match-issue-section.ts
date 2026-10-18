import type { Section } from "../hooks/use-resume-store"

/**
 * Matches an issue's free-text `section` (a human label like "Experience", or
 * whatever the model named) against the resume's actual sections, so a jump
 * control or a contextual finding only ever attaches to a real section.
 * Extracted from `ats-drawer.tsx` so the inspector's jump links and the
 * editors' inline findings read the same match, not two copies of it.
 */
export function findMatchingSectionId(
  sections: readonly Pick<Section, "id" | "title" | "type">[] | undefined,
  issueSection: string | undefined
): string | null {
  if (!issueSection || !sections) return null
  const needle = issueSection.trim().toLowerCase()
  if (!needle) return null
  const byTitle = sections.find((s) => s.title.trim().toLowerCase() === needle)
  if (byTitle) return byTitle.id
  const byType = sections.find((s) => s.type.toLowerCase() === needle)
  return byType ? byType.id : null
}
