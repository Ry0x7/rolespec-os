import { redirect } from "next/navigation"

import { auth } from "@/features/auth/config"
import { loadCareerProfile } from "@/features/career-profile/services/career-profile.service"
import { BoardSearchLinks } from "@/features/discovery/components/board-search-links"
import { DiscoveryView } from "@/features/discovery/components/discovery-view"
import { buildBoardSearchGroups } from "@/features/discovery/services/board-search-groups.service"
import { resolveProfileCountry } from "@/features/discovery/services/market-fit.service"
import { parsePreferences } from "@/features/settings/schemas/preferences.schema"
import { PageShell } from "@/shared/components/page-shell"
import { prisma } from "@/shared/lib/prisma"

/**
 * Job discovery. The searches are derived here so the page can show what will
 * run before the user commits to a run; the run itself is a server action, so
 * no third-party request happens on page load.
 */
export default async function DiscoverJobsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const [profile, user] = await Promise.all([
    loadCareerProfile(session.user.id),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferences: true },
    }),
  ])
  // `activeTargetRoleCount` is what the run would search if nothing were
  // capped, so the page can say why some of the user's roles are missing.
  const { groups: boardSearchGroups, activeTargetRoleCount } = buildBoardSearchGroups(profile)
  const { atsWatchlist } = parsePreferences(user?.preferences)

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl font-bold">Discover</h1>
        <p className="text-sm text-muted-foreground">
          Postings found from the target roles in your Career Profile. Save the
          ones worth tracking — nothing is applied to for you.
        </p>
      </div>

      <DiscoveryView
        queries={boardSearchGroups.map((group) => group.role)}
        activeTargetRoleCount={activeTargetRoleCount}
        atsWatchlist={atsWatchlist}
        requiresSponsorship={profile.requiresSponsorship === true}
        marketCountry={resolveProfileCountry(profile.locations ?? [])}
      />

      <BoardSearchLinks groups={boardSearchGroups} />
    </PageShell>
  )
}
