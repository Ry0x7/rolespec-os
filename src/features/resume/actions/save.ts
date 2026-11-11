"use server"

import { z } from "zod"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { hashSections } from "../tailoring/snapshot"
import type { ResumeSectionSnapshot } from "../tailoring/types"
import { redirect } from "next/navigation"

interface SectionItemInput {
  id: string
  content: Record<string, unknown>
  metadata?: Record<string, unknown> | null
  order: number
}

interface SectionInput {
  id: string
  type: string
  title: string
  order: number
  visible: boolean
  items: SectionItemInput[]
}

// ── Client payload validation ───────────────────────────────────────────────
// The editor sends whatever its store holds, so the payload is untrusted: the
// interfaces above are erased at runtime and cannot be relied on. Caps mirror
// the ones in analyze-ats.ts.

const MAX_SECTIONS = 40
const MAX_ITEMS_PER_SECTION = 100
const MAX_ID_LENGTH = 200
const MAX_SECTION_TYPE_LENGTH = 60
const MAX_TITLE_LENGTH = 300
const MAX_SECTIONS_PAYLOAD_CHARS = 200_000

const jsonObjectSchema = z.record(z.string(), z.unknown())

const sectionItemSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
  content: jsonObjectSchema,
  metadata: jsonObjectSchema.nullable().optional(),
  order: z.number().int(),
})

const sectionSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
  type: z.string().max(MAX_SECTION_TYPE_LENGTH),
  title: z.string().max(MAX_TITLE_LENGTH),
  order: z.number().int(),
  visible: z.boolean(),
  items: z.array(sectionItemSchema).max(MAX_ITEMS_PER_SECTION),
})

const sectionsSchema = z.array(sectionSchema).max(MAX_SECTIONS)

export async function saveResume(
  resumeId: string,
  sections: SectionInput[],
  options?: {
    /**
     * The version the editor loaded. When present, a mismatch is refused
     * instead of overwriting a revision another tab or the agent saved.
     */
    baseVersion?: number
  }
) {
  const session = await auth()
  if (!session?.user) redirect("/unlock")

  // ── Validate the client-supplied sections ─────────────────────────────────
  if (JSON.stringify(sections ?? null).length > MAX_SECTIONS_PAYLOAD_CHARS) {
    return { error: "Resume content is too large to save." }
  }
  const parsed = sectionsSchema.safeParse(sections)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid resume content." }
  }
  const parsedSections = parsed.data

  // Archived (soft-deleted) resumes are treated as gone, same as a foreign id.
  const resume = await prisma.resume.findUnique({
    where: { id: resumeId, userId: session.user.id, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      version: true,
      updatedAt: true,
      sections: {
        select: {
          id: true,
          type: true,
          title: true,
          order: true,
          visible: true,
          items: { select: { id: true, content: true, metadata: true, order: true } },
        },
      },
    },
  })

  if (!resume) {
    return { error: "Resume not found" }
  }

  // Optimistic concurrency: the editor sends the version it read. Refusing a
  // stale save is the only way two tabs cannot silently overwrite each other.
  if (options?.baseVersion !== undefined && options.baseVersion !== resume.version) {
    return {
      error: "This resume changed elsewhere. Reload the editor before saving.",
      conflict: true,
      currentVersion: resume.version,
    }
  }

  // Never write to sections the caller doesn't own — every id must belong to
  // this resume. Without this the deleteMany below would wipe another user's
  // section items.
  const ownedSectionIds = new Set(resume.sections.map((s) => s.id))
  const allSectionsOwned = parsedSections.every((section) => ownedSectionIds.has(section.id))

  if (!allSectionsOwned) {
    return { error: "Section not found" }
  }

  // Same rule for item ids: the upsert below would otherwise overwrite an
  // arbitrary row. An id already inside this resume is fine, and an id that
  // exists nowhere is fine to create under the section validated above — but an
  // id that exists on some other resume is a cross-tenant write.
  const ownedItemIds = new Set(
    resume.sections.flatMap((s) => s.items.map((item) => item.id))
  )
  const foreignCandidateIds = parsedSections.flatMap((section) =>
    section.items
      .map((item) => item.id)
      .filter((id) => !id.startsWith("temp-") && !ownedItemIds.has(id))
  )

  if (foreignCandidateIds.length > 0) {
    const existing = await prisma.resumeSectionItem.findMany({
      where: { id: { in: foreignCandidateIds } },
      select: { id: true },
    })
    if (existing.length > 0) {
      return { error: "Item not found" }
    }
  }

  // Maps temp-* client IDs → real DB IDs so the store can reconcile after save
  const idMap: Record<string, string> = {}

  const currentSections: ResumeSectionSnapshot[] = resume.sections.map((section) => ({
    id: section.id,
    type: section.type,
    title: section.title,
    order: section.order,
    visible: section.visible,
    items: section.items.map((item) => ({
      id: item.id,
      content:
        item.content && typeof item.content === "object" && !Array.isArray(item.content)
          ? (item.content as Record<string, unknown>)
          : {},
      ...(item.metadata === undefined ? {} : { metadata: item.metadata }),
      order: item.order,
    })),
  }))
  const beforeHash = hashSections(currentSections)
  const afterHash = hashSections(parsedSections as unknown as ResumeSectionSnapshot[])
  const changed = beforeHash !== afterHash

  // Every item write and the resume revision bump commit together, and the
  // revision is claimed by the exact `updatedAt` that was read. Two tabs that
  // both loaded the same revision cannot interleave item upserts and deletes:
  // the second transaction sees a newer timestamp and is refused.
  const committed = await prisma.$transaction(async (tx) => {
    const claimed = await tx.resume.updateMany({
      where: {
        id: resumeId,
        userId: session.user.id,
        status: { not: "ARCHIVED" },
        updatedAt: resume.updatedAt,
      },
      data: {
        updatedAt: new Date(),
        ...(changed ? { version: { increment: 1 } } : {}),
      },
    })
    if (claimed.count === 0) {
      const current = await tx.resume.findFirst({
        where: { id: resumeId, userId: session.user.id },
        select: { version: true },
      })
      return { conflict: true as const, currentVersion: current?.version }
    }

    for (const section of parsedSections) {
      for (const item of section.items) {
        const isTemp = item.id.startsWith("temp-")

        if (isTemp) {
          const created = await tx.resumeSectionItem.create({
            data: {
              sectionId: section.id,
              content: item.content as Prisma.InputJsonValue,
              metadata: item.metadata as Prisma.InputJsonValue | undefined,
              order: item.order,
            },
            select: { id: true },
          })
          idMap[item.id] = created.id
        } else {
          await tx.resumeSectionItem.upsert({
            where: { id: item.id },
            create: {
              sectionId: section.id,
              content: item.content as Prisma.InputJsonValue,
              metadata: item.metadata as Prisma.InputJsonValue | undefined,
              order: item.order,
            },
            update: {
              content: item.content as Prisma.InputJsonValue,
              metadata: item.metadata as Prisma.InputJsonValue | undefined,
              order: item.order,
            },
          })
        }
      }

      const keepIds = section.items
        .map((i) => (i.id.startsWith("temp-") ? idMap[i.id] : i.id))
        .filter((id): id is string => !!id)

      await tx.resumeSectionItem.deleteMany({
        where: {
          sectionId: section.id,
          id: { notIn: keepIds },
        },
      })
    }

    const updated = await tx.resume.findFirst({
      where: { id: resumeId },
      select: { version: true },
    })
    return { conflict: false as const, version: updated?.version }
  })

  if (committed.conflict) {
    return {
      error: "This resume changed elsewhere. Reload the editor before saving.",
      conflict: true,
      currentVersion: committed.currentVersion,
    }
  }

  const updated = { version: committed.version }

  if (changed) {
    const versionBefore = resume.version ?? 1
    const versionAfter = updated?.version ?? versionBefore + 1
    try {
      await prisma.resumeEditEvent.create({
        data: {
          resumeId,
          userId: session.user.id,
          kind: "MANUAL_EDIT",
          versionBefore,
          versionAfter,
          summary: `Manual edit saved (${parsedSections.length} section${parsedSections.length === 1 ? "" : "s"})`,
          metadata: {
            sections: parsedSections.length,
            items: parsedSections.reduce((total, section) => total + section.items.length, 0),
            beforeHash,
            afterHash,
          },
        },
      })
    } catch {
      // The content is already saved; losing the audit row must not turn a
      // successful save into a user-visible failure. The next save retries it.
    }
  }

  return {
    success: true,
    idMap,
    version: updated?.version,
    changed,
  }
}
