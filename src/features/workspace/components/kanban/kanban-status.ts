import { createContext } from "react"
import type { ApplicationStatus } from "@/generated/prisma/enums"

// Re-exported for the board's existing importers; the labels themselves are
// React-free so server components can render them too.
export { STATUS_LABELS } from "@/features/jobs/constants/status-labels"

/**
 * Lets `KanbanCard` render a non-drag status control without threading a prop
 * through `KanbanColumn`. Lives in its own module so the card does not have to
 * import from the board (which renders the card).
 */
export const KanbanStatusContext = createContext<
  ((jobId: string, status: ApplicationStatus) => void | Promise<void>) | null
>(null)

/**
 * The user's day start from the server page, so a card can tell a due
 * follow-up from an upcoming one without reading the clock itself. Null outside
 * a board (the card then shows the date untinted).
 */
export const KanbanTodayContext = createContext<Date | null>(null)
