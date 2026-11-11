import { prisma } from "@/shared/lib/prisma"
import { decryptAnswerValue } from "@/shared/lib/answer-crypto"

/**
 * Assembles everything the app holds about one user, for the data-portability
 * right the privacy policy commits to.
 *
 * Two rules shape what is included:
 *
 * 1. **Everything the privacy policy claims we hold.** If a category is listed
 *    there and missing here, the export is a false statement. The shape below is
 *    deliberately parallel to that list.
 * 2. **Nothing that belongs to someone else.** Only rows owned by this user are
 *    included; nothing about any other user.
 *
 * No credentials are exported. The workspace has no account password, and API
 * tokens are stored only as hashes, which are deliberately omitted.
 */

export interface UserDataExport {
  exportedAt: string
  format: 1
  account: Record<string, unknown>
  profile: Record<string, unknown> | null
  resumes: unknown[]
  atsAnalyses: unknown[]
  exports: unknown[]
  careerProfile: Record<string, unknown> | null
  jobs: unknown[]
  jobApplications: unknown[]
  coverLetters: unknown[]
  todos: unknown[]
  notes: unknown[]
  profileRatings: unknown[]
  linkedinSuggestions: unknown[]
  activityEvents: unknown[]
  aiUsageEvents: unknown[]
  intakeRuns: unknown[]
  workflowRuns: unknown[]
  reviewTasks: unknown[]
  atsPreparations: unknown[]
  atsAnswers: unknown[]
  resumeTailoringRuns: unknown[]
  resumeSnapshots: unknown[]
  resumeValidations: unknown[]
  resumeEditEvents: unknown[]
}

export async function exportUserData(userId: string): Promise<UserDataExport | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      preferences: true,
      createdAt: true,
      updatedAt: true,
      profile: true,
      // The canonical career source, with the evidence and capability joins that
      // explain each fact. Without it the export would miss the data the
      // Career Profile surface is built on.
      careerProfile: {
        include: {
          roleFamilies: true,
          targetRoles: { orderBy: [{ active: "desc" }, { priority: "asc" }] },
          evidence: {
            include: { capabilityLinks: true },
            orderBy: { createdAt: "asc" },
          },
          capabilities: {
            include: { evidenceLinks: true },
            orderBy: { name: "asc" },
          },
        },
      },
      jobs: true,
      resumes: {
        include: {
          sections: { include: { items: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
        },
      },
      atsAnalyses: true,
      resumeExports: true,
      // The posting itself lives on `job` now — applications created since the
      // Job/Application split no longer mirror it, so without the relation the
      // export would carry an application with no company, title or description.
      jobApplications: { include: { job: true, statusEvents: { orderBy: { createdAt: "asc" } } } },
      coverLetters: true,
      todos: true,
      notes: true,
      profileRatings: true,
      linkedinSuggestions: true,
      activityEvents: { orderBy: { createdAt: "asc" } },
      intakeRuns: {
        include: {
          sources: true,
          patches: { include: { corrections: true } },
          conflicts: true,
        },
        orderBy: { createdAt: "asc" },
      },
      workflowRuns: {
        include: { steps: true, events: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      reviewTasks: { orderBy: { createdAt: "asc" } },
      atsPreparations: true,
      atsAnswers: true,
      resumeTailoringRuns: true,
      resumeSnapshots: true,
      resumeValidations: true,
      resumeEditEvents: true,
    },
  })

  if (!user) return null

  const {
    profile,
    careerProfile,
    jobs,
    resumes,
    atsAnalyses,
    resumeExports,
    jobApplications,
    coverLetters,
    todos,
    notes,
    profileRatings,
    linkedinSuggestions,
    activityEvents,
    intakeRuns,
    workflowRuns,
    reviewTasks,
    atsPreparations,
    atsAnswers,
    resumeTailoringRuns,
    resumeSnapshots,
    resumeValidations,
    resumeEditEvents,
    ...account
  } = user

  // AI usage rows have no User relation; they are keyed by the owner id.
  const aiUsageEvents = await prisma.aiUsageEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  })

  const decryptForExport = (value: unknown) => {
    try {
      return decryptAnswerValue(value)
    } catch {
      // Never export ciphertext as if it were an answer, and never fail the
      // whole account export because one old row was written with another key.
      return { unreadable: true }
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    // Bumped if the shape changes, so a previously downloaded file stays readable.
    format: 1,
    account,
    profile,
    careerProfile,
    jobs,
    resumes,
    atsAnalyses,
    exports: resumeExports,
    jobApplications,
    coverLetters,
    todos,
    notes,
    profileRatings,
    linkedinSuggestions,
    activityEvents,
    aiUsageEvents,
    intakeRuns,
    workflowRuns,
    reviewTasks: reviewTasks.map((task) => ({
      ...task,
      answer: decryptForExport(task.answer),
    })),
    atsPreparations,
    atsAnswers: atsAnswers.map((answer) => ({
      ...answer,
      value: decryptForExport(answer.value),
    })),
    resumeTailoringRuns,
    resumeSnapshots,
    resumeValidations,
    resumeEditEvents,
  }
}

/** `rolespec-export-2026-08-10.json` — dated so repeated downloads do not collide. */
export function exportFilename(now: Date = new Date()): string {
  return `rolespec-export-${now.toISOString().slice(0, 10)}.json`
}
