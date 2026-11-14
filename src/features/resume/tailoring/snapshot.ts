import { createHash } from "node:crypto"

import type {
  ResumeSectionSnapshot,
  SourceSnapshotPayload,
} from "./types"

/**
 * Deterministic snapshot helpers for tailoring provenance.
 *
 * A generated resume must be restorable to the EXACT source revision it was
 * built from, even if that source has been edited since. The snapshot payload
 * is therefore treated as immutable data: canonical JSON in, SHA-256 out, and
 * no field that changes on every read (timestamps come from the caller).
 */

export const SNAPSHOT_SCHEMA_VERSION = 1

interface SnapshotSource {
  id: string
  version?: number | null
  title: string
  template: string
  targetRole?: string | null
  targetCompany?: string | null
  sections: ResumeSectionSnapshot[]
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue
      out[key] = canonicalValue(record[key])
    }
    return out
  }
  return value
}

/** Stable JSON: sorted keys, no undefined members, no whitespace variance. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/** Captures the source revision used for one tailoring run. */
export function buildSourceSnapshot(
  source: SnapshotSource,
  capturedAt: Date = new Date()
): SourceSnapshotPayload {
  return {
    sourceResumeId: source.id,
    sourceVersion: source.version ?? 1,
    capturedAt: capturedAt.toISOString(),
    title: source.title,
    template: source.template,
    targetRole: source.targetRole ?? null,
    targetCompany: source.targetCompany ?? null,
    sections: source.sections.map((section) => ({
      ...(section.id ? { id: section.id } : {}),
      type: section.type,
      title: section.title,
      order: section.order,
      visible: section.visible,
      items: section.items.map((item) => ({
        ...(item.id ? { id: item.id } : {}),
        content: item.content ?? {},
        ...(item.metadata === undefined ? {} : { metadata: item.metadata }),
        order: item.order,
      })),
    })),
  }
}

/**
 * Hash of the schema version plus the payload's canonical content. `capturedAt`
 * is deliberately included: two captures of the same revision at different
 * times are still two distinct, auditable events, and the hash names that event.
 */
export function hashSourceSnapshot(payload: SourceSnapshotPayload): string {
  return sha256Hex(canonicalJson({ schema: SNAPSHOT_SCHEMA_VERSION, payload }))
}

/** Same canonical hash over arbitrary section content (edit history, tests). */
export function hashSections(sections: ResumeSectionSnapshot[]): string {
  return sha256Hex(
    canonicalJson(
      sections.map((section) => ({
        type: section.type,
        title: section.title,
        order: section.order,
        visible: section.visible,
        items: section.items.map((item) => ({
          content: item.content,
          ...(item.metadata === undefined || item.metadata === null
            ? {}
            : { metadata: item.metadata }),
          order: item.order,
        })),
      }))
    )
  )
}

/**
 * The sections to write back on restore. Ids are intentionally dropped: they
 * belong to the source row at capture time and may since have been reused or
 * deleted, while the content is the part that must be restored exactly.
 */
export function restoreSectionsFromSnapshot(
  payload: SourceSnapshotPayload
): ResumeSectionSnapshot[] {
  return payload.sections.map((section, sectionIndex) => ({
    type: section.type,
    title: section.title,
    order: section.order ?? sectionIndex,
    visible: section.visible !== false,
    items: section.items.map((item, itemIndex) => ({
      content: item.content ?? {},
      ...(item.metadata === undefined ? {} : { metadata: item.metadata }),
      order: item.order ?? itemIndex,
    })),
  }))
}

/** Parses a stored JSON value as a source snapshot, or returns null. */
export function parseSourceSnapshot(value: unknown): SourceSnapshotPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    typeof record.sourceResumeId !== "string" ||
    typeof record.sourceVersion !== "number" ||
    typeof record.title !== "string" ||
    typeof record.template !== "string" ||
    !Array.isArray(record.sections)
  ) {
    return null
  }
  return record as unknown as SourceSnapshotPayload
}
