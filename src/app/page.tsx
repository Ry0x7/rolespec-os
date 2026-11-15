import { redirect } from "next/navigation"
import { requireUser } from "@/features/auth/guards"
import { prisma } from "@/shared/lib/prisma"

/**
 * The app opens straight into the workspace. There is no in-app marketing
 * landing page: the public overview is the GitHub Pages showcase, and repeating
 * it here only put a second click between the owner and their job search.
 *
 * First run (no completed onboarding) goes to /onboarding; every later launch
 * goes to /dashboard. `playerProfile.onboardedAt` is the one persisted flag
 * `completeOnboarding` writes and `/onboarding` already reads, so the two routes
 * cannot disagree about whether setup is finished.
 */
export default async function RootPage() {
  const session = await requireUser()

  const profile = await prisma.playerProfile.findUnique({
    where: { userId: session.user.id },
    select: { onboardedAt: true },
  })

  redirect(profile?.onboardedAt ? "/dashboard" : "/onboarding")
}
