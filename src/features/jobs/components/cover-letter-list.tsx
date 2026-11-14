"use client"

import { useRef, useState, type ComponentProps } from "react"
import { SearchX } from "lucide-react"
import { Input } from "@/shared/ui/input"
import { Pagination } from "@/shared/ui/pagination"
import { EmptyState } from "@/shared/components/empty-state"
import { usePagedList } from "@/shared/hooks/use-paged-list"
import { CoverLetterCard } from "./cover-letter-card"

type CoverLetterListItem = ComponentProps<typeof CoverLetterCard>["coverLetter"]

interface CoverLetterListProps {
  coverLetters: CoverLetterListItem[]
}

const PAGE_SIZE = 12

function matchesSearch(coverLetter: CoverLetterListItem, query: string) {
  if (!query) return true
  const fields = [
    coverLetter.resume.title,
    coverLetter.jobApplication?.companyName,
    coverLetter.jobApplication?.jobTitle,
  ]
  return fields.some((field) => field?.toLowerCase().includes(query))
}

/**
 * The cover-letter grid, a page of twelve at a time. Search runs over the rows
 * the server already loaded and returns to page 1 when it changes.
 */
export function CoverLetterList({ coverLetters }: CoverLetterListProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const query = searchQuery.trim().toLowerCase()
  const visible = coverLetters.filter((coverLetter) =>
    matchesSearch(coverLetter, query)
  )

  const { pageItems, page, pageCount, setPage, rangeStart, rangeEnd, total } =
    usePagedList(visible, { pageSize: PAGE_SIZE, resetKey: query })

  const listRef = useRef<HTMLDivElement>(null)

  // Only scroll when the top of the list has gone above the viewport.
  function handlePageChange(nextPage: number) {
    setPage(nextPage)
    const list = listRef.current
    if (list && list.getBoundingClientRect().top < 0) {
      list.scrollIntoView({ block: "start" })
    }
  }

  return (
    <div className="space-y-4">
      <label htmlFor="cover-letter-search" className="sr-only">
        Search cover letters
      </label>
      <Input
        id="cover-letter-search"
        className="sm:max-w-xs"
        placeholder="Search company, job or resume..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No results"
          description="No cover letter matches that search."
        />
      ) : (
        <div ref={listRef} className="space-y-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Showing {rangeStart}–{rangeEnd} of {total}
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {pageItems.map((coverLetter) => (
              <CoverLetterCard key={coverLetter.id} coverLetter={coverLetter} />
            ))}
          </div>
          <Pagination
            page={page}
            pageCount={pageCount}
            onPageChange={handlePageChange}
            label="Cover letter pages"
          />
        </div>
      )}
    </div>
  )
}
