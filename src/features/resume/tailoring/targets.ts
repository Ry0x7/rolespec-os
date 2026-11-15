import type { TailorTarget } from "../services/tailor-resume"
import type { ResumeSectionSnapshot } from "./types"

/**
 * The tailorable text of a resume, addressed positionally.
 *
 * The ids are indices into the exact array the caller mutates, so a resolved id
 * can never land on the wrong text. Whole experience items are addressable so
 * an unrelated role can be dropped; they carry no rewrite target.
 */
export function buildTailorTargets(sections: ResumeSectionSnapshot[]): TailorTarget[] {
  const targets: TailorTarget[] = []

  sections.forEach((section, si) => {
    section.items.forEach((item, ii) => {
      const content =
        item.content && typeof item.content === "object" && !Array.isArray(item.content)
          ? item.content
          : {}

      if (section.type === "SUMMARY") {
        const text = typeof content.text === "string" ? content.text.trim() : ""
        if (text) targets.push({ targetId: `s${si}::i${ii}`, field: "summary", text, label: "Summary" })
        return
      }

      if (section.type === "SKILLS") {
        const skills = Array.isArray(content.skills)
          ? content.skills.filter((entry): entry is string => typeof entry === "string")
          : []
        const text = skills.join(", ").trim()
        if (text) {
          const category = typeof content.category === "string" ? content.category : undefined
          targets.push({
            targetId: `s${si}::i${ii}`,
            field: "skills",
            text,
            label: category ? `Skills — ${category}` : "Skills",
          })
        }
        return
      }

      if (section.type === "EXPERIENCE" || section.type === "PROJECTS") {
        const bullets = Array.isArray(content.bullets)
          ? content.bullets.filter((entry): entry is string => typeof entry === "string")
          : []
        const label =
          section.type === "EXPERIENCE"
            ? [content.role, content.company]
                .filter((value): value is string => typeof value === "string" && value.length > 0)
                .join(" at ")
            : typeof content.name === "string"
              ? content.name
              : ""

        if (section.type === "EXPERIENCE" && label) {
          targets.push({
            targetId: `s${si}::i${ii}`,
            field: "experience",
            text: label,
            label: `${section.title} — whole item: ${label}`,
          })
        }
        bullets.forEach((bullet, bi) => {
          const text = bullet.trim()
          if (!text) return
          targets.push({
            targetId: `s${si}::i${ii}::b${bi}`,
            field: "bullet",
            text,
            label: `${section.title}${label ? ` — ${label}` : ""}`,
          })
        })
      }
    })
  })

  return targets
}
