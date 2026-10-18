"use server"

import { auth } from "@/features/auth/config"
import {
  findCareerProfileId,
  loadCareerProfile,
} from "@/features/career-profile/services/career-profile.service"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"
import {
  assembleMasterResume,
  type AssembledMasterResumeSection,
} from "../lib/assemble-master-resume"
import { polishMasterResume } from "../services/polish-master-resume"
import {
  createResumeSchema,
  createRoleFamilyResumeSchema,
  updateResumeSchema,
} from "../schemas/resume.schema"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

const log = logger("resume-actions")

const NO_PROFILE_ERROR =
  "Your career profile is not ready yet. Reload the page and try again."

/**
 * Sliding window for the create-time polish. Generous, because it caps a side
 * effect of resume creation rather than a button the user can hold down.
 */
const MASTER_POLISH_RATE_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 }

/**
 * Writes the generated summary into the SUMMARY section `assembleMasterResume`
 * creates empty. The shape is the one `SummaryPreview` and `summary-editor`
 * read, and the one `tailor.ts` writes: `items[0].content.text`.
 *
 * A resume with no SUMMARY section is returned untouched rather than grown one —
 * the assembler always emits it, so its absence means the caller passed
 * something this function has no business reshaping.
 */
function withSummary(
  sections: AssembledMasterResumeSection[],
  summary: string
): AssembledMasterResumeSection[] {
  return sections.map((section) => {
    if (section.type !== "SUMMARY") return section

    const [first, ...rest] = section.items.create
    return {
      ...section,
      items: {
        create: [
          first
            ? { ...first, content: { ...first.content, text: summary } }
            : { content: { text: summary }, order: 0 },
          ...rest,
        ],
      },
    }
  })
}

export async function createResume(formData: FormData) {
  const session = await auth()
  if (!session?.user) redirect("/sign-in")

  const raw = Object.fromEntries(formData)
  const parsed = createResumeSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() }
  }

  const profile = await loadCareerProfile(session.user.id)
  // `targetRoles` is loaded active-first, so the first active title is the one
  // the contact block and the polish context both want.
  const activeTargetRoles = profile.targetRoles
    .filter((role) => role.active)
    .map((role) => role.title)
  const assembled = assembleMasterResume(
    {
      evidence: profile.evidence,
      capabilities: profile.capabilities,
      targetRoleTitles: activeTargetRoles,
    },
    // The Career Profile's contact card is the source of truth for the header.
    // The session account is passed only as a name/email fallback, so a profile
    // with no contact details still avoids opening a new master resume on the
    // "add your contact information" state.
    {
      userName: session.user.name,
      userEmail: session.user.email,
      contactFullName: profile.contactFullName,
      contactEmail: profile.contactEmail,
      contactPhone: profile.contactPhone,
      contactLocation: profile.contactLocation,
      linkedinUrl: profile.linkedinUrl,
      githubUrl: profile.githubUrl,
      websiteUrl: profile.websiteUrl,
    }
  )

  // Polish is best-effort by design: a master resume assembled from raw profile
  // notes reads like notes, so the model gets one pass at it — but the resume is
  // created either way. A tripped limit, a missing key or a provider outage all
  // land on the same path as before this pass existed.
  let sections = assembled
  const polishAllowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.AI_MASTER_POLISH,
    session.user.id,
    MASTER_POLISH_RATE_LIMIT
  )
  if (!polishAllowed) {
    // The skip is silent in the UI, so it must not be silent in the logs — a
    // used-up limit and a failing provider produce the identical unpolished
    // resume, and only this line tells them apart.
    log.warn("Master resume polish skipped; hourly limit used up", {
      max: MASTER_POLISH_RATE_LIMIT.max,
      windowMs: MASTER_POLISH_RATE_LIMIT.windowMs,
    })
  } else {
    // `polishMasterResume` never throws; the try/catch guards the call itself.
    try {
      const polished = await polishMasterResume({
        userId: session.user.id,
        sections: assembled,
        // Read-only context, already loaded above. No extra query.
        profileContext: {
          careerGoals: profile.careerGoals,
          experienceLevel: profile.experienceLevel,
          targetRoles: activeTargetRoles,
        },
      })
      sections = polished.summary
        ? withSummary(polished.sections, polished.summary)
        : polished.sections
    } catch (err) {
      log.warn("Master resume polish threw; creating the unpolished resume", { err })
      sections = assembled
    }
  }

  const resume = await prisma.resume.create({
    data: {
      userId: session.user.id,
      // The master is assembled from this profile, so it records where it came from.
      careerProfileId: profile.id,
      title: parsed.data.title,
      targetRole: parsed.data.targetRole,
      targetCompany: parsed.data.targetCompany,
      template: parsed.data.template,
      sections: {
        create: sections,
      },
    },
  })

  revalidatePath("/resumes")
  redirect(`/resumes/${resume.id}`)
}

export async function createRoleFamilyResume(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const parsed = createRoleFamilyResumeSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() }
  }

  const profileId = await findCareerProfileId(session.user.id)
  if (!profileId) return { error: NO_PROFILE_ERROR }

  const roleFamily = await prisma.careerRoleFamily.findFirst({
    where: { id: parsed.data.roleFamilyId, careerProfileId: profileId },
    select: { id: true },
  })
  if (!roleFamily) return { error: "That role family does not exist." }

  // Ownership, source kind, and soft-delete state are one indistinguishable
  // not-found boundary so callers cannot probe another user's resumes.
  const source = await prisma.resume.findFirst({
    where: {
      id: parsed.data.sourceResumeId,
      userId: session.user.id,
      variant: "MASTER",
      status: { not: "ARCHIVED" },
    },
    select: {
      id: true,
      targetRole: true,
      template: true,
      sections: {
        select: {
          type: true,
          title: true,
          order: true,
          visible: true,
          items: {
            select: { content: true, metadata: true, order: true },
            orderBy: { order: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  })
  if (!source) return { error: "Resume not found" }

  // One nested create makes the resume, sections, and items atomic. Only the
  // factual section payload (including item metadata) and presentation template
  // cross this boundary; job-specific company targeting is deliberately reset.
  const resume = await prisma.resume.create({
    data: {
      userId: session.user.id,
      careerProfileId: profileId,
      roleFamilyId: roleFamily.id,
      // Lineage: the owner-verified master this copy was made from.
      sourceResumeId: source.id,
      variant: "ROLE_FAMILY",
      title: parsed.data.title,
      targetRole: source.targetRole,
      targetCompany: null,
      template: source.template,
      sections: {
        create: source.sections.map((section) => ({
          type: section.type,
          title: section.title,
          order: section.order,
          visible: section.visible,
          items: {
            create: section.items.map((item) => ({
              content: item.content as object,
              metadata: item.metadata === null ? undefined : item.metadata,
              order: item.order,
            })),
          },
        })),
      },
    },
  })

  revalidatePath("/resumes")
  redirect(`/resumes/${resume.id}`)
}

export async function updateResume(
  id: string,
  data: Record<string, unknown>
): Promise<{ error: string } | undefined> {
  const session = await auth()
  if (!session?.user) redirect("/sign-in")

  const parsed = updateResumeSchema.safeParse(data)
  if (!parsed.success) {
    return { error: "Invalid input" }
  }

  try {
    // updateMany so the ARCHIVED guard lives in the where clause: archived
    // (soft-deleted) resumes are treated as gone, same as a foreign id. A plain
    // update() would throw P2025 instead of returning a not-found result.
    const result = await prisma.resume.updateMany({
      where: { id, userId: session.user.id, status: { not: "ARCHIVED" } },
      data: parsed.data,
    })
    if (result.count === 0) {
      return { error: "Resume not found." }
    }
    revalidatePath("/resumes")
    revalidatePath(`/resumes/${id}`)
  } catch {
    return { error: "Failed to update resume. Please try again." }
  }
}

export async function deleteResume(id: string): Promise<{ error: string } | undefined> {
  const session = await auth()
  if (!session?.user) redirect("/sign-in")

  try {
    await prisma.resume.update({
      where: { id, userId: session.user.id },
      data: { status: "ARCHIVED" },
    })
    revalidatePath("/resumes")
  } catch {
    return { error: "Failed to delete resume. Please try again." }
  }
}

export async function restoreResume(id: string): Promise<{ error: string } | undefined> {
  const session = await auth()
  if (!session?.user) redirect("/sign-in")

  try {
    // updateMany so the ARCHIVED guard lives in the where clause: only rows
    // that are currently archived can be restored. Prior status isn't
    // recorded, so restore lands on the model default (DRAFT).
    const result = await prisma.resume.updateMany({
      where: { id, userId: session.user.id, status: "ARCHIVED" },
      data: { status: "DRAFT" },
    })
    if (result.count === 0) {
      return { error: "Resume not found." }
    }
    revalidatePath("/resumes")
  } catch {
    return { error: "Failed to restore resume. Please try again." }
  }
}

export async function duplicateResume(id: string) {
  const session = await auth()
  if (!session?.user) redirect("/sign-in")

  // Archived (soft-deleted) resumes can't be duplicated — restore first.
  const original = await prisma.resume.findUnique({
    where: { id, userId: session.user.id, status: { not: "ARCHIVED" } },
    include: {
      sections: {
        include: { items: true },
        orderBy: { order: "asc" },
      },
    },
  })

  if (!original) return { error: "Resume not found" }

  const copy = await prisma.resume.create({
    data: {
      userId: session.user.id,
      careerProfileId: original.careerProfileId,
      roleFamilyId: original.roleFamilyId,
      variant: original.variant,
      title: `${original.title} (Copy)`,
      targetRole: original.targetRole,
      targetCompany: original.targetCompany,
      template: original.template,
      sections: {
        create: original.sections.map((section) => ({
          type: section.type,
          title: section.title,
          order: section.order,
          visible: section.visible,
          items: {
            create: section.items.map((item) => ({
              content: item.content as object,
              metadata: item.metadata === null ? undefined : item.metadata,
              order: item.order,
            })),
          },
        })),
      },
    },
  })

  revalidatePath("/resumes")
  redirect(`/resumes/${copy.id}`)
}
