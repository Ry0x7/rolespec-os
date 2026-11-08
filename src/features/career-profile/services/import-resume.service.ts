import type {
  CareerEvidenceKind,
  SectionType,
} from "@/generated/prisma/enums"
import { prisma } from "@/shared/lib/prisma"

/**
 * Deterministic resume → Career Profile import.
 *
 * A resume is a document that makes claims; it is not the user vouching for
 * them. Every row produced here is therefore written as
 * `RESUME_IMPORT_CANDIDATE` + `CANDIDATE`, with the source resume recorded in
 * metadata so the review screen can explain where a fact came from. Nothing is
 * confirmed automatically and no AI is involved.
 */

export interface ResumeImportSectionItem {
  content: unknown
  order: number
}

export interface ResumeImportSection {
  type: SectionType | string
  title: string
  order: number
  items: ResumeImportSectionItem[]
}

export interface MappedEvidence {
  kind: CareerEvidenceKind
  title: string
  organization: string | null
  details: string | null
  outcome: null
  startDate: Date | null
  endDate: Date | null
  metadata: { sourceResumeId: string; sourceResumeTitle: string }
}

export interface MappedCapability {
  name: string
  category: string | null
}

export interface MappedResumeFacts {
  evidence: MappedEvidence[]
  capabilities: MappedCapability[]
}

const TITLE_MAX = 200
const ORGANIZATION_MAX = 200
const DETAILS_MAX = 5000
const CAPABILITY_MAX = 120

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function capped(value: string | null, max: number): string | null {
  if (!value) return null
  return value.slice(0, max).trim() || null
}

/**
 * Resume dates are stored as `YYYY-MM` (month pickers) or `YYYY-MM-DD`.
 * A month-only value becomes the first day of that month in UTC, matching the
 * `@db.Date` columns. Anything else — including an impossible date such as
 * 2026-02-31 — becomes null rather than a silently rolled-forward date.
 */
export function parseResumeDate(value: unknown): Date | null {
  const raw = text(value)
  if (!raw) return null

  const monthOnly = /^(\d{4})-(\d{2})$/.exec(raw)
  if (monthOnly) {
    const year = Number(monthOnly[1])
    const month = Number(monthOnly[2])
    if (month < 1 || month > 12) return null
    return new Date(Date.UTC(year, month - 1, 1))
  }

  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!full) return null
  const year = Number(full[1])
  const month = Number(full[2])
  const day = Number(full[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const parsed = new Date(Date.UTC(year, month - 1, day))
  const roundTrips =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  return roundTrips ? parsed : null
}

/** Bullets joined as the editable multi-line detail block the evidence card uses. */
function joinBullets(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const lines = value
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return null
  return capped(lines.join("\n"), DETAILS_MAX)
}

/** Case- and accent-insensitive evidence key: kind + title + organization. */
export function evidenceKey(input: {
  kind: string
  title: string
  organization: string | null
}): string {
  return `${input.kind}\u0000${loose(input.title)}\u0000${loose(input.organization ?? "")}`
}

/** Same folding rule as the LinkedIn importer's skill dedupe. */
export function capabilityKey(name: string): string {
  return fold(name).replace(/[.\-_\s]+/g, "")
}

function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function loose(value: string): string {
  return fold(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function evidence(
  input: Omit<MappedEvidence, "metadata" | "outcome">,
  provenance: { sourceResumeId: string; sourceResumeTitle: string }
): MappedEvidence {
  return {
    ...input,
    outcome: null,
    metadata: provenance,
  }
}

/**
 * Pure mapping from resume sections to unconfirmed career facts. Sections that
 * do not describe durable history (contact, summary, custom text) are ignored.
 */
export function mapResumeToCareerFacts(input: {
  resumeId: string
  resumeTitle: string
  sections: ResumeImportSection[]
}): MappedResumeFacts {
  const provenance = {
    sourceResumeId: input.resumeId,
    sourceResumeTitle: input.resumeTitle,
  }

  const evidenceRows: MappedEvidence[] = []
  const capabilities: MappedCapability[] = []
  const evidenceSeen = new Set<string>()
  const capabilitySeen = new Set<string>()

  const sections = [...input.sections].sort((a, b) => a.order - b.order)

  for (const section of sections) {
    const items = [...section.items].sort((a, b) => a.order - b.order)

    for (const item of items) {
      const content = asRecord(item.content)

      if (section.type === "EXPERIENCE") {
        const title = capped(
          text(content.role) ?? text(content.title),
          TITLE_MAX
        )
        if (!title) continue
        const organization = capped(
          text(content.company) ?? text(content.organization),
          ORGANIZATION_MAX
        )
        const row = evidence(
          {
            kind: "EXPERIENCE",
            title,
            organization,
            details: joinBullets(content.bullets),
            startDate: parseResumeDate(content.startDate),
            endDate:
              content.current === true ? null : parseResumeDate(content.endDate),
          },
          provenance
        )
        pushEvidence(row)
      } else if (section.type === "EDUCATION") {
        const title = capped(
          text(content.degree) ?? text(content.title) ?? text(content.field),
          TITLE_MAX
        )
        if (!title) continue
        const organization = capped(text(content.school), ORGANIZATION_MAX)
        const row = evidence(
          {
            kind: "EDUCATION",
            title,
            organization,
            details: null,
            startDate: parseResumeDate(content.startDate),
            endDate: parseResumeDate(content.graduationDate),
          },
          provenance
        )
        pushEvidence(row)
      } else if (section.type === "PROJECTS") {
        const title = capped(
          text(content.name) ?? text(content.title),
          TITLE_MAX
        )
        if (!title) continue
        const row = evidence(
          {
            kind: "PROJECT",
            title,
            organization: null,
            details: joinBullets(content.bullets),
            startDate: parseResumeDate(content.startDate),
            endDate: parseResumeDate(content.endDate),
          },
          provenance
        )
        pushEvidence(row)
      } else if (section.type === "CERTIFICATIONS") {
        const title = capped(
          text(content.name) ?? text(content.title),
          TITLE_MAX
        )
        if (!title) continue
        const row = evidence(
          {
            kind: "CERTIFICATION",
            title,
            organization: capped(
              text(content.organization) ?? text(content.issuer),
              ORGANIZATION_MAX
            ),
            details: null,
            startDate: null,
            endDate: parseResumeDate(content.dateObtained),
          },
          provenance
        )
        pushEvidence(row)
      } else if (section.type === "SKILLS") {
        if (!Array.isArray(content.skills)) continue
        const category = capped(text(content.category), CAPABILITY_MAX)
        for (const raw of content.skills) {
          const name = capped(text(raw), CAPABILITY_MAX)
          if (!name) continue
          const key = capabilityKey(name)
          if (!key || capabilitySeen.has(key)) continue
          capabilitySeen.add(key)
          capabilities.push({ name, category })
        }
      }
    }
  }

  return { evidence: evidenceRows, capabilities }

  function pushEvidence(row: MappedEvidence): void {
    const key = evidenceKey(row)
    if (evidenceSeen.has(key)) return
    evidenceSeen.add(key)
    evidenceRows.push(row)
  }
}

/** Resumes the owner can import, newest first. */
export async function listImportableResumes(userId: string) {
  return prisma.resume.findMany({
    where: { userId, status: { not: "ARCHIVED" } },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, title: true, variant: true, updatedAt: true },
  })
}
