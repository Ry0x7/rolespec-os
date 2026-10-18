import type { ATSAnalysisResult } from "./ats-analyze"
import type { Section, SectionItem } from "../hooks/use-resume-store"

/**
 * Issues carry the same shape the model emits, so deterministic findings can be
 * merged straight into the AI's `issues` array without any mapping.
 */
export type ParseCheckIssue = ATSAnalysisResult["issues"][number]

/** Longer bullets get truncated or wrapped into an unreadable blob in the ATS candidate view. */
const MAX_BULLET_LENGTH = 350

/**
 * Custom section titles real parsers field-map. Anything else lands in a
 * catch-all "other" blob (or is dropped) in most ATSes.
 */
const FIELD_MAPPABLE_CUSTOM_TITLES = new Set([
  "achievements",
  "activities",
  "additional information",
  "affiliations",
  "apprenticeship",
  "apprenticeships",
  "awards",
  "awards and honors",
  "board certifications",
  "certifications",
  "clinical experience",
  "clinical rotations",
  "continuing education",
  "courses",
  "coursework",
  "education",
  "experience",
  "field experience",
  "honors",
  "interests",
  "languages",
  "leadership",
  "licenses",
  "memberships",
  "military experience",
  "military service",
  "practicum",
  "presentations",
  "professional affiliations",
  "professional experience",
  "professional memberships",
  "projects",
  "publications",
  "references",
  "research",
  "research experience",
  "security clearance",
  "skills",
  "student teaching",
  "summary",
  "teaching experience",
  "training",
  "volunteer experience",
  "volunteering",
  "work experience",
])

/**
 * Characters beyond this set survive text extraction unpredictably: emoji,
 * dingbats, box drawing and private-use glyphs typically come out as garbage or
 * disappear. Ordinary ASCII, accented Latin letters and common typographic
 * punctuation are allowed.
 */
const ALLOWED_CHAR =
  /^[\t\n\r\x20-\x7E\u00A0-\u024F\u2010-\u2015\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\u2122]$/

function isProblemChar(ch: string): boolean {
  return !ALLOWED_CHAR.test(ch)
}

/** Every string reachable inside an item's content, including nested arrays. */
function collectText(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectText(entry, out)
    return
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectText(entry, out)
  }
}

function itemText(items: SectionItem[]): string[] {
  const out: string[] = []
  for (const item of items) collectText(item.content, out)
  return out
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Deterministic parse-compatibility checks. No AI, no I/O — the same structured
 * sections the analyzer serializes, scored against what real ATS parsers can and
 * cannot field-map.
 */
export function checkParseCompatibility(sections: Section[]): ParseCheckIssue[] {
  const issues: ParseCheckIssue[] = []
  const visible = sections.filter((s) => s.visible)

  const contact = visible.find((s) => s.type === "CONTACT")
  const experience = visible.find((s) => s.type === "EXPERIENCE")
  const education = visible.find((s) => s.type === "EDUCATION")
  const skills = visible.find((s) => s.type === "SKILLS")

  // ─── 1 + 2. Contact section and its required channels ─────────────────────
  const contactItem = contact?.items[0]
  const email = str(contactItem?.content.email)
  const phone = str(contactItem?.content.phone)

  if (!contact || !contactItem) {
    issues.push({
      severity: "critical",
      category: "Formatting",
      message: "No contact section — the ATS has no email address to file this resume under.",
      section: "Contact",
      suggestion:
        "Add a contact section at the top with your name, email and phone number as plain text.",
    })
  } else {
    if (!email) {
      issues.push({
        severity: "critical",
        category: "Completeness",
        message: "Missing email address — most ATSes reject or cannot contact a record without one.",
        section: "Contact",
        suggestion: "Add your email address to the contact section as plain text.",
      })
    }
    if (!phone) {
      issues.push({
        severity: "warning",
        category: "Completeness",
        message: "Missing phone number — recruiters filter on a complete contact record.",
        section: "Contact",
        suggestion: "Add a phone number in a plain format such as +1 555 123 4567.",
      })
    }
  }

  // ─── 1. Standard sections a parser expects to field-map ───────────────────
  if (!experience || experience.items.length === 0) {
    issues.push({
      severity: "warning",
      category: "Completeness",
      message:
        "No work experience section — the ATS builds its employment history from this section.",
      section: "Experience",
      suggestion:
        'Add a section titled "Work Experience" with your roles, employers and dates.',
    })
  }

  if (!skills || skills.items.length === 0) {
    issues.push({
      severity: "warning",
      category: "Keywords",
      message: "No skills section — keyword searches rely on it to surface your profile.",
      section: "Skills",
      suggestion:
        'Add a section titled "Skills" listing the hard skills, credentials or competencies named in the job description.',
    })
  }

  // ─── 3. Date signals ──────────────────────────────────────────────────────
  const dated: Array<{ section: Section; label: string }> = []
  if (experience) dated.push({ section: experience, label: "Experience" })
  if (education) dated.push({ section: education, label: "Education" })

  for (const { section, label } of dated) {
    const missing = section.items.filter((item) => !str(item.content.startDate))
    if (missing.length > 0) {
      issues.push({
        severity: "warning",
        category: "Formatting",
        message: `${missing.length} ${label.toLowerCase()} ${
          missing.length === 1 ? "entry has" : "entries have"
        } no start date — parsers drop entries they cannot place on a timeline.`,
        section: section.title || label,
        suggestion: 'Add a start date to every entry in a parseable format such as "Jan 2024".',
      })
    }
  }

  if (experience) {
    const current = experience.items.filter((item) => item.content.current === true)
    if (current.length > 1) {
      issues.push({
        severity: "info",
        category: "Formatting",
        message: `${current.length} roles are marked as current — the ATS cannot tell which one is your present position.`,
        section: experience.title || "Experience",
        suggestion:
          "Mark only your present role as current and give the others an explicit end date.",
      })
    }
  }

  // ─── 4. Characters that do not survive text extraction ────────────────────
  for (const section of visible) {
    const found = new Set<string>()
    for (const text of itemText(section.items)) {
      for (const ch of text) {
        if (isProblemChar(ch)) found.add(ch)
      }
    }
    if (found.size > 0) {
      const sample = [...found].slice(0, 5).join(" ")
      issues.push({
        severity: "warning",
        category: "Formatting",
        message: `The ${section.title || section.type} section contains characters that may not survive text extraction (${sample}).`,
        section: section.title || section.type,
        suggestion: "Replace emoji and decorative symbols with plain text.",
      })
    }
  }

  // ─── 5. Overlong bullets ──────────────────────────────────────────────────
  for (const section of visible) {
    let overlong = 0
    for (const item of section.items) {
      const bullets = item.content.bullets
      if (!Array.isArray(bullets)) continue
      for (const bullet of bullets) {
        if (typeof bullet === "string" && bullet.trim().length > MAX_BULLET_LENGTH) overlong++
      }
    }
    if (overlong > 0) {
      issues.push({
        severity: "info",
        category: "Readability",
        message: `${overlong} ${overlong === 1 ? "bullet is" : "bullets are"} longer than ${MAX_BULLET_LENGTH} characters and may be truncated in the ATS candidate view.`,
        section: section.title || section.type,
        suggestion: "Split long bullets into one to two line achievements that lead with the result.",
      })
    }
  }

  // ─── 6. Custom section titles no parser field-maps ────────────────────────
  for (const section of visible) {
    if (section.type !== "CUSTOM") continue
    if (section.items.length === 0) continue
    const title = section.title.trim()
    if (!title || FIELD_MAPPABLE_CUSTOM_TITLES.has(title.toLowerCase())) continue
    issues.push({
      severity: "info",
      category: "Formatting",
      message: `"${title}" is not a section heading applicant tracking systems field-map, so its content may be filed as unstructured text.`,
      section: title,
      suggestion:
        'Rename it to a standard heading recruiters and parsers recognize, such as "Certifications", "Licenses" or "Additional Information".',
    })
  }

  return issues
}
