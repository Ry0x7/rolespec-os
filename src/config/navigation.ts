import { LayoutDashboard, LayoutPanelTop, FileText, Mail, Settings, Briefcase, CalendarCheck, Telescope, UserRoundCheck } from "lucide-react"

/** Grouped sidebar navigation, organized by user intent rather than build phase. */
export const navigationGroups = [
  {
    label: null,
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Career",
    items: [
      { label: "Career Profile", href: "/career-profile", icon: UserRoundCheck },
      { label: "Resumes", href: "/resumes", icon: FileText },
    ],
  },
  {
    label: "Opportunities",
    items: [
      // Above Jobs on purpose: discovery is where the tracked list comes from,
      // and it used to be reachable only from a button on /jobs. `getActiveHref`
      // resolves the longest matching prefix, so this and /jobs never both light up.
      { label: "Discover", href: "/jobs/discover", icon: Telescope },
      { label: "Jobs", href: "/jobs", icon: Briefcase },
    ],
  },
  {
    label: "Activity",
    items: [
      { label: "Planner", href: "/planner", icon: CalendarCheck },
      { label: "Workspace", href: "/workspace", icon: LayoutPanelTop },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "Cover Letters", href: "/jobs/cover-letter", icon: Mail },
    ],
  },
] as const

export const footerNavigation = [
  { label: "Settings", href: "/settings", icon: Settings },
] as const

/** Longest matching prefix wins, so nested routes keep their section title. */
const PAGE_TITLES: ReadonlyArray<readonly [string, string]> = [
  ["/dashboard", "Dashboard"],
  ["/career-profile", "Career Profile"],
  ["/resumes", "Resumes"],
  ["/workspace", "Workspace"],
  ["/jobs/cover-letter", "Cover Letters"],
  ["/jobs/discover", "Discover"],
  ["/jobs", "Jobs"],
  ["/planner", "Planner"],
  ["/linkedin", "LinkedIn"],
  ["/portfolio", "Portfolio"],
  ["/settings", "Settings"],
]

export function getPageTitle(pathname: string): string {
  let match = ""
  let title = "RoleSpec"
  for (const [prefix, label] of PAGE_TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (prefix.length > match.length) {
        match = prefix
        title = label
      }
    }
  }
  return title
}
