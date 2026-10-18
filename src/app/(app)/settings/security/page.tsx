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
import { PasswordForm } from "@/features/settings/components/password-form"

export default async function SettingsSecurityPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  })
  if (!user) redirect("/sign-in")

  const hasPassword = Boolean(user.password)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          {hasPassword
            ? "Change the password you use to sign in."
            : "Password settings for credential accounts."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasPassword ? (
          <PasswordForm />
        ) : (
          <p className="text-sm text-muted-foreground">
            You signed up with a social provider, so there is no password to change.
            Manage your credentials with your provider.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
