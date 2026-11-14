import { extractJobRequirements } from "@/features/jobs/services/job-requirements.service"
import { prisma } from "@/shared/lib/prisma"

import type { WorkflowExecutor } from "../types"
import {
  loadWorkflowApplication,
  missingApplicationOutcome,
} from "./context"

/**
 * PREPARE_ATS builds a deterministic field plan from facts the user already
 * stored. It never answers a sensitive ATS question: work authorization,
 * sponsorship, pay expectations, demographics and legal history are listed as
 * questions for the human, even when the profile contains related text.
 */
export const prepareAtsExecutor: WorkflowExecutor = async (context) => {
  const application = await loadWorkflowApplication(
    context.userId,
    context.jobApplicationId
  )
  if (!application) return missingApplicationOutcome("preparing ATS fields")

  const [profile, account] = await Promise.all([
    prisma.careerProfile.findUnique({
      where: { userId: context.userId },
      select: {
        contactFullName: true,
        contactEmail: true,
        contactPhone: true,
        contactLocation: true,
        linkedinUrl: true,
        githubUrl: true,
        websiteUrl: true,
        requiresSponsorship: true,
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
        salaryPeriod: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: context.userId },
      select: { name: true, email: true },
    }),
  ])

  const fields: Record<string, string> = {}
  const fullName = profile?.contactFullName ?? account?.name ?? null
  const email = profile?.contactEmail ?? account?.email ?? null
  if (fullName) fields.fullName = fullName
  if (email) fields.email = email
  if (profile?.contactPhone) fields.phone = profile.contactPhone
  if (profile?.contactLocation) fields.location = profile.contactLocation
  if (profile?.linkedinUrl) fields.linkedinUrl = profile.linkedinUrl
  if (profile?.githubUrl) fields.githubUrl = profile.githubUrl
  if (profile?.websiteUrl) fields.websiteUrl = profile.websiteUrl
  if (application.resumeId ?? context.input.resumeId) {
    fields.resumeId = application.resumeId ?? context.input.resumeId!
  }
  if (application.job.url) fields.jobUrl = application.job.url

  const missingFields = [
    !fullName ? "fullName" : null,
    !email ? "email" : null,
    !profile?.contactPhone ? "phone" : null,
  ].filter((field): field is string => Boolean(field))

  const storedFlags = Array.isArray(application.job.requirementFlags)
    ? application.job.requirementFlags.filter(
        (flag): flag is string => typeof flag === "string"
      )
    : []
  const requirementFlags =
    storedFlags.length > 0
      ? storedFlags
      : extractJobRequirements({
          jobDescription: application.job.description,
          location: application.job.location,
        })

  // Deliberately always asked, never auto-answered from `workAuthorization`.
  const needsUserAnswer = [
    {
      field: "workAuthorization",
      question: "Are you authorized to work in the job's country without sponsorship?",
      reason: "Work authorization must be answered by you; the workflow will not infer it.",
    },
    {
      field: "sponsorship",
      question:
        profile?.requiresSponsorship === null
          ? "Do you require visa sponsorship?"
          : "Does this employer sponsor the visa you would need?",
      reason:
        profile?.requiresSponsorship === null
          ? "Your profile does not state whether you need sponsorship."
          : "The posting and your profile preference do not settle this question.",
    },
    {
      field: "salaryExpectation",
      question: "What salary expectation should be entered on this application?",
      reason:
        profile?.salaryMin === null
          ? "No salary preference is stored in your profile."
          : "Salary expectations are a personal answer, not a profile default.",
    },
    {
      field: "demographics",
      question: "Which voluntary demographic answers do you want to provide?",
      reason: "Demographic questions are optional and must be answered by you.",
    },
    {
      field: "legalHistory",
      question: "Do any legal-history questions apply to you?",
      reason: "Legal-history answers are sensitive and are never generated.",
    },
  ]

  return {
    status: "COMPLETED",
    summary: `Prepared ${Object.keys(fields).length} known ATS fields and ${needsUserAnswer.length} questions for you.`,
    output: {
      fields,
      missingFields,
      needsUserAnswer,
      requirementFlags,
      postingUrlAvailable: Boolean(application.job.url),
      resumeExportReady: false,
    },
  }
}
