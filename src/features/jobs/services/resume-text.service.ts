import { prisma } from "@/shared/lib/prisma"
import { sanitizeCandidateName } from "@/shared/lib/prompts/candidate-name"
import type { Section } from "@/features/resume/hooks/use-resume-store"
import { serializeResumeForCoverLetter } from "./cover-letter.service"

/**
 * Loading a user's resume as plain text is the first step of every email/letter
 * generator (cold email, application email, and the extension's outreach route).
 * It lived as an identical copy in each action; it lives here so the ordering,
 * the ARCHIVED filter and the "newest resume" fallback cannot drift apart.
 *
 * The failure is returned as a reason rather than copy: a server action and an
 * API route word the same miss differently.
 */
export type LoadResumeTextResult =
  | {
      ok: true
      resumeText: string
      /**
       * The candidate's own name, for the sign-off. Deliberately NOT part of
       * `resumeText`: that string is fenced as untrusted document data in every
       * prompt, and a sign-off cannot be written from inside the fence. It is
       * also why the rest of the contact block (email, phone, address) stays
       * out — only the name is needed, so only the name travels.
       *
       * `null` when neither the resume's contact section nor the account has a
       * usable one; the generators then take their nameless path.
       */
      candidateName?: string | null
    }
  /** A `resumeId` was given but no live resume of the user matches it. */
  | { ok: false; reason: "RESUME_NOT_FOUND" }
  /** No `resumeId` was given and the user owns no live resume at all. */
  | { ok: false; reason: "NO_RESUME" }

const sectionsInclude = {
  sections: {
    include: { items: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  },
} as const

export async function loadResumeTextForUser(
  userId: string,
  resumeId?: string
): Promise<LoadResumeTextResult> {
  const resume = resumeId
    ? await prisma.resume.findFirst({
        where: { id: resumeId, userId, status: { not: "ARCHIVED" } },
        include: sectionsInclude,
      })
    : await prisma.resume.findFirst({
        where: { userId, status: { not: "ARCHIVED" } },
        orderBy: { updatedAt: "desc" },
        include: sectionsInclude,
      })

  if (!resume) return { ok: false, reason: resumeId ? "RESUME_NOT_FOUND" : "NO_RESUME" }

  const sections: Section[] = resume.sections.map((s) => ({
    id: s.id,
    resumeId: s.resumeId,
    type: s.type,
    title: s.title,
    order: s.order,
    visible: s.visible,
    items: s.items.map((i) => ({
      id: i.id,
      sectionId: i.sectionId,
      content: i.content as Record<string, unknown>,
      order: i.order,
    })),
  }))

  return {
    ok: true,
    resumeText: serializeResumeForCoverLetter(sections),
    candidateName: await resolveCandidateName(userId, sections),
  }
}

/**
 * The resume's own contact name first, the account name second.
 *
 * Visibility is ignored on purpose: hiding the contact block is a decision about
 * how the resume PRINTS, and it must not silently strip the applicant's name off
 * the emails they send. The account lookup only runs when the resume has no
 * usable name, so the common path stays one query.
 *
 * Exported because the cover-letter action does not go through
 * `loadResumeTextForUser` — it builds its own `sections` — and must not end up
 * with a second, subtly different rule for the same value.
 */
export async function resolveCandidateName(
  userId: string,
  sections: Section[]
): Promise<string | null> {
  const contact = sections.find((section) => section.type === "CONTACT")
  const fromResume = sanitizeCandidateName(contact?.items[0]?.content.fullName)
  if (fromResume) return fromResume

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  })
  return sanitizeCandidateName(user?.name)
}
