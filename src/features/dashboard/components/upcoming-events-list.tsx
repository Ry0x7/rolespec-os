"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/shared/ui/button"

export const UPCOMING_VISIBLE_LIMIT = 6

/**
 * The Upcoming card's rows, capped at a fixed number until the user asks for
 * the rest. The rows are rendered by the server component and passed in as-is,
 * so their date labels are formatted exactly where they were before.
 */
export function UpcomingEventsList({
  rows,
  limit = UPCOMING_VISIBLE_LIMIT,
}: {
  rows: ReactNode[]
  limit?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const overflow = rows.length > limit
  const visible = expanded || !overflow ? rows : rows.slice(0, limit)

  return (
    <div className="space-y-3">
      <ul id="upcoming-events-list" className="space-y-3">
        {visible}
      </ul>
      {overflow && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={expanded}
          aria-controls="upcoming-events-list"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show fewer" : `Show all (${rows.length})`}
        </Button>
      )}
    </div>
  )
}
