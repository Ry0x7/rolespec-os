import { Sidebar } from "@/shared/components/sidebar"
import { Header } from "@/shared/components/header"
import { TimezoneSync } from "@/shared/components/timezone-sync"
import { requireUser } from "@/features/auth/guards"
import { canLockWorkspace } from "@/features/auth/config"

/**
 * Blanket duration budget for the authenticated tree. Most pages here invoke a
 * Server Action that makes a blocking AI call (enhance, ATS, cover letter, cold
 * email) — none of them stream, so the whole latency has to fit inside the
 * platform timeout, and the default is far too short for a model round trip. 60s
 * is the ceiling on Vercel's Hobby plan without Fluid compute; with Fluid compute
 * enabled this can go to 300.
 */
export const maxDuration = 60

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The shell itself is guarded so any page added under (app) inherits it —
  // child pages that guard again are harmless.
  const session = await requireUser()
  const canLock = await canLockWorkspace()

  return (
    <>
      <TimezoneSync />
      <div className="flex min-h-screen">
        <a href="#app-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:p-3 focus:text-foreground focus:ring-2 focus:ring-ring">Skip to content</a>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
          <Header
            owner={{ name: session.user.name, email: session.user.email }}
            canLock={canLock}
          />
          <main id="app-main" tabIndex={-1} className="flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </>
  )
}
