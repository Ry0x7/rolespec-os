import type { WebScanFacts } from "@/features/career-profile/services/web-presence.service"
import type { IntakePatchDraft } from "../types"

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

function provenanceUrl(metadata: Record<string, unknown>): string | null {
  const value = metadata.sourceUrl
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null
}

/**
 * Pure mapping for both web adapters. The scan already decided which
 * technologies are actually present; this only turns them into review rows.
 */
export function webFactsToDrafts(
  facts: WebScanFacts,
  options: {
    adapter: string
    sourceUrl: string
    fetchedAt: string
    confidence?: number
    externalId?: string | null
  }
): IntakePatchDraft[] {
  const evidenceConfidence = options.confidence ?? 70
  const drafts: IntakePatchDraft[] = []

  for (const fact of facts.evidence) {
    const sourceUrl = provenanceUrl(fact.metadata) ?? options.sourceUrl
    drafts.push({
      kind: "EVIDENCE",
      data: {
        evidenceKind: fact.kind,
        title: fact.title,
        organization: fact.organization,
        details: fact.details?.slice(0, 4000) ?? null,
        outcome: null,
        startDate: isoDate(fact.startDate),
        endDate: isoDate(fact.endDate),
      },
      confidence: evidenceConfidence,
      provenance: {
        adapter: options.adapter,
        sourceUrl,
        externalId: options.externalId ?? null,
        fileName: null,
        locator: fact.title,
        fetchedAt: options.fetchedAt,
        detail: null,
      },
    })
  }

  for (const capability of facts.capabilities) {
    drafts.push({
      kind: "SKILL",
      data: { name: capability.name, category: capability.category },
      // A listed language or an explicit technology mention is stronger than a
      // project description that happens to contain a keyword.
      confidence: Math.max(50, evidenceConfidence - 10),
      provenance: {
        adapter: options.adapter,
        sourceUrl: options.sourceUrl,
        externalId: options.externalId ?? null,
        fileName: null,
        locator: `technology:${capability.name}`,
        fetchedAt: options.fetchedAt,
        detail: null,
      },
    })
  }

  return drafts
}

/** Shared by the adapters so an empty scan is never presented as success. */
export function webScanWarnings(
  evidenceCount: number,
  capabilityCount: number
): string[] {
  const warnings: string[] = []
  if (evidenceCount === 0) warnings.push("No public projects were found.")
  if (capabilityCount === 0) warnings.push("No recognized technologies were found.")
  return warnings
}

