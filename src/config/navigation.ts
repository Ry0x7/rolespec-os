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

export interface Breadcrumb {
  label: string
  href: string
}

/** Breadcrumb trail for the OS shell. Dynamic ids collapse to the section. */
export function getBreadcrumbs(pathname: string): Breadcrumb[] {
  const clean = pathname.split("?")[0].split("#")[0]
  if (clean === "/" || clean === "/dashboard") {
    return [{ label: "Dashboard", href: "/dashboard" }]
  }
  let best: readonly [string, string] | null = null
  for (const entry of PAGE_TITLES) {
    if (clean === entry[0] || clean.startsWith(`${entry[0]}/`)) {
      if (!best || entry[0].length > best[0].length) best = entry
    }
  }
  if (!best) return [{ label: "Dashboard", href: "/dashboard" }]
  const crumbs: Breadcrumb[] = [{ label: "Dashboard", href: "/dashboard" }]
  if (best[0] !== "/dashboard") crumbs.push({ label: best[1], href: best[0] })
  const rest = clean.slice(best[0].length).split("/").filter(Boolean)
  // A trailing id (resume, job) becomes a non-link "Details" crumb so raw
  // database ids never render in the header.
  if (rest.length > 0) crumbs.push({ label: "Details", href: "" })
  return crumbs
}

export interface QuickAction {
  id: string
  label: string
  hint: string
  href: string
  keywords: string
  shortcut?: string
}

/** One-keystroke creates and go-tos surfaced in the Cmd+K palette. */
export const QUICK_ACTIONS: QuickAction[] = [
  { id: "new-resume", label: "New resume", hint: "Start from Career Profile or scratch", href: "/resumes", keywords: "resume create new cv tailor", shortcut: "N R" },
  { id: "tailor-resume", label: "Tailor a resume to a job", hint: "Pick a job, then tailor", href: "/jobs", keywords: "tailor match ats job", shortcut: "N T" },
  { id: "add-job", label: "Track a job", hint: "Save a posting to Jobs", href: "/jobs/discover", keywords: "job add track discover posting", shortcut: "N J" },
  { id: "plan-day", label: "Plan today", hint: "Open the planner", href: "/planner", keywords: "plan today tasks follow up", shortcut: "G P" },
  { id: "open-workspace", label: "Open workspace", hint: "Notes, snippets and drafts", href: "/workspace", keywords: "workspace notes snippets drafts", shortcut: "G W" },
  { id: "cover-letter", label: "Draft a cover letter", hint: "Generate from a tracked job", href: "/jobs/cover-letter", keywords: "cover letter outreach draft", shortcut: "N C" },
  { id: "career-profile", label: "Update Career Profile", hint: "Source of truth for resumes", href: "/career-profile", keywords: "profile career experience skills", shortcut: "G R" },
]

export const GLOBAL_SHORTCUTS: ReadonlyArray<{ keys: string; description: string }> = [
  { keys: "Ctrl/⌘ + K", description: "Open quick actions" },
  { keys: "G then D", description: "Go to Dashboard" },
  { keys: "G then R", description: "Go to Career Profile" },
  { keys: "G then J", description: "Go to Jobs" },
  { keys: "G then W", description: "Go to Workspace" },
  { keys: "G then P", description: "Go to Planner" },
  { keys: "?", description: "Show all shortcuts" },
  { keys: "Esc", description: "Close dialog" },
]
