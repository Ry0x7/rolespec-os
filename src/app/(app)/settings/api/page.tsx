import { redirect } from "next/navigation"
import { auth } from "@/features/auth/config"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card"
import { ApiTokenSection } from "@/features/settings/components/api-token-section"
import { listApiTokens } from "@/features/settings/services/api-token"

export default async function SettingsApiPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const apiTokens = await listApiTokens(session.user.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal tokens</CardTitle>
        <CardDescription>
          Bearer tokens for the RoleSpec browser extension. Each one can create job
          applications on your board.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ApiTokenSection tokens={apiTokens} />
      </CardContent>
    </Card>
  )
}
