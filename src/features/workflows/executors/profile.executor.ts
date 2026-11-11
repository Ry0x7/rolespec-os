import { prisma } from "@/shared/lib/prisma"

import type { WorkflowExecutor } from "../types"

/**
 * PROFILE gate.
 *
 * The rest of the pipeline is about one role the user actually wants, so this
 * step only reads the Career Profile and refuses to invent a target. It never
 * creates or edits the profile; a missing target role becomes a specific review
 * task with the manual path, not a failed run.
 */
export const profileExecutor: WorkflowExecutor = async ({ userId }) => {
  const profile = await prisma.careerProfile.findUnique({
    where: { userId },
    select: {
      updatedAt: true,
      contactEmail: true,
      contactPhone: true,
      salaryMin: true,
      salaryMax: true,
      targetRoles: {
        where: { active: true },
        select: { title: true },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      },
      capabilities: { select: { name: true, confirmed: true } },
      evidence: { where: { status: "CONFIRMED" }, select: { id: true } },
    },
  })

  const targetRoles = profile?.targetRoles.filter((role) => role.title.trim()) ?? []
  if (targetRoles.length === 0) {
    return {
      status: "WAITING_FOR_USER",
      review: {
        kind: "MISSING_PROFILE_FACT",
        question: "Which role are you targeting?",
        reason:
          "The assisted pipeline needs at least one active target role in your Career Profile so ranking and research have a goal.",
        category: "target-role",
        fallback: "Add a target role in Career Profile, then resume this workflow.",
      },
    }
  }

  const confirmedCapabilities = (profile?.capabilities ?? []).filter(
    (capability) => capability.confirmed
  ).length

  return {
    status: "COMPLETED",
    summary: `Profile ready with ${targetRoles.length} target role(s) and ${confirmedCapabilities} confirmed skill(s).`,
    output: {
      targetRoles: targetRoles.length,
      confirmedCapabilities,
      confirmedEvidence: profile?.evidence.length ?? 0,
      hasContactEmail: Boolean(profile?.contactEmail),
      hasContactPhone: Boolean(profile?.contactPhone),
      salaryConfigured: profile?.salaryMin !== null && profile?.salaryMin !== undefined,
      updatedAt: profile?.updatedAt.toISOString() ?? null,
    },
  }
}
