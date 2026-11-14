import type { Section } from "../hooks/use-resume-store"

/**
 * Flattens the structured sections into the plain text an ATS extracts from an
 * uploaded resume. Kept dependency-free (no server imports) so client code —
 * the "ATS view" preview — can render the exact same text the analyzer scores.
 */
export function serializeSections(sections: Section[]): string {
  const sorted = [...sections].sort((a, b) => a.order - b.order)
  const parts: string[] = []

  for (const section of sorted) {
    if (!section.visible) continue

    switch (section.type) {
      case "CONTACT": {
        const item = section.items[0]
        if (!item) break
        const c = item.content
        const fields = [
          c.fullName && `Name: ${c.fullName}`,
          c.email && `Email: ${c.email}`,
          c.phone && `Phone: ${c.phone}`,
          c.location && `Location: ${c.location}`,
          c.linkedin && `LinkedIn: ${c.linkedin}`,
          c.github && `GitHub: ${c.github}`,
          c.website && `Website: ${c.website}`,
        ].filter(Boolean)
        if (fields.length > 0) {
          parts.push(`## Contact\n${fields.join(", ")}`)
        }
        break
      }

      case "SUMMARY": {
        const item = section.items[0]
        if (!item) break
        const text = item.content.text
        if (text) {
          parts.push(`## Summary\n${text}`)
        }
        break
      }

      case "EXPERIENCE": {
        const entries = section.items
          .sort((a, b) => a.order - b.order)
          .map((item) => {
            const c = item.content
            const header = [c.role, c.company && `at ${c.company}`]
              .filter(Boolean)
              .join(" ")
            const dates = [c.startDate, c.endDate || (c.current ? "Present" : null)]
              .filter(Boolean)
              .join(" - ")
            const lines = [header, dates && `(${dates})`].filter(Boolean).join(" ")
            const bullets = (c.bullets as string[] | undefined)
              ?.map((b) => `- ${b}`)
              .join("\n")
            return [lines, bullets].filter(Boolean).join("\n")
          })
        if (entries.length > 0) {
          parts.push(`## Experience\n${entries.join("\n\n")}`)
        }
        break
      }

      case "EDUCATION": {
        const entries = section.items
          .sort((a, b) => a.order - b.order)
          .map((item) => {
            const c = item.content
            const degree = [c.degree, c.field && `in ${c.field}`]
              .filter(Boolean)
              .join(" ")
            const from = c.school ? `from ${c.school}` : ""
            const dates = [c.startDate, c.endDate].filter(Boolean).join(" - ")
            return [degree, from, dates && `(${dates})`].filter(Boolean).join(" ")
          })
        if (entries.length > 0) {
          parts.push(`## Education\n${entries.join("\n")}`)
        }
        break
      }

      case "SKILLS": {
        const entries = section.items
          .sort((a, b) => a.order - b.order)
          .map((item) => {
            const c = item.content
            const skills = (c.skills as string[] | undefined)?.join(", ")
            if (c.category && skills) return `${c.category}: ${skills}`
            if (skills) return skills
            return null
          })
          .filter(Boolean)
        if (entries.length > 0) {
          parts.push(`## Skills\n${entries.join("\n")}`)
        }
        break
      }

      case "PROJECTS": {
        const entries = section.items
          .sort((a, b) => a.order - b.order)
          .map((item) => {
            const c = item.content
            const name = c.name || "Untitled Project"
            const dates = [c.startDate, c.endDate].filter(Boolean).join(" - ")
            const header = [name, dates && `(${dates})`].filter(Boolean).join(" ")
            const bullets = (c.bullets as string[] | undefined)
              ?.filter((b) => (b as string).trim())
              .map((b) => `- ${b}`)
              .join("\n")
            const techs = (c.technologies as string[] | undefined)?.join(", ")
            const url = typeof c.url === "string" ? c.url.trim() : ""
            const urlLabel = typeof c.urlLabel === "string" ? c.urlLabel.trim() : ""
            const link = url ? `Link: ${urlLabel ? `${urlLabel} (${url})` : url}` : null
            return [header, bullets, techs && `Technologies: ${techs}`, link]
              .filter(Boolean)
              .join("\n")
          })
        if (entries.length > 0) {
          parts.push(`## Projects\n${entries.join("\n\n")}`)
        }
        break
      }

      case "CERTIFICATIONS": {
        const entries = section.items
          .sort((a, b) => a.order - b.order)
          .map((item) => {
            const c = item.content
            const name = c.name || "Untitled Certification"
            const org = c.organization ? ` - ${c.organization}` : ""
            const obtained =
              typeof c.dateObtained === "string" && c.dateObtained.trim()
                ? `Obtained: ${c.dateObtained.trim()}`
                : null
            const expires =
              typeof c.expirationDate === "string" && c.expirationDate.trim()
                ? `Expires: ${c.expirationDate.trim()}`
                : null
            const dates = [obtained, expires].filter(Boolean).join("; ")
            return [
              `${name}${org}`,
              dates,
            ]
              .filter(Boolean)
              .join(" — ")
          })
        if (entries.length > 0) {
          parts.push(`## Certifications\n${entries.join("\n")}`)
        }
        break
      }

      case "CUSTOM": {
        const entries = section.items
          .sort((a, b) => a.order - b.order)
          .map((item) => {
            const { title, content, text } = item.content
            return [title, content ?? text].filter(Boolean).join("\n")
          })
          .filter(Boolean)
        if (entries.length > 0) {
          parts.push(`## ${section.title}\n${entries.join("\n")}`)
        }
        break
      }
    }
  }

  return parts.join("\n\n")
}
