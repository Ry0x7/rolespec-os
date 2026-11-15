import { SettingsTabs } from "@/features/settings/components/settings-tabs"
import { PageShell } from "@/shared/components/page-shell"

/**
 * Settings shell: one page, many tabs, all available to the single owner.
 * There are no roles or an administration group to hide tabs for.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <PageShell>
      <h1 className="sr-only">Settings</h1>
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <SettingsTabs />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </PageShell>
  )
}
