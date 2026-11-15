import type { ApplicationStatus } from "@/generated/prisma/enums"

/**
 * Display names for the pipeline statuses.
 *
 * Lives here, free of any React import, so server components can use it —
 * `workspace/components/kanban/kanban-status.ts` re-exports it for the board
 * but also creates a context, which makes that module client-only.
 */
export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  INTERESTED: "Interested",
  APPLIED: "Applied",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
}
