"use server"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import type { SectionType } from "@/generated/prisma/enums"

const MAX_SECTIONS = 12

const SECTION_TITLES: Record<string, string> = {
  CONTACT: "Contact",
  SUMMARY: "Summary",
  EXPERIENCE: "Experience",
  EDUCATION: "Education",
  SKILLS: "Skills",
  PROJECTS: "Projects",
  CERTIFICATIONS: "Certifications",
  CUSTOM: "Custom Section",
}

export async function addResumeSection(
  resumeId: string,
  type: SectionType,
  title?: string
): Promise<{ id: string; error?: string }> {
  const session = await auth()
  if (!session?.user) redirect("/sign-in")

  // Archived (soft-deleted) resumes are treated as gone, same as a foreign id.
  const resume = await prisma.resume.findUnique({
    where: { id: resumeId, userId: session.user.id, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      sections: {
        select: { id: true, type: true, order: true },
      },
    },
  })

  if (!resume) {
    return { id: "", error: "Resume not found" }
  }

  if (resume.sections.length >= MAX_SECTIONS) {
    return { id: "", error: `Maximum of ${MAX_SECTIONS} sections allowed` }
  }

  if (type !== "CUSTOM") {
    const exists = resume.sections.some((s) => s.type === type)
    if (exists) {
      return { id: "", error: `A ${SECTION_TITLES[type] ?? type} section already exists` }
    }
  }

  // After the highest existing order, not at the count: deletes leave gaps, so
  // the count can equal the last section's order.
  const nextOrder = resume.sections.reduce((max, s) => Math.max(max, s.order + 1), 0)

  const section = await prisma.resumeSection.create({
    data: {
      resumeId,
      type,
      title: title ?? SECTION_TITLES[type] ?? "Custom Section",
      order: nextOrder,
      visible: true,
    },
  })

  revalidatePath(`/resumes/${resumeId}`)
  return { id: section.id }
}

export async function removeResumeSection(
  resumeId: string,
  sectionId: string
): Promise<{ error?: string }> {
  const session = await auth()
  if (!session?.user) redirect("/sign-in")

  const section = await prisma.resumeSection.findUnique({
    where: { id: sectionId },
    select: {
      id: true,
      type: true,
      resume: { select: { userId: true, status: true } },
    },
  })

  // A section on an archived (soft-deleted) resume is treated as gone too.
  if (
    !section ||
    section.resume.userId !== session.user.id ||
    section.resume.status === "ARCHIVED"
  ) {
    return { error: "Section not found" }
  }

  if (section.type === "CONTACT") {
    return { error: "Contact section cannot be removed" }
  }

  await prisma.resumeSectionItem.deleteMany({
    where: { sectionId },
  })

  await prisma.resumeSection.delete({
    where: { id: sectionId },
  })

  revalidatePath(`/resumes/${resumeId}`)
  return {}
}

export async function reorderResumeSections(
  resumeId: string,
  orderedIds: string[]
): Promise<{ error?: string }> {
  const session = await auth()
  if (!session?.user) redirect("/sign-in")

  // Archived (soft-deleted) resumes are treated as gone, same as a foreign id.
  const resume = await prisma.resume.findUnique({
    where: { id: resumeId, userId: session.user.id, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      sections: { select: { id: true } },
    },
  })

  if (!resume) {
    return { error: "Resume not found" }
  }

  // Never write to sections the caller doesn't own — every id must belong to
  // this resume.
  const ownedIds = new Set(resume.sections.map((s) => s.id))
  const allOwned = orderedIds.every((id) => ownedIds.has(id))

  if (!allOwned) {
    return { error: "Section not found" }
  }

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.resumeSection.update({
        where: { id },
        data: { order: index },
      })
    )
  )

  revalidatePath(`/resumes/${resumeId}`)
  return {}
}
