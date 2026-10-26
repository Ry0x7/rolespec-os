/**
 * AI-optional capability map: every AI action names its non-AI fallback so
 * callers can offer a manual path when no provider key is configured.
 * Pure data — no filesystem, process or network access.
 */

export interface AiCapabilityFallback {
  /** Stable key used by UI gates (e.g. `resume-polish`, `ats-analysis`). */
  id: string
  /** What the AI action does when a key is present. */
  aiAction: string
  /** What the user can do instead with no key. */
  manualFallback: string
  /** Where the manual path lives. */
  fallbackHref: string
}

export const AI_CAPABILITY_FALLBACKS: readonly AiCapabilityFallback[] = [
  {
    id: "resume-import",
    aiAction: "Organize and polish resume import with AI",
    manualFallback: "Text import groups pasted text under headings — review and edit as text sections",
    fallbackHref: "/resumes",
  },
  {
    id: "resume-polish",
    aiAction: "Rewrite bullets with AI",
    manualFallback: "Edit bullets inline with templates and keyword checklist",
    fallbackHref: "/resumes",
  },
  {
    id: "ats-analysis",
    aiAction: "AI ATS score with suggestions",
    manualFallback: "Manual checklist: title match, keywords, measurable outcomes, dates",
    fallbackHref: "/resumes",
  },
  {
    id: "job-match",
    aiAction: "AI job-match verdict",
    manualFallback: "Keyword overlap compare between posting and resume",
    fallbackHref: "/jobs",
  },
  {
    id: "cover-letter",
    aiAction: "Draft cover letter with AI",
    manualFallback: "Start from the cover-letter template and fill role + evidence",
    fallbackHref: "/jobs",
  },
  {
    id: "outreach",
    aiAction: "Draft cold email with AI",
    manualFallback: "Start from the outreach template with your contact + role",
    fallbackHref: "/jobs",
  },
  {
    id: "interview-prep",
    aiAction: "Generate interview questions with AI",
    manualFallback: "Use the role-based question checklist",
    fallbackHref: "/jobs",
  },
] as const

export function fallbackForCapability(id: string): AiCapabilityFallback | null {
  return AI_CAPABILITY_FALLBACKS.find((c) => c.id === id) ?? null
}
