"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Briefcase, Plus, SearchX } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Select } from "@/shared/ui/select"
import { EmptyState } from "@/shared/components/empty-state"
import { Pagination } from "@/shared/ui/pagination"
import { usePagedList } from "@/shared/hooks/use-paged-list"
import type { SalaryCurrency } from "@/generated/prisma/enums"
import {
  buildStatusFilterOptions,
  CONFIDENCE_FILTER_OPTIONS,
  isApplicationFollowUpOverdue,
  useJobFilters,
  VERDICT_FILTER_OPTIONS,
  WORK_TYPE_FILTER_OPTIONS,
  type FollowUpFilterValue,
  type StatusFilterCounts,
} from "../hooks/use-job-filters"
import {
  JOB_SORT_OPTIONS,
  type JobSortValue,
} from "../services/job-sort.service"
import { isStaleJob } from "../services/job-staleness.service"
import { BulkDeleteJobsDialog } from "./bulk-delete-jobs-dialog"
import { CreateJobDialog } from "./create-job-dialog"
import { JobDetailDrawer } from "./job-detail-drawer"
import {
  JobApplicationCard,
  type JobApplicationCardData,
} from "./job-application-card"

/**
 * Mirrors `BULK_DELETE_MAX_IDS` in `job-record.service.ts`, which is server-only
 * (it imports Prisma). The server action enforces the real cap.
 */
const BULK_DELETE_LIMIT = 200

interface JobApplicationListProps {
  applications: JobApplicationCardData[]
  /** Pesos per dollar, fetched once on the server and handed to every card. */
  usdPhpRate: number
  /** The user's display currency for the salary equivalents line. */
  preferredCurrency: SalaryCurrency
  /** Per-status totals across all of the user's applications. */
  statusCounts: StatusFilterCounts
  /** Preselected follow-up filter, read from the `filter` search param. */
  initialFollowUpFilter?: FollowUpFilterValue
  /** Preselected order, read from the `sort` search param. */
  initialSort?: JobSortValue
  /** The user's calendar day (UTC midnight), resolved on the server page. */
  today: Date
}

export function JobApplicationList({
  applications,
  usdPhpRate,
  preferredCurrency,
  statusCounts,
  initialFollowUpFilter = "ALL",
  initialSort = "NEEDS_ACTION",
  today,
}: JobApplicationListProps) {
  const {
    filteredApplications,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    followUpFilter,
    setFollowUpFilter,
    confidenceFilter,
    setConfidenceFilter,
    workTypeFilter,
    setWorkTypeFilter,
    verdictFilter,
    setVerdictFilter,
    staleFilter,
    setStaleFilter,
    sort,
    setSort,
    resetJobFilters,
    hasActiveJobFilters,
  } = useJobFilters(applications, today, initialFollowUpFilter, initialSort)

  // `useJobFilters` is typed against the base row and only ever returns members
  // of what it was given, so the cover-letter fields survive the round trip.
  const visibleApplications = filteredApplications as JobApplicationCardData[]

  // Twelve fills whole rows of the 1/2/3-column grid. Any filter or sort
  // change returns to page 1; a row leaving the list clamps the page.
  const filterKey = JSON.stringify([
    searchQuery,
    statusFilter,
    followUpFilter,
    confidenceFilter,
    workTypeFilter,
    verdictFilter,
    staleFilter,
    sort,
  ])
  const { pageItems, page, pageCount, setPage, rangeStart, rangeEnd, total } =
    usePagedList(visibleApplications, { pageSize: 12, resetKey: filterKey })

  const listRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Select mode for bulk delete. The selection only ever holds rows the user
  // ticked on the page in front of them: it is dropped on a filter, sort or
  // page change, so nothing off screen can be deleted by accident.
  const [selectMode, setSelectMode] = useState(false)
  // Track selected IDs with a stable ref so selection stays in sync with
  // the live set without re-creating the state object per render.
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [selectionKey, setSelectionKey] = useState(filterKey)
  if (selectionKey !== filterKey) {
    setSelectionKey(filterKey)
    setSelectedIds(new Set())
  }

  function toggleSelectMode() {
    setSelectMode((on) => !on)
    setSelectedIds(new Set())
  }

  function setSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function usedLength(seed: Set<string>): number {
    return seed.size
  }

  function clearFromSeed(seed: Set<string>, id: string): Set<string> {
    if (seed.has(id)) {
      seed.delete(id)
    }
    return seed
  }

  function selectAllOnPage() {
    setSelectedIds(new Set(pageItems.map((application) => application.id)))
  }

  function handleBulkDeleted() {
    setSelectedIds(new Set())
    setSelectMode(false)
    router.refresh()
  }

  const selectedCount = selectedIds.size
  const overBulkLimit = selectedCount > BULK_DELETE_LIMIT

  // Bring the top of the list back into view only when the user has scrolled
  // past it; a pager click near the top leaves the window where it is.
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Persist selected IDs across navigates when remove-page is set, so the
  // user's selection survives a back-forward navigation without re-checking.
  const persistedSelectedIds = persistSelectedIds({
    seed: selectedIdsRef.current,
    preferOn: persistSelectedIdsParam,
    fallbackKey: selectModeKey,
    onClear: () => setSelectedIds(new Set()),
  })
  if (persistedSelectedIds && persistedSelectedIds !== selectedIds) {
    setSelectedIds(persistedSelectedIds)
  }
  // Deep-linkable page cursor: `?page=3` restores the same slice on reload or
  // back-navigation. Page 1 is the default and stays clean in the URL.
  useEffect(() => {
    const raw = searchParams.get("page")
    const parsed = raw ? Number.parseInt(raw, 10) : 1
    if (Number.isFinite(parsed) && parsed >= 1 && parsed !== page) {
      setPage(parsed)
    }
    // Only on mount: page changes below write the param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function handlePageChange(nextPage: number) {
    setPage(nextPage)
    const params = new URLSearchParams(searchParams.toString())
    if (nextPage <= 1) params.delete("page")
    else params.set("page", String(nextPage))
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname)
    setSelectedIds(new Set())
    const list = listRef.current
    if (list && list.getBoundingClientRect().top < 0) {
      list.scrollIntoView({ block: "start" })
    }
  }

  const statusOptions = buildStatusFilterOptions(statusCounts)

  // Counted off the rows on screen rather than a server aggregate, against the
  // same user day the filter uses, so the count and the filtered list agree.
  const followUpDueCount = applications.filter((application) =>
    isApplicationFollowUpOverdue(application, today),
  ).length

  // Same basis as the follow-up count: the rows on screen, the same user day.
  const staleCount = applications.filter((application) =>
    isStaleJob(application, today),
  ).length

  // Lifted so the empty state's CTA opens the very same dialog as the toolbar
  // trigger, instead of pointing at a button the user has to go find.
  const [createOpen, setCreateOpen] = useState(false)
  const [previewApplication, setPreviewApplication] = useState<JobApplicationCardData | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
          <label htmlFor="job-search" className="sr-only">
            Search applications
          </label>
          <Input
            id="job-search"
            className="basis-full sm:max-w-xs sm:basis-auto"
            placeholder="Search company, title, location, notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <label htmlFor="job-status-filter" className="sr-only">
            Filter by status
          </label>
          <Select
            id="job-status-filter"
            className="w-auto"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <label htmlFor="job-follow-up-filter" className="sr-only">
            Filter by follow-up
          </label>
          <Select
            id="job-follow-up-filter"
            className="w-auto"
            value={followUpFilter}
            onChange={(e) =>
              setFollowUpFilter(e.target.value as typeof followUpFilter)
            }
          >
            <option value="ALL">All follow-ups</option>
            <option value="FOLLOW_UP_DUE">
              Follow-up overdue ({followUpDueCount})
            </option>
          </Select>
          <Button
            type="button"
            variant={staleFilter ? "default" : "secondary"}
            className="shrink-0 whitespace-nowrap"
            aria-pressed={staleFilter}
            title="Saved over 30 days ago or past its deadline"
            onClick={() => setStaleFilter(!staleFilter)}
          >
            Stale only{staleCount > 0 ? ` (${staleCount})` : ""}
          </Button>
          <label htmlFor="job-confidence-filter" className="sr-only">
            Filter by confidence
          </label>
          <Select
            id="job-confidence-filter"
            className="w-auto"
            value={confidenceFilter}
            onChange={(e) =>
              setConfidenceFilter(e.target.value as typeof confidenceFilter)
            }
          >
            {CONFIDENCE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <label htmlFor="job-work-filter" className="sr-only">
            Filter by work mode
          </label>
          <Select
            id="job-work-filter"
            className="w-auto"
            value={workTypeFilter}
            onChange={(e) => setWorkTypeFilter(e.target.value as typeof workTypeFilter)}
          >
            {WORK_TYPE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <label htmlFor="job-fit-filter" className="sr-only">
            Filter by fit
          </label>
          <Select
            id="job-fit-filter"
            className="w-auto"
            value={verdictFilter}
            onChange={(e) => setVerdictFilter(e.target.value as typeof verdictFilter)}
          >
            {VERDICT_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <label htmlFor="job-sort" className="sr-only">
            Sort
          </label>
          {/* Client-side, off the `urgency` the server already computed — the
              other controls filter the full list in the browser too. */}
          <Select
            id="job-sort"
            className="w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            {JOB_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant={selectMode ? "default" : "secondary"}
            className="shrink-0 whitespace-nowrap"
            aria-pressed={selectMode}
            onClick={toggleSelectMode}
          >
            Select
          </Button>
          {hasActiveJobFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetJobFilters}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
        <div className="sm:shrink-0">
          <CreateJobDialog open={createOpen} onOpenChange={setCreateOpen} />
        </div>
      </div>

      {/* `top-16` keeps the bar clear of the h-14 sticky app header. */}
      {selectMode ? (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm"
        >
          <span className="text-sm font-medium text-foreground" aria-live="polite">
            {selectedCount} selected
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={selectAllOnPage}
            disabled={pageItems.length === 0}
          >
            Select all on this page
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
            disabled={selectedCount === 0}
          >
            Clear
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {overBulkLimit ? (
              <span className="text-xs text-error">
                Select at most {BULK_DELETE_LIMIT}
              </span>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={selectedCount === 0 || overBulkLimit}
              onClick={() => setBulkDeleteOpen(true)}
            >
              Delete selected
            </Button>
          </div>
        </div>
      ) : null}

      {visibleApplications.length === 0 ? (
        applications.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No applications yet"
            description="Track a role you are interested in and everything else — match, emails, interview prep — hangs off it."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add your first application
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title="No results"
            description="Try adjusting your search, status, confidence, work mode, fit, follow-up, or stale filter."
          />
        )
      ) : (
        <div ref={listRef} className="space-y-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Showing {rangeStart}–{rangeEnd} of {total}
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pageItems.map((application) => (
              <JobApplicationCard
                key={application.id}
                application={application}
                usdPhpRate={usdPhpRate}
                preferredCurrency={preferredCurrency}
                today={today}
                onPreview={setPreviewApplication}
                selection={
                  selectMode
                    ? {
                        checked: selectedIds.has(application.id),
                        onCheckedChange: (checked) =>
                          setSelected(application.id, checked),
                      }
                    : undefined
                }
              />
            ))}
          </div>
          <Pagination
            page={page}
            pageCount={pageCount}
            onPageChange={handlePageChange}
            label="Application pages"
          />
        </div>
      )}

      <BulkDeleteJobsDialog
        ids={[...selectedIds]}
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onDeleted={handleBulkDeleted}
      />
      <JobDetailDrawer
        application={previewApplication}
        open={previewApplication !== null}
        onClose={() => setPreviewApplication(null)}
      />
    </div>
  )
}
