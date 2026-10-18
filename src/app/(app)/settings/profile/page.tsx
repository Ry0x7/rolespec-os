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
import { ProfileForm } from "@/features/settings/components/profile-form"
import { formatDate } from "@/shared/lib/utils"

export default async function SettingsProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, image: true, createdAt: true },
  })
  if (!user) redirect("/sign-in")

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How you appear across RoleSpec.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ProfileForm
          name={user.name ?? ""}
          email={user.email}
          image={user.image ?? ""}
        />
        <p className="border-t border-border pt-4 text-sm text-muted-foreground">
          Member since{" "}
          <span className="tabular-nums text-foreground">
            {formatDate(user.createdAt)}
          </span>
        </p>
      </CardContent>
    </Card>
  )
}
