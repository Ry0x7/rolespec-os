/**
 * Deterministic requirement-to-evidence mapping for resume tailoring.
 *
 * A posting is a list of things the EMPLOYER wants. It is never evidence about
 * the candidate. This module turns both sides into addressable records — the
 * candidate's own resume/profile facts (`EvidenceAtom`) and the posting's
 * requirements (`RequirementEvidence`) — so every claim a tailoring run makes
 * can point back to a specific section, item and field.
 *
 * Pure text work: no Prisma, no Next.js, no model. That keeps the mapping
 * reproducible in tests and explainable to the user.
 */

import { extractJobTerms } from "../lib/job-terms"
import type {
  EvidenceAtom,
  RequirementEvidence,
  RequirementEvidenceRef,
  RequirementVerdict,
  ResumeSectionSnapshot,
} from "./types"

const MAX_SERIALIZED_CHARS = 120_000
const MAX_REQUIREMENTS = 40
const MAX_REQUIREMENT_CHARS = 400
const MIN_REQUIREMENT_CHARS = 3
const MAX_REF_QUOTE_CHARS = 300
const MAX_EVIDENCE_REFS = 3

/** Cheap exclusions for posting prose that is never a candidate requirement. */
const NON_REQUIREMENT =
  /\b(equal opportunity|e-?verify|about (?:us|the company|our team)|benefits|perks|compensation|salary range|how to apply|apply now|we offer|privacy (?:policy|notice)|disclaimer|background check|drug screen)\b/i

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Token-continuation characters, matching the grounding helper. `.` is
 * deliberately excluded so a sentence-ending period does not turn
 * "postgresql." into a different term from "postgresql"; a term that itself
 * contains a dot (node.js) still matches literally.
 */
const WORD_CHAR = /[a-z0-9+#]/

function hasWholeTerm(haystack: string, term: string): boolean {
  if (!term) return false
  const pattern = new RegExp(escapeRegExp(term), "g")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(haystack)) !== null) {
    const before = match.index > 0 ? haystack[match.index - 1] : ""
    const end = match.index + match[0].length
    const after = end < haystack.length ? haystack[end] : ""
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1
  }
  return false
}

function itemSource(metadata: unknown): EvidenceAtom["source"] | undefined {
  const meta = asRecord(metadata)
  if (!meta) return undefined
  const nested = asRecord(meta.source) ?? meta
  const kind = asText(nested.kind) ?? asText(nested.evidenceKind) ?? undefined
  const adapter = asText(nested.adapter) ?? undefined
  const locator = asText(nested.locator) ?? undefined
  if (!kind && !adapter && !locator) return undefined
  return { ...(kind ? { kind } : {}), ...(adapter ? { adapter } : {}), ...(locator ? { locator } : {}) }
}

function sectionKey(section: ResumeSectionSnapshot, index: number): string {
  return section.id ?? `section-${index}`
}

function itemKey(
  section: ResumeSectionSnapshot,
  sectionIndex: number,
  itemIndex: number
): string {
  return section.items[itemIndex]?.id ?? `item-${sectionIndex}-${itemIndex}`
}

function atom(
  section: ResumeSectionSnapshot,
  sectionIndex: number,
  itemIndex: number,
  field: string,
  text: string,
  label: string,
  index?: number
): EvidenceAtom {
  const sectionId = sectionKey(section, sectionIndex)
  const itemId = itemKey(section, sectionIndex, itemIndex)
  return {
    ref: `sec:${sectionId}/item:${itemId}/${field}${index === undefined ? "" : `:${index}`}`,
    sectionId,
    sectionType: section.type,
    sectionTitle: section.title,
    itemId,
    label,
    field,
    ...(index === undefined ? {} : { index }),
    text,
    origin: "resume",
    approved: true,
    source: itemSource(section.items[itemIndex]?.metadata),
  }
}

/**
 * Flattens every resume section into the individual facts a claim could rest
 * on. One atom per addressable field/index, so an evidence reference can name
 * the exact bullet instead of "somewhere in the resume".
 */
export function resumeEvidenceAtoms(sections: ResumeSectionSnapshot[]): EvidenceAtom[] {
  const atoms: EvidenceAtom[] = []

  sections.forEach((section, sectionIndex) => {
    section.items.forEach((item, itemIndex) => {
      const content = item.content ?? {}

      switch (section.type) {
        case "SUMMARY": {
          const text = asText(content.text)
          if (text) atoms.push(atom(section, sectionIndex, itemIndex, "text", text, "Summary"))
          break
        }

        case "SKILLS": {
          const category = asText(content.category)
          const skills = Array.isArray(content.skills)
            ? content.skills.filter((entry): entry is string => typeof entry === "string")
            : []
          if (category) {
            atoms.push(
              atom(
                section,
                sectionIndex,
                itemIndex,
                "category",
                category,
                `Skills — ${category}`
              )
            )
          }
          skills.forEach((skill, index) => {
            const text = asText(skill)
            if (!text) return
            atoms.push(
              atom(
                section,
                sectionIndex,
                itemIndex,
                "skills",
                text,
                category ? `Skills — ${category}` : "Skills",
                index
              )
            )
          })
          break
        }

        case "EXPERIENCE": {
          const role = asText(content.role)
          const company = asText(content.company)
          const header = [role, company].filter(Boolean).join(" at ")
          if (header) {
            atoms.push(
              atom(
                section,
                sectionIndex,
                itemIndex,
                "header",
                header,
                `Experience — ${header}`
              )
            )
          }
          const bullets = Array.isArray(content.bullets) ? content.bullets : []
          bullets.forEach((bullet, index) => {
            const text = asText(bullet)
            if (!text) return
            atoms.push(
              atom(
                section,
                sectionIndex,
                itemIndex,
                "bullets",
                text,
                `Experience${header ? ` — ${header}` : ""}`,
                index
              )
            )
          })
          break
        }

        case "PROJECTS": {
          const name = asText(content.name)
          if (name) {
            atoms.push(atom(section, sectionIndex, itemIndex, "name", name, `Project — ${name}`))
          }
          const technologies = Array.isArray(content.technologies)
            ? content.technologies.filter((entry): entry is string => typeof entry === "string")
            : []
          technologies.forEach((technology, index) => {
            const text = asText(technology)
            if (!text) return
            atoms.push(
              atom(
                section,
                sectionIndex,
                itemIndex,
                "technologies",
                text,
                `Project${name ? ` — ${name}` : ""}`,
                index
              )
            )
          })
          const bullets = Array.isArray(content.bullets) ? content.bullets : []
          bullets.forEach((bullet, index) => {
            const text = asText(bullet)
            if (!text) return
            atoms.push(
              atom(
                section,
                sectionIndex,
                itemIndex,
                "bullets",
                text,
                `Project${name ? ` — ${name}` : ""}`,
                index
              )
            )
          })
          break
        }

        case "EDUCATION": {
          const degree = asText(content.degree)
          const field = asText(content.field)
          const school = asText(content.school)
          const study = [degree, field].filter(Boolean).join(" in ")
          const text = [study, school].filter(Boolean).join(" — ")
          if (text) {
            atoms.push(
              atom(section, sectionIndex, itemIndex, "education", text, "Education")
            )
          }
          const gpa = asText(content.gpa)
          if (gpa) {
            atoms.push(atom(section, sectionIndex, itemIndex, "gpa", `GPA ${gpa}`, "Education"))
          }
          break
        }

        case "CERTIFICATIONS": {
          const name = asText(content.name)
          const organization = asText(content.organization)
          const text = [name, organization].filter(Boolean).join(" — ")
          if (text) {
            atoms.push(
              atom(section, sectionIndex, itemIndex, "certification", text, "Certification")
            )
          }
          const credentialId = asText(content.credentialId)
          if (credentialId) {
            atoms.push(
              atom(
                section,
                sectionIndex,
                itemIndex,
                "credentialId",
                credentialId,
                "Certification"
              )
            )
          }
          break
        }

        case "CUSTOM": {
          const title = asText(content.title)
          const body = asText(content.content) ?? asText(content.text)
          if (title) {
            atoms.push(
              atom(section, sectionIndex, itemIndex, "title", title, section.title)
            )
          }
          if (body) {
            atoms.push(
              atom(
                section,
                sectionIndex,
                itemIndex,
                "content",
                body,
                title ? `${section.title} — ${title}` : section.title
              )
            )
          }
          break
        }

        default:
          break
      }
    })
  })

  return atoms
}

/**
 * Confirmed Career Profile evidence, addressable the same way as resume facts.
 * Unconfirmed candidates are intentionally omitted: the profile's own rule is
 * that nothing becomes trusted until the user confirms it.
 */
export function profileEvidenceAtoms(
  evidence: Array<{
    id: string
    kind: string
    title: string
    organization?: string | null
    details?: string | null
    outcome?: string | null
    status?: string
  }>,
  profileId: string
): EvidenceAtom[] {
  const atoms: EvidenceAtom[] = []

  for (const entry of evidence) {
    if (entry.status !== "CONFIRMED") continue
    const title = asText(entry.title)
    if (!title) continue
    const sectionId = `profile:${profileId}`
    const label = `${entry.kind}: ${title}`
    const fields: Array<[string, string | null | undefined]> = [
      ["title", title],
      ["organization", entry.organization],
      ["details", entry.details],
      ["outcome", entry.outcome],
    ]
    for (const [field, raw] of fields) {
      const text = asText(raw)
      if (!text) continue
      atoms.push({
        ref: `${sectionId}/item:${entry.id}/${field}`,
        sectionId,
        sectionType: "PROFILE",
        sectionTitle: "Career Profile",
        itemId: entry.id,
        label,
        field,
        text,
        origin: "profile",
        approved: true,
      })
    }
  }

  return atoms
}

/** One bounded text block for grounding checks and prompt evidence. */
export function serializeEvidence(atoms: EvidenceAtom[]): string {
  const seen = new Set<string>()
  const lines: string[] = []
  let total = 0

  for (const entry of atoms) {
    const text = asText(entry.text)
    if (!text) continue
    const key = `${normalized(entry.label)}\u0000${normalized(text)}`
    if (seen.has(key)) continue
    seen.add(key)
    const line = `${entry.label}: ${text}`
    if (total + line.length + 1 > MAX_SERIALIZED_CHARS) break
    lines.push(line)
    total += line.length + 1
  }

  return lines.join("\n")
}

interface RawRequirement {
  text: string
  kind: RequirementEvidence["kind"]
}

function isRequirementText(value: string): boolean {
  if (value.length < MIN_REQUIREMENT_CHARS || value.length > MAX_REQUIREMENT_CHARS) return false
  if (NON_REQUIREMENT.test(value)) return false
  // A heading with no content ("Responsibilities:") is not a requirement.
  if (/^[a-z &/]+:$/i.test(value)) return false
  return true
}

/**
 * The posting's requirements, in a stable order: the role title first, then
 * responsibilities/requirements as written. No inference and no model — a
 * sentence either appears in the posting or it does not.
 */
export function extractRequirements(
  jobTitle: string,
  jobDescription?: string | null
): RawRequirement[] {
  const out: Array<RawRequirement & { key: string }> = []
  const seen = new Set<string>()

  const push = (raw: string, kind: RequirementEvidence["kind"]) => {
    const text = raw
      .replace(/^\s*(?:[-*•▪◦–—]|\d+[.)])\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
    if (!isRequirementText(text)) return
    const key = normalized(text)
    if (seen.has(key)) return
    seen.add(key)
    out.push({ text, kind, key })
    return out.length >= MAX_REQUIREMENTS
  }

  const title = jobTitle.replace(/\s+/g, " ").trim().slice(0, 200)
  if (title) push(title, "TITLE")

  if (jobDescription) {
    const blocks = jobDescription.split(/\r?\n/)
    for (const rawBlock of blocks) {
      const block = rawBlock.trim()
      if (!block) continue
      const bullet = /^(?:[-*•▪◦–—]|\d+[.)])\s*/.test(block)
      const sentences = block
        .replace(/^(?:[-*•▪◦–—]|\d+[.)])\s*/, "")
        .split(/(?<=[.!?;])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean)

      for (const sentence of sentences.length > 0 ? sentences : [block]) {
        if (push(sentence, bullet ? "RESPONSIBILITY" : "REQUIREMENT")) break
      }
      if (out.length >= MAX_REQUIREMENTS) break
    }
  }

  return out.map(({ text, kind }) => ({ text, kind }))
}

function verdictFor(ratio: number, matchedCount: number): RequirementVerdict {
  if (matchedCount === 0) return "UNSUPPORTED"
  if (ratio >= 0.6) return "SUPPORTED"
  if (ratio >= 0.25) return "PARTIAL"
  return "UNSUPPORTED"
}

/**
 * Classifies each posting requirement against the candidate's own atoms.
 *
 * The verdict is deliberately conservative: a requirement backed by most of
 * its distinctive terms is SUPPORTED, a fragment is PARTIAL, and everything
 * else is UNSUPPORTED. The top matching atoms become the evidence references
 * shown alongside the requirement.
 */
export function mapRequirements(input: {
  jobTitle: string
  jobDescription?: string | null
  atoms: EvidenceAtom[]
}): RequirementEvidence[] {
  const requirements = extractRequirements(input.jobTitle, input.jobDescription)
  const atoms = input.atoms
    .map((entry) => ({ ...entry, haystack: normalized(entry.text) }))
    .filter((entry) => entry.haystack.length > 0)

  return requirements.map((requirement, index) => {
    const terms = extractJobTerms(requirement.text, { minLength: 2 })
    if (terms.length === 0 || atoms.length === 0) {
      return {
        id: `req-${index + 1}`,
        text: requirement.text,
        kind: requirement.kind,
        verdict: "UNSUPPORTED" as const,
        matchedTerms: [],
        evidenceRefs: [],
      }
    }

    const scored = atoms
      .map((entry) => {
        const matched = terms.filter((term) => hasWholeTerm(entry.haystack, term))
        return { atom: entry, matched }
      })
      .filter((entry) => entry.matched.length > 0)
      .sort(
        (left, right) =>
          right.matched.length - left.matched.length ||
          left.atom.ref.localeCompare(right.atom.ref)
      )

    const matchedTerms: string[] = []
    for (const term of terms) {
      if (scored.some((entry) => entry.matched.includes(term))) matchedTerms.push(term)
    }

    const ratio = matchedTerms.length / terms.length
    const evidenceRefs: RequirementEvidenceRef[] = scored
      .slice(0, MAX_EVIDENCE_REFS)
      .map(({ atom: entry, matched }) => ({
        ref: entry.ref,
        label: entry.label,
        quote:
          entry.text.length > MAX_REF_QUOTE_CHARS
            ? `${entry.text.slice(0, MAX_REF_QUOTE_CHARS - 1)}…`
            : entry.text,
        origin: entry.origin,
        matchedTerms: matched,
      }))

    return {
      id: `req-${index + 1}`,
      text: requirement.text,
      kind: requirement.kind,
      verdict: verdictFor(ratio, matchedTerms.length),
      matchedTerms,
      evidenceRefs,
    }
  })
}
