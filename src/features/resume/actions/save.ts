"use server"

import { z } from "zod"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
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

export async function saveResume(resumeId: string, sections: SectionInput[]) {
  const session = await auth()
  if (!session?.user) redirect("/sign-in")

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
      sections: { select: { id: true, items: { select: { id: true } } } },
    },
  })

  if (!resume) {
    return { error: "Resume not found" }
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

  for (const section of parsedSections) {
    for (const item of section.items) {
      const isTemp = item.id.startsWith("temp-")

      if (isTemp) {
        const created = await prisma.resumeSectionItem.create({
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
        await prisma.resumeSectionItem.upsert({
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

    await prisma.resumeSectionItem.deleteMany({
      where: {
        sectionId: section.id,
        id: { notIn: keepIds },
      },
    })
  }

  await prisma.resume.update({
    where: { id: resumeId },
    data: { updatedAt: new Date() },
  })

  return { success: true, idMap }
}
