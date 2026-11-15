/**
 * Guided tour copy and persistence.
 *
 * Kept outside the component so Settings can replay the tour without importing
 * the header's DOM logic, and so the selectors stay in one place.
 */

export const GUIDED_TOUR_STORAGE_KEY = "rolespec-tour"

/** Fired by the header Help button and by Settings → replay. */
export const GUIDED_TOUR_EVENT = "rolespec:start-tour"

export type GuidedTourStatus = "done" | "skipped"

export interface GuidedTourStep {
  id: string
  /** CSS selector for the element to spotlight. Null means a centred card. */
  target: string | null
  title: string
  body: string
}

export const GUIDED_TOUR_STEPS: readonly GuidedTourStep[] = [
  {
    id: "career",
    target: '[data-tour="nav-career"]',
    title: "Start with your career info",
    body:
      "Add a resume, GitHub or LinkedIn once. RoleSpec sorts it into your profile so you do not retype the same details on every application.",
  },
  {
    id: "jobs",
    target: '[data-tour="nav-jobs"]',
    title: "Find and save jobs",
    body:
      "Save a role you like, or let the agent research it, rewrite your resume for it and prepare the answers. You stay in control of what gets sent.",
  },
  {
    id: "workspace",
    target: '[data-tour="nav-workspace"]',
    title: "See what the agent did",
    body:
      "The application board shows every job, every agent run and the one thing that needs your review next. Nothing is submitted without you.",
  },
  {
    id: "settings",
    target: '[data-tour="nav-settings"]',
    title: "Make it yours",
    body:
      "Connect an AI provider, choose a theme, or pick the sound you hear when something needs your attention.",
  },
  {
    id: "finish",
    target: null,
    title: "That is the whole loop",
    body:
      "Add your career info, save a job, start an agent run, then review the finished package before applying. You can replay this tour any time from Help.",
  },
] as const

/** Stable hook for the sidebar; labels can change without breaking the tour. */
export function tourTargetForHref(href: string): string | undefined {
  switch (href) {
    case "/career-profile":
      return "nav-career"
    case "/jobs":
      return "nav-jobs"
    case "/workspace":
      return "nav-workspace"
    case "/settings":
      return "nav-settings"
    default:
      return undefined
  }
}

/** null means the user has never answered the tour prompt. */
export function readGuidedTourStatus(): GuidedTourStatus | null {
  if (typeof window === "undefined") return null
  try {
    const stored = window.localStorage.getItem(GUIDED_TOUR_STORAGE_KEY)
    return stored === "done" || stored === "skipped" ? stored : null
  } catch {
    return null
  }
}

export function writeGuidedTourStatus(status: GuidedTourStatus): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(GUIDED_TOUR_STORAGE_KEY, status)
  } catch {
    // A blocked storage API must not break the tour for this session.
  }
}

/** Opens the tour from anywhere (Help button, Settings card, keyboard/test). */
export function startGuidedTour(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(GUIDED_TOUR_EVENT))
}
