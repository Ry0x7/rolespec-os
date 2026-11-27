import { redirect } from "next/navigation"

import { auth } from "@/features/auth/config"
import { ClientFinder } from "@/features/clients/components/client-finder"
import { PageShell } from "@/shared/components/page-shell"
import { prisma } from "@/shared/lib/prisma"

/**
 * Client finding for freelance, virtual-assistant and work-from-home services.
 * The page only reads the user's own location to prefill local searches; every
 * third-party request happens when the user presses Find clients.
 */
export default async function FindClientsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/unlock")

  const profile = await prisma.careerProfile.findUnique({
    where: { userId: session.user.id },
    select: { contactLocation: true, locations: true },
  })
  const defaultLocation =
    profile?.contactLocation?.trim() ||
    profile?.locations.find((location) => location.trim() && location.trim().toLowerCase() !== "remote (anywhere)") ||
    null

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl font-bold">Find clients</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          For freelancers, virtual assistants, automation builders and anyone selling a service,
          remote or on site. Save a lead to track it like any other opportunity and draft a proposal
          from your own profile.
        </p>
      </div>
      <ClientFinder defaultLocation={defaultLocation} />
    </PageShell>
  )
}
