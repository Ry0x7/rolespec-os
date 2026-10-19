import { redirect } from "next/navigation"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard"
import { getAiSetupSnapshot } from "@/features/onboarding/services/ai-setup.service"

export default async function OnboardingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const userId = session.user.id

  const [profile, ai, resumeCount] = await Promise.all([
    prisma.playerProfile.findUnique({ where: { userId } }),
    getAiSetupSnapshot(userId),
    prisma.resume.count({
      where: { userId, status: { not: "ARCHIVED" } },
    }),
  ])

  if (profile?.onboardedAt) redirect("/dashboard")

  return (
    <OnboardingWizard
      name={session.user.name ?? "there"}
      currentRole={profile?.currentRole ?? ""}
      targetRole={profile?.targetRole ?? ""}
      experienceLevel={profile?.experienceLevel ?? ""}
      applicationGoalTarget={profile?.applicationGoalTarget ?? 10}
      applicationGoalPeriod={profile?.applicationGoalPeriod ?? "WEEKLY"}
      savedProvider={ai.savedProvider}
      savedModel={ai.model}
      hasSavedKey={ai.hasSavedKey}
      {...(ai.last4 ? { last4: ai.last4 } : {})}
      diagnostics={ai.diagnostics}
      resumeCount={resumeCount}
    />
  )
}
