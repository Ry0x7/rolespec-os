import type { ParsedResume } from "@/features/resume/services/parse-resume"
import { isPlausibleSkillName } from "@/features/career-profile/services/import-linkedin.service"
import type {
  ContactField,
  IntakePatchDraft,
  IntakeProvenance,
  IntakeSource,
} from "../types"

const MAX_EVIDENCE = 60
const MAX_SKILLS = 120

/** `YYYY-MM` and `YYYY-MM-DD` become the UTC date string the DB stores. */
export function normalizeDateString(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const monthOnly = /^(\d{4})-(\d{2})$/.exec(trimmed)
  if (monthOnly) {
    const month = Number(monthOnly[2])
    if (month < 1 || month > 12) return null
    return `${monthOnly[1]}-${monthOnly[2]}-01`
  }
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!full) return null
  const month = Number(full[2])
  const day = Number(full[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(Number(full[1]), month - 1, day))
  if (
    date.getUTCFullYear() !== Number(full[1]) ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return `${full[1]}-${full[2]}-${full[3]}`
}

function capped(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function joinBullets(value: string[] | undefined): string | null {
  if (!value || value.length === 0) return null
  const lines = value.map((line) => line.trim()).filter(Boolean)
  return lines.length > 0 ? capped(lines.join("\n"), 4000) : null
}

const CONTACT_RULES: Record<
  ContactField,
  (value: string) => boolean
> = {
  contactFullName: (value) => value.length <= 200,
  contactEmail: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320,
  contactPhone: (value) => value.length <= 50,
  contactLocation: (value) => value.length <= 200,
  linkedinUrl: (value) => /^https?:\/\/\S+$/i.test(value) && value.length <= 500,
  githubUrl: (value) => /^https?:\/\/\S+$/i.test(value) && value.length <= 500,
  websiteUrl: (value) => /^https?:\/\/\S+$/i.test(value) && value.length <= 500,
}

/**
 * A malformed email or URL is never written as a fact. The adapter reports it
 * as a warning so the user can correct it manually instead of seeing a value
 * the profile form will later reject.
 */
function contactDrafts(
  contact: ParsedResume["contact"],
  provenance: IntakeProvenance,
  warnings: string[]
): IntakePatchDraft[] {
  if (!contact) return []
  const entries: Array<[ContactField, string | undefined]> = [
    ["contactFullName", contact.fullName],
    ["contactEmail", contact.email],
    ["contactPhone", contact.phone],
    ["contactLocation", contact.location],
    ["linkedinUrl", contact.linkedin],
    ["githubUrl", contact.github],
    ["websiteUrl", contact.website],
  ]

  const drafts: IntakePatchDraft[] = []
  for (const [field, raw] of entries) {
    const value = raw?.trim()
    if (!value) continue
    if (!CONTACT_RULES[field](value)) {
      warnings.push(`Skipped ${field} because the value did not look valid.`)
      continue
    }
    drafts.push({
      kind: "CONTACT",
      data: { field, value },
      confidence: 90,
      provenance: { ...provenance, locator: `contact:${field}` },
    })
  }
  return drafts
}

function normalizedUrl(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  return trimmed.slice(0, 500)
}

/**
 * Pure mapping from a parsed resume to intake drafts. Chat/voice use a separate
 * extractor; this is only for documents whose structure is already recovered.
 */
export function parsedResumeToDrafts(
  parsed: ParsedResume,
  options: {
    source: Extract<IntakeSource, "RESUME" | "LINKEDIN">
    adapter: string
    provenance: Omit<IntakeProvenance, "adapter" | "locator">
    confidence?: number
  }
): { drafts: IntakePatchDraft[]; warnings: string[] } {
  const warnings: string[] = []
  const base: IntakeProvenance = {
    ...options.provenance,
    adapter: options.adapter,
    locator: null,
  }
  const confidence = options.confidence ?? 85
  const drafts: IntakePatchDraft[] = []
  drafts.push(...contactDrafts(parsed.contact, base, warnings))

  for (const [index, entry] of (parsed.experience ?? []).slice(0, MAX_EVIDENCE).entries()) {
    const title = capped(entry.role ?? entry.company, 300)
    if (!title) continue
    drafts.push({
      kind: "EVIDENCE",
      data: {
        evidenceKind: "EXPERIENCE",
        title,
        organization: capped(entry.company, 300),
        details: joinBullets(entry.bullets),
        outcome: null,
        startDate: normalizeDateString(entry.startDate),
        endDate: normalizeDateString(entry.endDate),
      },
      confidence,
      provenance: { ...base, locator: `experience:${index + 1}` },
    })
  }

  for (const [index, entry] of (parsed.education ?? []).slice(0, MAX_EVIDENCE).entries()) {
    // No generic "Education" row: without a degree, field or school the entry
    // does not describe a qualification and would only add noise to review.
    const title =
      capped([entry.degree, entry.field].filter(Boolean).join(" — "), 300) ??
      capped(entry.field, 300)
    if (!title) continue
    drafts.push({
      kind: "EVIDENCE",
      data: {
        evidenceKind: "EDUCATION",
        title,
        organization: capped(entry.school, 300),
        details: entry.gpa ? `GPA ${entry.gpa}` : null,
        outcome: null,
        startDate: normalizeDateString(entry.startDate),
        endDate: normalizeDateString(entry.endDate),
      },
      confidence: confidence - 5,
      provenance: { ...base, locator: `education:${index + 1}` },
    })
  }

  for (const [index, entry] of (parsed.projects ?? []).slice(0, MAX_EVIDENCE).entries()) {
    const title = capped(entry.name, 300)
    if (!title) continue
    const details = joinBullets(entry.bullets)
    drafts.push({
      kind: "EVIDENCE",
      data: {
        evidenceKind: "PROJECT",
        title,
        organization: null,
        details,
        outcome: null,
        startDate: normalizeDateString(entry.startDate),
        endDate: normalizeDateString(entry.endDate),
      },
      confidence: confidence - 5,
      provenance: {
        ...base,
        sourceUrl: normalizedUrl(entry.url) ?? base.sourceUrl ?? null,
        locator: `project:${index + 1}`,
      },
    })
  }

  for (const [index, entry] of (parsed.certifications ?? []).slice(0, MAX_EVIDENCE).entries()) {
    const title = capped(entry.name, 300)
    if (!title) continue
    drafts.push({
      kind: "EVIDENCE",
      data: {
        evidenceKind: "CERTIFICATION",
        title,
        organization: capped(entry.organization, 300),
        details: entry.credentialId ? `Credential ${entry.credentialId}` : null,
        outcome: null,
        startDate: null,
        endDate: normalizeDateString(entry.dateObtained),
      },
      confidence: confidence - 5,
      provenance: { ...base, locator: `certification:${index + 1}` },
    })
  }

  const skillSeen = new Set<string>()
  const pushSkill = (name: string | undefined, category: string | null) => {
    if (!name) return
    const trimmed = name.trim().slice(0, 120)
    if (!trimmed || !isPlausibleSkillName(trimmed)) return
    const key = trimmed.toLowerCase()
    if (skillSeen.has(key)) return
    skillSeen.add(key)
    if (skillSeen.size > MAX_SKILLS) return
    drafts.push({
      kind: "SKILL",
      data: { name: trimmed, category: capped(category, 80) },
      confidence: confidence - 10,
      provenance: { ...base, locator: `skill:${trimmed}` },
    })
  }

  for (const group of parsed.skills ?? []) {
    for (const name of group.skills ?? []) pushSkill(name, group.category ?? null)
  }
  for (const project of parsed.projects ?? []) {
    for (const name of project.technologies ?? []) pushSkill(name, "Project")
  }

  return { drafts, warnings }
}
