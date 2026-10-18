import {
  MAX_ENHANCE_LABEL_LENGTH,
  MAX_ENHANCE_TARGET_TEXT_LENGTH,
  MAX_ENHANCE_TARGETS,
} from "../constants/enhance"
import type { SectionType } from "@/generated/prisma/enums"
import type { EnhanceField, Section } from "../hooks/use-resume-store"

/**
 * The section types `collectEnhanceTargets` draws text from. Shared so any
 * surface asking "can Enhance act on this section?" reads the same list the
 * collector filters by, rather than a hand-kept copy.
 */
export const ENHANCEABLE_SECTION_TYPES: readonly SectionType[] = [
  "SUMMARY",
  "SKILLS",
  "EXPERIENCE",
  "PROJECTS",
]

export function isEnhanceableSectionType(type: SectionType): boolean {
  return ENHANCEABLE_SECTION_TYPES.includes(type)
}

/** A piece of resume text the global enhance flow may rewrite. */
export interface EnhanceTargetRef {
  targetId: string
  sectionId: string
  itemId: string
  field: EnhanceField
  /** Only set for `field: "bullet"`. */
  bulletIndex?: number
  label: string
  text: string
}

/**
 * The single string a skills category is enhanced as. Apply/revert compares
 * against this exact rendering, so both sides have to build it the same way.
 */
export function skillsToText(skills: unknown): string {
  if (!Array.isArray(skills)) return ""
  return skills
    .map((skill) => (typeof skill === "string" ? skill.trim() : ""))
    .filter(Boolean)
    .join(", ")
}

/**
 * The text a summary or bullet target carries: trimmed, then capped. Apply and
 * Revert compare the live text trimmed but uncapped, so padding never reads as
 * "content changed" while an over-cap text never matches its capped prefix.
 */
export function toEnhanceTargetText(text: unknown): string {
  return typeof text === "string" ? text.trim().slice(0, MAX_ENHANCE_TARGET_TEXT_LENGTH) : ""
}

/**
 * Flattens the summary text, every experience and project bullet, and every
 * skills category into a tagged list the enhance action can address by id.
 * Labels and text are truncated to the action's caps so an oversized-but-
 * legitimate bullet is shortened rather than failing the whole run on
 * validation.
 */
export function collectEnhanceTargets(sections: Section[]): EnhanceTargetRef[] {
  const targets: EnhanceTargetRef[] = []

  for (const section of sections) {
    if (!isEnhanceableSectionType(section.type)) continue

    if (section.type === "SUMMARY") {
      for (const item of section.items) {
        const text = toEnhanceTargetText((item.content as { text?: string }).text)
        if (!text) continue
        targets.push({
          targetId: `${section.id}::${item.id}::summary`,
          sectionId: section.id,
          itemId: item.id,
          field: "summary",
          label: "Professional summary",
          text,
        })
      }
      continue
    }

    if (section.type === "SKILLS") {
      for (const item of section.items) {
        const content = item.content as { category?: string; skills?: unknown }
        const text = skillsToText(content.skills)
        if (!text) continue
        const category = content.category?.trim()
        targets.push({
          targetId: `${section.id}::${item.id}::skills`,
          sectionId: section.id,
          itemId: item.id,
          field: "skills",
          label: (category ? `Skills — ${category}` : "Skills — Untitled category").slice(
            0,
            MAX_ENHANCE_LABEL_LENGTH
          ),
          text: text.slice(0, MAX_ENHANCE_TARGET_TEXT_LENGTH),
        })
      }
      continue
    }

    // EXPERIENCE or PROJECTS — the guard at the top of the loop admits no other type.
    for (const item of section.items) {
      const content = item.content as {
        bullets?: unknown
        role?: string
        company?: string
        name?: string
      }
      if (!Array.isArray(content.bullets)) continue

      const label = (
        section.type === "EXPERIENCE"
          ? `Experience — ${[content.role, content.company].filter(Boolean).join(" @ ") || "Untitled role"}`
          : `Project — ${content.name || "Untitled project"}`
      ).slice(0, MAX_ENHANCE_LABEL_LENGTH)

      content.bullets.forEach((bullet, index) => {
        const text = toEnhanceTargetText(bullet)
        if (!text) return
        targets.push({
          targetId: `${section.id}::${item.id}::b${index}`,
          sectionId: section.id,
          itemId: item.id,
          field: "bullet",
          bulletIndex: index,
          label,
          text,
        })
      })
    }
  }

  return targets.slice(0, MAX_ENHANCE_TARGETS)
}
