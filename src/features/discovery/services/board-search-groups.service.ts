import type { LoadedCareerProfile } from "@/features/career-profile/services/career-profile.service"

import { buildBoardSearchLinks, type BoardSearchLink } from "./board-search-links.service"
import { deriveDiscoveryQueries } from "./derive-queries.service"

/** One derived discovery query and its board search links. */
export interface BoardSearchGroup {
  role: string
  links: BoardSearchLink[]
}

/** The Career Profile fields the groups are built from. */
export type BoardSearchProfile = Pick<
  LoadedCareerProfile,
  "targetRoles" | "capabilities" | "locations" | "workModes" | "experienceLevel"
>

/**
 * Board search links for every derived discovery query, plus the number of
 * distinct active target roles — what a run would search if nothing were
 * capped, so a surface can say why some of the user's roles are missing.
 *
 * Shared by `/jobs/discover` and `GET /api/extension/search-links` so both
 * show the same links. Pure: no I/O.
 */
export function buildBoardSearchGroups(profile: BoardSearchProfile): {
  groups: BoardSearchGroup[]
  activeTargetRoleCount: number
} {
  const queries = deriveDiscoveryQueries(profile.targetRoles, profile.capabilities)
  const groups = queries.map((query) => ({
    role: query.role,
    links: buildBoardSearchLinks({
      role: query.role,
      keywords: query.keywords ?? [],
      locations: profile.locations ?? [],
      workModes: profile.workModes ?? [],
      experienceLevel: profile.experienceLevel ?? null,
    }),
  }))
  const activeTargetRoleCount = new Set(
    profile.targetRoles
      .filter((role) => role.active && role.title.trim().length > 0)
      .map((role) => role.title.replace(/\s+/g, " ").trim().toLowerCase())
  ).size

  return { groups, activeTargetRoleCount }
}
