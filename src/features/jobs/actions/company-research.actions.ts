"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/features/auth/config"
import { logger } from "@/shared/lib/logger"
import { prisma } from "@/shared/lib/prisma"
import type { CompanyResearchResult } from "../services/company-research.service"
import {
  researchJob,
  type ThreeLayerResearch,
} from "../services/three-layer-research.service"

const log = logger("company-research-actions")

export async function runCompanyResearch(
  jobApplicationId: string
): Promise<
  | { success: true; research: CompanyResearchResult; layers: ThreeLayerResearch }
  | { success: false; error: string }
> {
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
    // Three layers, one call: posting requirements, verified company facts and
    // a source-linked culture read. The company result keeps the shape the job
    // page already renders; the layer payload is stored beside it.
    const layers = await researchJob({
      userId: session.user.id,
      companyName: application.job.companyName,
      jobTitle: application.job.title,
      url: application.job.url,
      location: application.job.location,
      description: application.job.description,
    })
    const research = layers.company

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
            researchLayers: layers,
          })
        ),
      },
    })

    revalidatePath(`/jobs/${jobApplicationId}`)
    return { success: true, research, layers }
  } catch (err) {
    // Provider and database errors can carry endpoint, key or query detail. The
    // action logs them for the operator and gives the user an actionable line.
    log.error("Company research failed", { err, userId: session.user.id, jobApplicationId })
    return {
      success: false,
      error: "Company research failed. Please try again.",
    }
  }
}
