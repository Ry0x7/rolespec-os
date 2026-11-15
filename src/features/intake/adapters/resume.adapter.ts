import { prisma } from "@/shared/lib/prisma"
import { importResumeText } from "@/features/resume/services/import-resume-text"
import { mapResumeToCareerFacts } from "@/features/career-profile/services/import-resume.service"
import { normalizeDateString, parsedResumeToDrafts } from "../lib/parsed-resume-patches"
import { IntakeAdapterError } from "../types"
import type {
  ContactField,
  IntakeAdapter,
  IntakePatchDraft,
  IntakeProvenance,
} from "../types"

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function dateString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

const CONTACT_FIELDS: Array<[ContactField, string]> = [
  ["contactFullName", "fullName"],
  ["contactEmail", "email"],
  ["contactPhone", "phone"],
  ["contactLocation", "location"],
  ["linkedinUrl", "linkedin"],
  ["githubUrl", "github"],
  ["websiteUrl", "website"],
]

function contactDrafts(
  content: Record<string, unknown> | null,
  provenance: IntakeProvenance
): IntakePatchDraft[] {
  if (!content) return []
  const drafts: IntakePatchDraft[] = []
  for (const [field, key] of CONTACT_FIELDS) {
    const raw = text(content[key])
    if (!raw) continue
    const max =
      field === "contactEmail"
        ? 320
        : field === "contactPhone"
          ? 50
          : field === "linkedinUrl" ||
              field === "githubUrl" ||
              field === "websiteUrl"
            ? 500
            : 200
    const value = raw.slice(0, max)
    const valid =
      field === "contactEmail"
        ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        : field === "linkedinUrl" || field === "githubUrl" || field === "websiteUrl"
          ? /^https?:\/\/\S+$/i.test(value)
          : true
    if (!valid) continue
    drafts.push({
      kind: "CONTACT",
      data: { field, value },
      confidence: 90,
      provenance: { ...provenance, locator: `contact:${field}` },
    })
  }
  return drafts
}

/**
 * Reads either a stored resume (its sections are already structured) or text
 * extracted by the upload route. Both paths produce the same drafts; the stored
 * path does not re-parse the document.
 */
export const resumeIntakeAdapter: IntakeAdapter = {
  source: "RESUME",
  label: "Resume",
  async run({ input, userId, signal, reportProgress }) {
    if (signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }
    const resumeId = text(input.resumeId)
    const pastedText = text(input.text)
    const fileName = text(input.fileName)
    const fetchedAt = new Date().toISOString()
    const provenance: IntakeProvenance = {
      adapter: resumeId ? "resume-record" : "resume-text",
      sourceUrl: null,
      fileName,
      externalId: resumeId,
      locator: null,
      fetchedAt,
      detail: null,
    }

    await reportProgress(15, "Reading resume")

    if (resumeId) {
      const resume = await prisma.resume.findFirst({
        where: { id: resumeId, userId },
        select: {
          id: true,
          title: true,
          sections: {
            orderBy: { order: "asc" },
            select: {
              type: true,
              title: true,
              order: true,
              items: {
                orderBy: { order: "asc" },
                select: { content: true, order: true },
              },
            },
          },
        },
      })
      if (!resume) throw new IntakeAdapterError("INVALID_INPUT", "Resume not found")

      await reportProgress(55, "Matching resume sections")
      const facts = mapResumeToCareerFacts({
        resumeId: resume.id,
        resumeTitle: resume.title,
        sections: resume.sections,
      })
      const contactSection = resume.sections.find((section) => section.type === "CONTACT")
      const contact = contactSection?.items[0]?.content
      const drafts: IntakePatchDraft[] = contactDrafts(
        contact && typeof contact === "object" && !Array.isArray(contact)
          ? (contact as Record<string, unknown>)
          : null,
        provenance
      )

      for (const [index, item] of facts.evidence.entries()) {
        drafts.push({
          kind: "EVIDENCE",
          data: {
            evidenceKind: item.kind,
            title: item.title,
            organization: item.organization,
            details: item.details?.slice(0, 4000) ?? null,
            outcome: item.outcome,
            startDate: dateString(item.startDate),
            endDate: dateString(item.endDate),
          },
          confidence: 85,
          provenance: { ...provenance, locator: `experience:${index + 1}` },
        })
      }
      for (const capability of facts.capabilities) {
        drafts.push({
          kind: "SKILL",
          data: { name: capability.name, category: capability.category },
          confidence: 75,
          provenance: { ...provenance, locator: `skill:${capability.name}` },
        })
      }

      await reportProgress(100, "Resume facts ready")
      return {
        patches: drafts,
        warnings:
          drafts.length === 0
            ? ["This resume has no durable facts yet. Add them manually."]
            : undefined,
        meta: { resumeId: resume.id, sectionCount: resume.sections.length },
      }
    }

    if (!pastedText) {
      throw new IntakeAdapterError(
        "INVALID_INPUT",
        "Choose a resume or paste its text."
      )
    }

    let parsed
    try {
      parsed = importResumeText(pastedText)
    } catch {
      throw new IntakeAdapterError(
        "INVALID_INPUT",
        "That resume did not contain readable text. Paste the text or add facts manually."
      )
    }

    await reportProgress(70, "Normalizing facts")
    const { drafts, warnings } = parsedResumeToDrafts(parsed, {
      source: "RESUME",
      adapter: provenance.adapter,
      provenance: { sourceUrl: null, fileName, externalId: null, fetchedAt, detail: null },
      confidence: 85,
    })

    await reportProgress(100, "Resume facts ready")
    return {
      patches: drafts,
      warnings:
        drafts.length === 0
          ? ["No durable facts were found in that resume. Add them manually."]
          : warnings,
      meta: {
        fileName,
        experienceCount: parsed.experience?.length ?? 0,
        skillCount: drafts.filter((draft) => draft.kind === "SKILL").length,
      },
    }
  },
}

/** Exported for tests that want the date rule without the adapter shell. */
export const resumeDateString = normalizeDateString
