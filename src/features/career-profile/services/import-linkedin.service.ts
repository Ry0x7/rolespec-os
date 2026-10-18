import { z } from "zod"

import {
  CareerEvidenceKind,
  CareerEvidenceSource,
  CareerEvidenceStatus,
} from "@/generated/prisma/enums"
import {
  AI_USAGE_FEATURES,
  generateObjectTracked,
} from "@/shared/lib/ai-generate"
import {
  fenceUntrusted,
  UNTRUSTED_CONTENT_RULES,
} from "@/shared/lib/prompts/untrusted"
import { prisma } from "@/shared/lib/prisma"
import { getOrCreateCareerProfileId } from "./career-profile.service"

// ─── Extraction schema ──────────────────────────────────────────────────────

/** Longest slice of the export handed to the model, like `parse-resume.ts`. */
const MAX_PROFILE_TEXT_LENGTH = 100_000

/** Ceilings the model itself is held to, so one export cannot flood a profile. */
const MAX_EVIDENCE_ITEMS = 40
const MAX_SKILL_ITEMS = 60

/** Field caps mirroring `createEvidenceSchema` — the import obeys the same limits. */
const TITLE_MAX = 200
const ORGANIZATION_MAX = 200
const DETAILS_MAX = 5000
const OUTCOME_MAX = 2000
/** `createCapabilitySchema.name` */
const SKILL_NAME_MAX = 120

/**
 * Every optional property is required-and-nullable rather than optional, so the
 * schema stays compatible with strict structured outputs (which demands that
 * `required` lists every key). Nulls are handled by the mapper below.
 */
export const linkedinImportSchema = z.object({
  evidence: z
    .array(
      z.object({
        kind: z.nativeEnum(CareerEvidenceKind),
        title: z.string(),
        organization: z.string().nullable(),
        /** "YYYY-MM" or "YYYY-MM-DD" exactly, or null. */
        startDate: z.string().nullable(),
        endDate: z.string().nullable(),
        details: z.string().nullable(),
        outcome: z.string().nullable(),
      })
    )
    .max(MAX_EVIDENCE_ITEMS),
  skills: z.array(z.string()).max(MAX_SKILL_ITEMS),
})

export type LinkedinImportExtraction = z.infer<typeof linkedinImportSchema>

const SYSTEM_PROMPT = [
  "You extract durable career facts from the text of a LinkedIn profile export, so the person can review and confirm them in their own career profile.",
  "",
  'OUTPUT FORMAT: Respond with ONLY a valid JSON object using EXACTLY these camelCase field names — no extra fields, no markdown:',
  "{",
  '  "evidence": [{ "kind": "EXPERIENCE", "title": "Registered Nurse", "organization": "Northside Hospital", "startDate": "2021-03", "endDate": null, "details": "Ran triage for a 24-bed critical care unit.", "outcome": null }],',
  '  "skills": ["Triage", "ACLS"]',
  "}",
  "",
  "SECTION MAPPING — `kind` is one of EXPERIENCE, EDUCATION, CERTIFICATION, PROJECT, ACHIEVEMENT:",
  "- Positions / work experience → EXPERIENCE (title = the role, organization = the employer)",
  "- Education → EDUCATION (title = the degree or programme, organization = the school)",
  "- Licenses & certifications → CERTIFICATION (title = the credential, organization = the issuer)",
  "- Projects → PROJECT",
  "- Honors, awards and publications → ACHIEVEMENT",
  "",
  "FIELD RULES:",
  "- Every key shown above MUST be present on every entry. Use null for anything the text does not state — never omit a key, never invent a value.",
  '- "title" must always be a real, non-empty string. Skip any entry you cannot title from the text.',
  '- "startDate" and "endDate" must be "YYYY-MM" (or "YYYY-MM-DD" when a day is actually stated), or null. Never guess a month or a year. An ongoing role has endDate null.',
  '- "details" is the description text for that entry, copied or lightly condensed from the export. Null when the entry has no description.',
  '- "outcome" is ONLY for an explicit, measurable result stated in the text (a number, percentage, rank or award). If no measurable result is written down, it is null.',
  `- "skills" are skill names from the Skills section plus skills explicitly named inside descriptions. Names only, no sentences. At most ${MAX_SKILL_ITEMS}.`,
  `- At most ${MAX_EVIDENCE_ITEMS} evidence entries. Prefer the most recent and most substantial.`,
  "",
  "GROUNDING — THIS IS THE MOST IMPORTANT RULE: use ONLY facts present in the extracted profile text below. Never invent employers, job titles, dates, schools, tools, metrics or achievements. Do not exaggerate seniority or scope. Omit anything the text does not contain rather than filling a gap.",
  "",
  "INPUT LIMITATION: the input is text from LinkedIn's 'Save profile as PDF' export. Section order may be flattened and some sections may be missing entirely. If a section appears absent, treat it as absent rather than assuming its content.",
  "",
  UNTRUSTED_CONTENT_RULES,
].join("\n")

/**
 * One extraction call over the PDF text. Returns raw model output — nothing is
 * persisted here, and nothing extracted is treated as confirmed: the caller
 * lands every row as a CANDIDATE for the user to vouch for.
 */
export async function extractCareerFacts(
  pdfText: string,
  /** Owner of the upload, recorded with the call's token usage. */
  userId: string
): Promise<LinkedinImportExtraction> {
  const profileText = pdfText.slice(0, MAX_PROFILE_TEXT_LENGTH)

  const { object } = await generateObjectTracked({
    schema: linkedinImportSchema,
    tracking: {
      feature: AI_USAGE_FEATURES.CAREER_IMPORT,
      surface: "app",
      userId,
    },
    system: SYSTEM_PROMPT,
    prompt: `Extract the career facts from this LinkedIn profile text:\n${fenceUntrusted(
      "LINKEDIN_PROFILE_PDF",
      profileText
    )}`,
  })

  return object
}

// ─── Pure mapping ───────────────────────────────────────────────────────────

/** A row ready for `careerEvidence.createMany`, minus the profile id. */
export interface MappedEvidence {
  kind: CareerEvidenceKind
  title: string
  organization: string | null
  details: string | null
  outcome: string | null
  startDate: Date | null
  endDate: Date | null
}

function capped(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

/**
 * Turns a model-supplied date string into the UTC midnight `Date` the `@db.Date`
 * columns expect. A month-only value becomes the first of that month; anything
 * that is not a real calendar date in one of the two accepted shapes becomes
 * null rather than a silently rolled-forward date (`new Date("2026-02-31")` is
 * 2 March).
 */
export function parseImportedDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()

  const monthOnly = /^(\d{4})-(\d{2})$/.exec(trimmed)
  if (monthOnly) {
    const year = Number(monthOnly[1])
    const month = Number(monthOnly[2])
    if (month < 1 || month > 12) return null
    return new Date(Date.UTC(year, month - 1, 1))
  }

  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!full) return null
  const year = Number(full[1])
  const month = Number(full[2])
  const day = Number(full[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }
  return parsed
}

/**
 * Normalises extracted evidence to the shape and the field caps the manual
 * evidence form already enforces. Untitled entries are dropped: a row the user
 * cannot recognise is worse than a missing one.
 */
export function mapImportedEvidence(
  items: LinkedinImportExtraction["evidence"]
): MappedEvidence[] {
  const mapped: MappedEvidence[] = []
  for (const item of items.slice(0, MAX_EVIDENCE_ITEMS)) {
    const title = capped(item.title, TITLE_MAX)
    if (!title) continue
    mapped.push({
      kind: item.kind,
      title,
      organization: capped(item.organization, ORGANIZATION_MAX),
      details: capped(item.details, DETAILS_MAX),
      outcome: capped(item.outcome, OUTCOME_MAX),
      startDate: parseImportedDate(item.startDate),
      endDate: parseImportedDate(item.endDate),
    })
  }
  return mapped
}

/** A skill name may not read like a sentence; real names are short. */
const MAX_SKILL_WORDS = 5

/**
 * Rejects extraction noise that is clearly not a skill name: sentence
 * fragments ("Led triage for the unit"), clauses with list punctuation, and
 * strings with no letters. Real names — "CI/CD", "C++", "Node.js", "Public
 * Health Emergency Preparedness" — all pass.
 */
export function isPlausibleSkillName(name: string): boolean {
  if (!/\p{L}/u.test(name)) return false
  if (/[,;:!?]/.test(name)) return false
  if (/\.$|\.\s/.test(name)) return false
  return name.split(/\s+/).length <= MAX_SKILL_WORDS
}

/** Strips diacritics and lowercases, the shared first step of both keys. */
function foldCase(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

/**
 * Dedupe key for a skill name: case- and diacritic-insensitive with dots,
 * hyphens, underscores and spaces removed, so "Node.js", "NodeJS" and
 * "node js" collapse to one key — while "C", "C++" and "C#" stay distinct.
 */
function skillKey(name: string): string {
  return foldCase(name).replace(/[.\-_\s]+/g, "")
}

/**
 * Loose text key for evidence fields: case- and diacritic-insensitive with
 * punctuation collapsed to single spaces, so "Acme, Inc." matches "Acme Inc".
 */
function looseKey(value: string): string {
  return foldCase(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/**
 * Trims, caps, filters noise and de-duplicates skill names (case-,
 * diacritic- and separator-insensitively), in order.
 */
export function mapImportedSkills(names: LinkedinImportExtraction["skills"]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of names.slice(0, MAX_SKILL_ITEMS)) {
    const name = capped(raw, SKILL_NAME_MAX)
    if (!name) continue
    if (!isPlausibleSkillName(name)) continue
    const key = skillKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }
  return result
}

/** Dedupe key for evidence: kind + title + organization, loosely normalized. */
function evidenceKey(
  kind: CareerEvidenceKind,
  title: string,
  organization: string | null
): string {
  return `${kind} ${looseKey(title)} ${looseKey(organization ?? "")}`
}

// ─── Persistence ────────────────────────────────────────────────────────────

export interface CareerImportCounts {
  evidenceCreated: number
  evidenceSkipped: number
  capabilitiesCreated: number
  capabilitiesSkipped: number
}

/**
 * Writes the extraction into the caller's own career profile.
 *
 * Everything lands unvouched-for: evidence as `CANDIDATE` with the
 * LINKEDIN_IMPORT_CANDIDATE source, capabilities unconfirmed. This deliberately
 * does not go through `createEvidence`, which pins USER_ENTERED/CONFIRMED
 * because it only ever serves first-party typing.
 *
 * Duplicates are compared with loose normalization (case, diacritics and
 * separator characters) — the database uniqueness that backs `skipDuplicates`
 * is exact-match, so "react" or "Node JS" would otherwise slip past an
 * existing "React"/"Node.js", and a re-import would otherwise double rows.
 */
export async function persistCareerImport(
  userId: string,
  extracted: LinkedinImportExtraction
): Promise<CareerImportCounts> {
  const profileId = await getOrCreateCareerProfileId(userId)

  const evidence = mapImportedEvidence(extracted.evidence)
  const skills = mapImportedSkills(extracted.skills)

  // ── Evidence ──────────────────────────────────────────────────────────────
  const existingEvidence = await prisma.careerEvidence.findMany({
    where: { careerProfileId: profileId },
    select: { kind: true, title: true, organization: true },
  })
  const evidenceKeys = new Set(
    existingEvidence.map((row) => evidenceKey(row.kind, row.title, row.organization))
  )

  const freshEvidence: MappedEvidence[] = []
  for (const item of evidence) {
    const key = evidenceKey(item.kind, item.title, item.organization)
    // Also guards against the model emitting the same entry twice in one run.
    if (evidenceKeys.has(key)) continue
    evidenceKeys.add(key)
    freshEvidence.push(item)
  }

  let evidenceCreated = 0
  if (freshEvidence.length > 0) {
    const result = await prisma.careerEvidence.createMany({
      data: freshEvidence.map((item) => ({
        careerProfileId: profileId,
        kind: item.kind,
        title: item.title,
        organization: item.organization,
        details: item.details,
        outcome: item.outcome,
        startDate: item.startDate,
        endDate: item.endDate,
        // Provenance is server-decided. An import is a claim made by a document,
        // not by the user, so it stays a candidate until explicitly confirmed.
        source: CareerEvidenceSource.LINKEDIN_IMPORT_CANDIDATE,
        status: CareerEvidenceStatus.CANDIDATE,
      })),
    })
    evidenceCreated = result.count
  }

  // ── Capabilities ─────────────────────────────────────────────────────────
  const existingCapabilities = await prisma.careerCapability.findMany({
    where: { careerProfileId: profileId },
    select: { name: true },
  })
  const capabilityKeys = new Set(
    existingCapabilities.map((row) => skillKey(row.name))
  )
  const freshSkills = skills.filter((name) => !capabilityKeys.has(skillKey(name)))

  let capabilitiesCreated = 0
  if (freshSkills.length > 0) {
    const result = await prisma.careerCapability.createMany({
      data: freshSkills.map((name) => ({
        careerProfileId: profileId,
        name,
        // An imported skill is not a self-assessment and is never confirmed.
        confirmed: false,
      })),
      skipDuplicates: true,
    })
    capabilitiesCreated = result.count
  }

  return {
    evidenceCreated,
    evidenceSkipped: evidence.length - evidenceCreated,
    capabilitiesCreated,
    capabilitiesSkipped: skills.length - capabilitiesCreated,
  }
}
