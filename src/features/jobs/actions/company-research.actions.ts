"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import {
  analyzeCompanyResearchAI,
  type CompanyResearchResult,
} from "../services/company-research.service"

export async function runCompanyResearch(
  jobApplicationId: string
): Promise<{ success: true; research: CompanyResearchResult } | { success: false; error: string }> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: "Authentication required" }
  }

  const application = await prisma.jobApplication.findFirst({
    where: { id: jobApplicationId, userId: session.user.id },
    include: { job: true },
  })

  if (!application) {
    return { success: false, error: "Application not found" }
  }

  try {
    const research = await analyzeCompanyResearchAI({
      userId: session.user.id,
      companyName: application.job.companyName,
      jobTitle: application.job.title,
      url: application.job.url,
      location: application.job.location,
      description: application.job.description,
    })

    const existingMatchResult =
      typeof application.matchResult === "object" && application.matchResult !== null && !Array.isArray(application.matchResult)
        ? (application.matchResult as Record<string, unknown>)
        : {}

    await prisma.jobApplication.update({
      where: { id: application.id, userId: session.user.id },
      data: {
        matchResult: JSON.parse(
          JSON.stringify({
            ...existingMatchResult,
            companyResearch: research,
          })
        ),
      },
    })

    revalidatePath(`/jobs/${jobApplicationId}`)
    return { success: true, research }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to run company research",
    }
  }
}
