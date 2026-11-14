import { redirect } from "next/navigation"

import { auth } from "@/features/auth/config"
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
  if (!session?.user?.id) redirect("/unlock")

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export and deletion</CardTitle>
        <CardDescription>
          Take a copy of everything in this workspace, or erase it for good.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataAndDeletion />
      </CardContent>
    </Card>
  )
}
