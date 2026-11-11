import { prisma } from "@/shared/lib/prisma"
import { buildBoardSearchLinks } from "@/features/discovery/services/board-search-links.service"
import { deriveDiscoveryQueries } from "@/features/discovery/services/derive-queries.service"

import type { WorkflowExecutor, WorkflowStepOutcome } from "../types"

/**
 * DISCOVER is an optional, no-network step.
 *
 * It turns the profile's active target roles into the same queries the discovery
 * run would use and the board links the user can open themselves. Reading live
 * sources belongs to the discovery feature, not to an application workflow, so
 * this step never fetches a page and never fails the run when there is nothing
 * to derive.
 */
export const discoveryExecutor: WorkflowExecutor = async ({ userId }) => {
  const profile = await prisma.careerProfile.findUnique({
    where: { userId },
    select: {
      locations: true,
      workModes: true,
      experienceLevel: true,
      targetRoles: {
        where: { active: true },
        select: { title: true, priority: true, active: true },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      },
      capabilities: { select: { name: true, confirmed: true } },
    },
  })

  const queries = deriveDiscoveryQueries(
    profile?.targetRoles ?? [],
    profile?.capabilities ?? []
  )
  if (queries.length === 0) {
    const skipped: WorkflowStepOutcome = {
      status: "SKIPPED",
      reason: "No active target role, so there is no discovery query to build.",
      output: { queries: [] },
    }
    return skipped
  }

  const links = queries.flatMap((query) =>
    buildBoardSearchLinks({
      role: query.role,
      keywords: query.keywords ?? [],
      locations: profile?.locations ?? [],
      workModes: profile?.workModes ?? [],
      experienceLevel: profile?.experienceLevel ?? null,
    }).map((link) => ({ ...link, role: query.role }))
  )

  return {
    status: "COMPLETED",
    summary: `Prepared ${queries.length} search query(s) and ${links.length} board link(s).`,
    output: {
      queries: queries.map((query) => ({
        role: query.role,
        keywords: query.keywords ?? [],
      })),
      links: links.map((link) => ({
        role: link.role,
        board: link.board,
        label: link.label,
        query: link.query,
        url: link.url,
      })),
    },
  }
}
