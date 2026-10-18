import {
  Activity,
  Database,
  KeyRound,
  Palette,
  SlidersHorizontal,
  Sparkles,
  User,
} from "lucide-react"

export interface SettingsTab {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

export interface SettingsTabGroup {
  label: string
  adminOnly?: boolean
  items: SettingsTab[]
}

export const settingsTabGroups: SettingsTabGroup[] = [
  {
    label: "Settings",
    items: [
      { label: "Profile", href: "/settings/profile", icon: User },
      { label: "Preferences", href: "/settings/preferences", icon: SlidersHorizontal },
      { label: "Appearance", href: "/settings/appearance", icon: Palette },
      { label: "API access", href: "/settings/api", icon: KeyRound },
      { label: "AI provider", href: "/settings/ai", icon: Sparkles },
      { label: "Usage", href: "/settings/usage", icon: Activity },
      { label: "Your data", href: "/settings/data", icon: Database },
    ],
  },
]

const ALL_TAB_HREFS: string[] = settingsTabGroups.flatMap((group) =>
  group.items.map((item) => item.href)
)

/**
 * Longest matching prefix wins — the same rule as the app sidebar — so
 * /settings/admin/users lights up "Users" and not the "/settings/admin"
 * overview tab.
 */
export function getActiveTabHref(pathname: string): string | null {
  let active: string | null = null
  for (const href of ALL_TAB_HREFS) {
    const matches = pathname === href || pathname.startsWith(`${href}/`)
    if (matches && (active === null || href.length > active.length)) {
      active = href
    }
  }
  return active
}
