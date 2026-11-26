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
import { DesktopUpdateSettings } from "@/features/settings/components/desktop-update-settings"
import { PreferencesForm } from "@/features/settings/components/preferences-form"
import { QuickToggles } from "@/features/settings/components/quick-toggles"
import { parsePreferences } from "@/features/settings/schemas/preferences.schema"
import {
  isDesktopRuntime,
  readDesktopUpdateSettings,
} from "@/features/settings/services/desktop-updates"

export default async function SettingsPreferencesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/unlock")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferences: true },
  })
  if (!user) redirect("/unlock")

  // The updater runs in the desktop shell, so the control only exists there;
  // a Docker or Node deployment never sees this card.
  const desktopUpdates = isDesktopRuntime() ? await readDesktopUpdateSettings() : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>Defaults applied to your workflow.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <QuickToggles preferences={parsePreferences(user.preferences)} />
        {desktopUpdates ? (
          <DesktopUpdateSettings autoCheck={desktopUpdates.autoCheck} />
        ) : null}
        <PreferencesForm preferences={parsePreferences(user.preferences)} />
      </CardContent>
    </Card>
  )
}
