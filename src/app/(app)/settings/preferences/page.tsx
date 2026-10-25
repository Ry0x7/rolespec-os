import { redirect } from "next/navigation"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card"
import { PreferencesForm } from "@/features/settings/components/preferences-form"
import { QuickToggles } from "@/features/settings/components/quick-toggles"
import { parsePreferences } from "@/features/settings/schemas/preferences.schema"

export default async function SettingsPreferencesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  })
  if (!user) redirect("/sign-in")

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>Defaults applied to your workflow.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <QuickToggles preferences={parsePreferences(user.preferences)} />
        <PreferencesForm preferences={parsePreferences(user.preferences)} />
      </CardContent>
    </Card>
  )
}
