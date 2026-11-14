"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Pagination } from "@/shared/ui/pagination"
import { usePagedList } from "@/shared/hooks/use-paged-list"
import { formatDate } from "@/shared/lib/utils"
import { restoreResume } from "../actions"

export const ARCHIVED_PAGE_SIZE = 10

interface ArchivedResumeListProps {
  resumes: {
    id: string
    title: string
    updatedAt: Date
  }[]
}

/**
 * Compact, visually quiet list of archived (soft-deleted) resumes shown
 * below the main grid. Restore moves a resume back to DRAFT; server
 * revalidation then returns it to the primary grid.
 *
 * Collapsed by default: archived resumes are a recovery path, not part of the
 * working set, and an expanded list of them otherwise outweighs the live ones
 * at the bottom of the page. The count is on the toggle so the user knows what
 * is in there without opening it. Not persisted — one click either way.
 */
export function ArchivedResumeList({ resumes }: ArchivedResumeListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const paged = usePagedList(resumes, { pageSize: ARCHIVED_PAGE_SIZE })

  async function handleRestore(id: string) {
    setPendingId(id)
    const result = await restoreResume(id)
    setPendingId(null)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success("Resume restored")
    }
  }

  return (
    <section aria-labelledby="archived-resumes-heading" className="space-y-2">
      <h2 id="archived-resumes-heading" className="text-sm font-medium">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-controls="archived-resumes-list"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            className={`h-4 w-4 shrink-0 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
            aria-hidden="true"
          />
          Archived ({resumes.length})
        </button>
      </h2>
      {expanded && (
        <div id="archived-resumes-list" className="space-y-2">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {paged.pageItems.map((resume) => (
              <li
                key={resume.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-muted-foreground">
                    {resume.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Archived · Updated {formatDate(resume.updatedAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRestore(resume.id)}
                  disabled={pendingId === resume.id}
                  className="shrink-0"
                >
                  {pendingId === resume.id ? "Restoring..." : "Restore"}
                </Button>
              </li>
            ))}
          </ul>
          <Pagination
            label="Archived resume pages"
            page={paged.page}
            pageCount={paged.pageCount}
            onPageChange={paged.setPage}
          />
        </div>
      )}
    </section>
  )
}
