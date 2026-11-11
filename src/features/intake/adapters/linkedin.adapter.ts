import {
  extractCareerFacts,
  mapImportedEvidence,
  mapImportedSkills,
} from "@/features/career-profile/services/import-linkedin.service"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import { importResumeText } from "@/features/resume/services/import-resume-text"
import { parsedResumeToDrafts } from "../lib/parsed-resume-patches"
import { IntakeAdapterError } from "../types"
import type { IntakeAdapter, IntakePatchDraft } from "../types"

function dateString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

/**
 * LinkedIn's own export is the only source. This never signs in, scrapes a
 * profile URL or bypasses an access restriction; if the user has no export, the
 * UI offers the manual profile form instead.
 */
export const linkedinIntakeAdapter: IntakeAdapter = {
  source: "LINKEDIN",
  label: "LinkedIn export",
  async run({ input, userId, signal, reportProgress }) {
    if (signal.aborted) {
      throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
    }
    const text = typeof input.text === "string" ? input.text.trim() : ""
    if (!text) {
      throw new IntakeAdapterError(
        "INVALID_INPUT",
        "Upload your LinkedIn export or paste its text."
      )
    }
    const fileName = typeof input.fileName === "string" ? input.fileName : null
    const useAi = input.useAi === true
    const fetchedAt = new Date().toISOString()

    await reportProgress(15, "Reading LinkedIn export")
    let parsed
    try {
      parsed = importResumeText(text)
    } catch {
      parsed = null
    }

    const deterministic = parsed
      ? parsedResumeToDrafts(parsed, {
          source: "LINKEDIN",
          adapter: "linkedin-export",
          provenance: {
            sourceUrl: null,
            fileName,
            externalId: null,
            fetchedAt,
            detail: "LinkedIn data export supplied by the user",
          },
          confidence: 80,
        })
      : { drafts: [], warnings: [] }

    const hasEvidence = deterministic.drafts.some((draft) => draft.kind === "EVIDENCE")
    if (hasEvidence || !useAi) {
      await reportProgress(100, "LinkedIn facts ready")
      return {
        patches: deterministic.drafts,
        warnings:
          deterministic.drafts.length === 0
            ? [
                "No structured facts were found. Paste a fuller export, or add the facts manually.",
              ]
            : deterministic.warnings,
        meta: { fileName, mode: "deterministic" },
      }
    }

    // Optional AI structuring, only after the user asked for it. Any provider
    // problem degrades to the deterministic result instead of failing the run.
    await reportProgress(45, "Structuring exported profile")
    try {
      const extraction = await extractCareerFacts(text, userId)
      if (signal.aborted) {
        throw new IntakeAdapterError("CANCELLED", "This intake run was cancelled.")
      }
      const drafts: IntakePatchDraft[] = deterministic.drafts.filter(
        (draft) => draft.kind === "CONTACT"
      )
      for (const [index, item] of mapImportedEvidence(extraction.evidence).entries()) {
        drafts.push({
          kind: "EVIDENCE",
          data: {
            evidenceKind: item.kind,
            title: item.title,
            organization: item.organization,
            details: item.details,
            outcome: item.outcome,
            startDate: dateString(item.startDate),
            endDate: dateString(item.endDate),
          },
          confidence: 75,
          provenance: {
            adapter: "linkedin-export-ai",
            sourceUrl: null,
            fileName,
            externalId: null,
            locator: `evidence:${index + 1}`,
            fetchedAt,
            detail: "Structured from the user's LinkedIn export with AI",
          },
        })
      }
      for (const name of mapImportedSkills(extraction.skills)) {
        drafts.push({
          kind: "SKILL",
          data: { name, category: null },
          confidence: 65,
          provenance: {
            adapter: "linkedin-export-ai",
            sourceUrl: null,
            fileName,
            externalId: null,
            locator: `skill:${name}`,
            fetchedAt,
            detail: "Structured from the user's LinkedIn export with AI",
          },
        })
      }
      await reportProgress(100, "LinkedIn facts ready")
      return {
        patches: drafts,
        warnings:
          drafts.length === 0
            ? ["No durable facts were found. Add them manually."]
            : [
                "AI-structured facts are lower confidence. Review each one before applying.",
              ],
        meta: { fileName, mode: "ai" },
      }
    } catch (error) {
      const message =
        error instanceof AiKeyRequiredError || error instanceof AiDailyLimitError
          ? error.message
          : "AI structuring was unavailable; the export was read without it."
      await reportProgress(100, "LinkedIn facts ready")
      return {
        patches: deterministic.drafts,
        warnings: [message],
        meta: { fileName, mode: "deterministic-fallback" },
      }
    }
  },
}
