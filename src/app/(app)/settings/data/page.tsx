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
import { DataAndDeletion } from "@/features/settings/components/data-and-deletion"

export default async function SettingsDataPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  })
  if (!user) redirect("/sign-in")

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export and deletion</CardTitle>
        <CardDescription>
          Take a copy of everything we hold, or close your account for good.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataAndDeletion hasPassword={Boolean(user.password)} />
      </CardContent>
    </Card>
  )
}
