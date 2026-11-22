"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"

import { setJobFeedbackSchema, type SetJobFeedbackInput } from "../schemas/feedback.schema"

export type SetJobFeedbackResult =
  | { success: true; postingKey: string; verdict: SetJobFeedbackInput["verdict"] }
  | { error: string }

/**
 * One explicit user verdict about one posting.
 *
 * Clearing (`verdict: null`) deletes the row rather than storing a neutral
 * value, so "no feedback" and "I looked and said irrelevant" remain different
 * facts. Nothing here edits evidence, capabilities, or application status.
 */
export async function setJobFeedback(
  input: SetJobFeedbackInput
): Promise<SetJobFeedbackResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  const userId = session.user.id

  const parsed = setJobFeedbackSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid feedback" }
  }

  const data = parsed.data
  // The key is chosen by the server-rendered surface that showed the control:
  // a discovered posting's canonical URL, or a saved job's stable id fallback.
  // Re-deriving it here from the URL would disagree with the ranking lookup on
  // a saved job whose canonical URL is null. It is scoped by `userId`, so a
  // forged key can only affect the caller's own feedback.
  const postingKey = data.postingKey

  // A client can name any job id; only one this user owns may be linked. The
  // verdict itself is still the user's, so it is kept even when the job is gone.
  let ownedJobId: string | null = null
  if (data.jobId) {
    const job = await prisma.job.findFirst({
      where: { id: data.jobId, userId },
      select: { id: true },
    })
    ownedJobId = job?.id ?? null
  }

  try {
    if (data.verdict === null) {
      await prisma.jobFeedback.deleteMany({ where: { userId, postingKey } })
    } else {
      await prisma.jobFeedback.upsert({
        where: { userId_postingKey: { userId, postingKey } },
        create: {
          userId,
          postingKey,
          jobId: ownedJobId,
          title: data.title,
          companyName: data.companyName,
          url: data.url ?? null,
          verdict: data.verdict,
          note: data.note ?? null,
        },
        update: {
          jobId: ownedJobId,
          title: data.title,
          companyName: data.companyName,
          url: data.url ?? null,
          verdict: data.verdict,
          note: data.note ?? null,
        },
      })
    }

    revalidatePath("/jobs")
    revalidatePath("/jobs/discover")
    revalidatePath("/dashboard")
    return { success: true, postingKey, verdict: data.verdict }
  } catch {
    return { error: "Could not save your feedback. Please try again." }
  }
}
