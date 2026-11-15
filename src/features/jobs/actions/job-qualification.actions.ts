"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { Prisma } from "@/generated/prisma/client"
import { auth } from "@/features/auth/config"
import { readQualificationProfileRow } from "@/features/discovery/services/qualification-profile.service"
import { toStoredQualification } from "@/features/discovery/services/qualification-snapshot.service"
import {
  qualifyCandidate,
  toQualificationProfile,
  type QualificationVerdict,
} from "@/features/discovery/services/qualify.service"
import { prisma } from "@/shared/lib/prisma"

import { updateJobApplicationWithJob } from "../services/job-record.service"

export type RecheckJobQualificationResult =
  | { success: true; verdict: QualificationVerdict; checkedAt: string }
  | { error: string }

/**
 * Re-runs the deterministic qualification for one tracked application against
 * the user's *current* Career Profile and replaces the stored snapshot.
 *
 * `Job.qualification` is written once at save time, so a profile edit (or a
 * rule change) leaves older rows explaining themselves with wording the product
 * no longer uses, and rows saved before snapshots existed carry no verdict at
 * all. This is the user-initiated way to bring one row up to date — it is never
 * automatic, because a snapshot is meant to record what the user was told when
 * they decided.
 *
 * No AI and no network: the same pure `qualifyCandidate` pass discovery runs,
 * which is why there is no rate limit here (the risk re-check has one because
 * every run of it is a model round trip).
 */
export async function recheckJobQualification(
  jobApplicationId: string
): Promise<RecheckJobQualificationResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }

  const parsed = z.string().min(1).safeParse(jobApplicationId)
  if (!parsed.success) return { error: "Invalid input" }

  const userId = session.user.id

  try {
    const application = await prisma.jobApplication.findUnique({
      where: { id: parsed.data, userId },
      select: {
        id: true,
        job: {
          select: {
            title: true,
            companyName: true,
            description: true,
            location: true,
            workType: true,
            url: true,
            canonicalUrl: true,
          },
        },
      },
    })
    if (!application) return { error: "Job application not found" }

    const profileRow = await readQualificationProfileRow(userId)
    if (!profileRow) {
      return { error: "Add your Career Profile first — the check is run against it." }
    }

    const job = application.job
    const qualification = qualifyCandidate(
      {
        title: job.title,
        companyName: job.companyName,
        // The URL only feeds the posting's own heuristics; a manually added job
        // may not have one, and an empty string is the honest "no link".
        url: job.canonicalUrl ?? job.url ?? "",
        ...(job.location ? { location: job.location } : {}),
        ...(job.workType ? { workType: job.workType } : {}),
        // A job with no description still qualifies — fewer answers, not a
        // failure, so this is not a prerequisite the way the risk check is.
        ...(job.description ? { description: job.description } : {}),
      },
      toQualificationProfile(profileRow)
    )

    const snapshot = toStoredQualification(qualification)

    // The snapshot describes the posting, so it lands on the `Job` row — the
    // paired write is what keeps job-based readers (tracker, dashboard) in step.
    await updateJobApplicationWithJob(
      { id: application.id, userId },
      // Same cast every other writer of this column uses: the service types the
      // field as the column's JSON input so discovery does not have to import it.
      { qualification: snapshot as unknown as Prisma.InputJsonValue }
    )

    revalidatePath(`/jobs/${application.id}`)
    revalidatePath("/jobs")
    revalidatePath("/dashboard")

    return {
      success: true as const,
      verdict: snapshot.verdict,
      checkedAt: snapshot.checkedAt,
    }
  } catch {
    // Anything else could carry infra detail, so it stays generic.
    return { error: "Something went wrong. Please try again." }
  }
}
