import { auth } from "@/features/auth/config"
import { SettingsTabs } from "@/features/settings/components/settings-tabs"
import { PageShell } from "@/shared/components/page-shell"

/**
 * Settings shell: one page, many tabs. The admin panel lives here too (under
 * /settings/admin), so this is the single place where every app-level and
 * deployment-level control is configured.
 *
 * The session read only decides whether the "Administration" group is visible —
 * the admin routes are guarded independently in settings/admin/layout.tsx.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  const isAdmin = session?.user?.role === "ADMIN"

  return (
    <PageShell>
      {/* No page heading here: the app header already renders "Settings", and
          the active tab in the rail names the section. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <SettingsTabs isAdmin={isAdmin} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </PageShell>
  )
}
