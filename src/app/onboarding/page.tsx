import { redirect } from "next/navigation"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard"

export default async function OnboardingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const profile = await prisma.playerProfile.findUnique({
    where: { userId: session.user.id },
  })

  if (profile?.onboardedAt) redirect("/dashboard")

  return (
    <OnboardingWizard
      name={session.user.name ?? "Hunter"}
      currentRole={profile?.currentRole ?? ""}
      targetRole={profile?.targetRole ?? ""}
      experienceLevel={profile?.experienceLevel ?? ""}
      applicationGoalTarget={profile?.applicationGoalTarget ?? 10}
      applicationGoalPeriod={profile?.applicationGoalPeriod ?? "WEEKLY"}
    />
  )
}
