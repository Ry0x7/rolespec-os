import { LayoutDashboard, LayoutPanelTop, FileText, Mail, Settings, Briefcase, CalendarCheck, Telescope, UserRoundCheck, IdCard, ListChecks } from "lucide-react"

/** Grouped sidebar navigation, organized by user intent rather than build phase. */
export const navigationGroups = [
  {
    label: null,
    items: [
      { label: "Home", href: "/dashboard", icon: LayoutDashboard },
      { label: "Needs review", href: "/review", icon: ListChecks },
    ],
  },
  {
    label: "Career",
    items: [
      { label: "Career profile", href: "/career-profile", icon: UserRoundCheck },
      { label: "My resumes", href: "/resumes", icon: FileText },
      { label: "LinkedIn", href: "/linkedin", icon: IdCard },
    ],
  },
  {
    label: "Opportunities",
    items: [
      // Above Jobs on purpose: discovery is where the tracked list comes from,
      // and it used to be reachable only from a button on /jobs. `getActiveHref`
      // resolves the longest matching prefix, so this and /jobs never both light up.
      { label: "Find jobs", href: "/jobs/discover", icon: Telescope },
      { label: "Saved jobs", href: "/jobs", icon: Briefcase },
    ],
  },
  {
    label: "Activity",
    items: [
      { label: "Daily plan", href: "/planner", icon: CalendarCheck },
      { label: "Application board", href: "/workspace", icon: LayoutPanelTop },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "Cover letters", href: "/jobs/cover-letter", icon: Mail },
    ],
  },
] as const

export const footerNavigation = [
  { label: "Settings", href: "/settings", icon: Settings },
] as const

/** Longest matching prefix wins, so nested routes keep their section title. */
const PAGE_TITLES: ReadonlyArray<readonly [string, string]> = [
  ["/dashboard", "Home"],
  ["/review", "Needs review"],
  ["/career-profile", "Career profile"],
  ["/resumes", "My resumes"],
  ["/workspace", "Application board"],
  ["/jobs/cover-letter", "Cover letters"],
  ["/jobs/discover", "Find jobs"],
  ["/jobs", "Saved jobs"],
  ["/planner", "Daily plan"],
  ["/linkedin", "LinkedIn"],
  ["/settings", "Settings"],
]

export function getPageTitle(pathname: string): string {
  let match = ""
  let title = "RoleSpec OS"
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
    return [{ label: "Home", href: "/dashboard" }]
  }
  let best: readonly [string, string] | null = null
  for (const entry of PAGE_TITLES) {
    if (clean === entry[0] || clean.startsWith(`${entry[0]}/`)) {
      if (!best || entry[0].length > best[0].length) best = entry
    }
  }
  if (!best) return [{ label: "Home", href: "/dashboard" }]
  const crumbs: Breadcrumb[] = [{ label: "Home", href: "/dashboard" }]
  if (best[0] !== "/dashboard") crumbs.push({ label: best[1], href: best[0] })
  const rest = clean.slice(best[0].length).split("/").filter(Boolean)
  // A trailing database id (resume, job) becomes a non-link "Details" crumb.
  // Static sub-pages such as /settings/profile or /jobs/cover-letter/new stay
  // under their section crumb instead of claiming to be a detail record.
  const last = rest.at(-1) ?? ""
  if (/^[a-z0-9]{20,}$/i.test(last)) crumbs.push({ label: "Details", href: "" })
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
  { id: "review", label: "Review what needs your attention", hint: "Questions, career info and answers you saved", href: "/review", keywords: "review approve answer human decision memory" },
  { id: "runs", label: "Open agent runs", hint: "See each step, and pause or retry", href: "/workspace?view=runs", keywords: "agent assisted workflow run preparation pause resume retry" },
  { id: "ranking", label: "Rank your saved jobs", hint: "Score them against your career details; no AI needed", href: "/dashboard#opportunities", keywords: "rank leaderboard opportunities score" },
  { id: "tracking", label: "Review prepared applications", hint: "Check what the agent prepared and what happened next", href: "/workspace?view=tracking", keywords: "stage submit follow up tracking outreach" },
  { id: "new-resume", label: "New resume", hint: "Start from your career profile or a blank page", href: "/resumes", keywords: "resume create new cv tailor", shortcut: "N R" },
  { id: "tailor-resume", label: "Rewrite your resume for a job", hint: "Pick a saved job, then prepare a version for it", href: "/jobs", keywords: "tailor match ats job", shortcut: "N T" },
  { id: "add-job", label: "Save a job", hint: "Add a posting to your saved jobs", href: "/jobs/discover", keywords: "job add track discover posting", shortcut: "N J" },
  { id: "plan-day", label: "Plan today", hint: "Open your daily plan", href: "/planner", keywords: "plan today tasks follow up", shortcut: "G P" },
  { id: "open-workspace", label: "Open application board", hint: "See your applications and what the agent is doing", href: "/workspace", keywords: "workspace board pipeline", shortcut: "G W" },
  { id: "cover-letter", label: "Draft a cover letter", hint: "Write one for a saved job", href: "/jobs/cover-letter", keywords: "cover letter outreach draft", shortcut: "N C" },
  { id: "career-profile", label: "Update career profile", hint: "The details every resume and application starts from", href: "/career-profile", keywords: "profile career experience skills", shortcut: "G R" },
]

export const GLOBAL_SHORTCUTS: ReadonlyArray<{ keys: string; description: string }> = [
  { keys: "Ctrl/⌘ + K", description: "Open quick actions" },
  { keys: "G then D", description: "Go to Home" },
  { keys: "G then R", description: "Go to Career profile" },
  { keys: "G then J", description: "Go to Saved jobs" },
  { keys: "G then W", description: "Go to Application board" },
  { keys: "G then P", description: "Go to Daily plan" },
  { keys: "?", description: "Show all shortcuts" },
  { keys: "Esc", description: "Close dialog" },
]
