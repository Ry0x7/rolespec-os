"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Briefcase, Plus, SearchX } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Select } from "@/shared/ui/select"
import { EmptyState } from "@/shared/components/empty-state"
import { Pagination } from "@/shared/ui/pagination"
import { usePagedList } from "@/shared/hooks/use-paged-list"
import { OpportunityFilterPanel } from "@/features/opportunity/components/opportunity-filter-panel"
import {
  DEFAULT_CRITERIA,
  groupOpportunities,
  parseFilterParams,
  sortOpportunities,
  writeFilterParams,
  type FilterableOpportunity,
  type OpportunityFilterCriteria,
} from "@/features/opportunity/filters"
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

/**
 * The two buckets a filter can move a row into, rendered as compact rows
 * instead of full cards: the card is for a job you are acting on, not for one a
 * filter set aside. Each row still links to the job so nothing is unreachable.
 */
function FilteredRows({
  title,
  description,
  rows,
}: {
  title: string
  description: string
  rows: Array<{ application: JobApplicationCardData; reasons: string[] }>
}) {
  if (rows.length === 0) return null
  return (
    <details className="rounded-lg border border-border bg-card px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        {title} ({rows.length})
      </summary>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <ul className="mt-2 divide-y divide-border">
        {rows.map(({ application, reasons }) => (
          <li key={application.id} className="py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Link
                href={`/jobs/${application.id}`}
                className="text-sm font-medium text-foreground hover:underline"
              >
                {application.job.title || application.job.companyName}
              </Link>
              <span className="text-xs text-muted-foreground">
                {application.job.companyName}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{reasons.join(" ")}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}

interface JobApplicationListProps {
  applications: JobApplicationCardData[]
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

  // The opportunity filters are read from the same URL the saved-job filters
  // already use; `writeFilterParams` preserves `status`, `q`, `page` and the
  // rest, so the two state sets never overwrite each other.
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [criteria, setCriteria] = useState<OpportunityFilterCriteria>(() =>
    parseFilterParams(searchParams),
  )

  // A soft navigation into `/jobs?...` (back/forward, a deep link) keeps this
  // component mounted. The hook above re-reads its own filters on such a
  // change; the opportunity criteria have to do the same or the panel would
  // keep describing the URL the user just left. Our own writes go through
  // `history.replaceState`, which does not reach `useSearchParams`, so they
  // never trigger this branch.
  const observedOpportunityQuery = searchParams.toString()
  const [lastOpportunityQuery, setLastOpportunityQuery] = useState(observedOpportunityQuery)
  if (observedOpportunityQuery !== lastOpportunityQuery) {
    setLastOpportunityQuery(observedOpportunityQuery)
    const fromUrl = parseFilterParams(searchParams)
    if (JSON.stringify(fromUrl) !== JSON.stringify(criteria)) setCriteria(fromUrl)
  }

  function commitCriteria(next: OpportunityFilterCriteria) {
    setCriteria(next)
    const params = writeFilterParams(new URLSearchParams(window.location.search), next)
    // A narrower list may have fewer pages; start at the first one.
    params.delete("page")
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname)
  }

  // Grouping is what turns one list into three honest answers: worth looking at,
  // not enough stated, and excluded with a reason. It never drops a row.
  const opportunityView = useMemo(() => {
    const byId = new Map(visibleApplications.map((application) => [application.id, application]))
    const items: FilterableOpportunity[] = visibleApplications.map((application) => ({
      id: application.id,
      salary: application.job.salary,
      workType: application.job.workType,
      location: application.job.location,
      // Saved jobs do not store an experience level; a filter on it is honest
      // about not knowing rather than guessing from the title.
      experience: null,
      risk: application.job.riskLevel,
      ageDays: application.job.ageDays,
      value: application.opportunityValue ?? null,
    }))
    const grouped = groupOpportunities(items, criteria)

    // The page's own order stays authoritative until the user actually picks an
    // opportunity sort: "Needs action" is why someone opens Saved jobs, and a
    // location filter should not quietly reorder the list underneath it.
    const ordered =
      criteria.sort !== DEFAULT_CRITERIA.sort
        ? sortOpportunities(grouped.eligible, criteria.sort, criteria.currency)
        : grouped.eligible

    const applicationOf = (id: string) => byId.get(id)!
    return {
      eligible: ordered.map((item) => applicationOf(item.id)),
      unknown: grouped.unknown.map((item) => applicationOf(item.id)),
      excluded: grouped.excluded.map((entry) => ({
        application: applicationOf(entry.item.id),
        reasons: entry.reasons,
      })),
    }
  }, [visibleApplications, criteria])

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
    criteria,
  ])
  const { pageItems, page, pageCount, setPage, rangeStart, rangeEnd, total } =
    usePagedList(opportunityView.eligible, { pageSize: 12, resetKey: filterKey })

  const listRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Select mode for bulk delete. The selection only ever holds rows the user
  // ticked on the page in front of them: it is dropped on a filter, sort or
  // page change, so nothing off screen can be deleted by accident.
  const [selectMode, setSelectMode] = useState(false)
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
            Saved job order
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

      <OpportunityFilterPanel
        criteria={criteria}
        onChange={commitCriteria}
        onReset={() => commitCriteria(DEFAULT_CRITERIA)}
        storageKey="rolespec:opportunity-filters:jobs:v1"
        counts={{
          eligible: opportunityView.eligible.length,
          unknown: opportunityView.unknown.length,
          excluded: opportunityView.excluded.length,
        }}
      />

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

      {applications.length === 0 ? (
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
      ) : visibleApplications.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No results"
          description="Try adjusting your search, status, confidence, work mode, fit, follow-up, or stale filter."
        />
      ) : (
        <div className="space-y-3">
          {opportunityView.eligible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              No saved job passes these opportunity filters. The ones that were set
              aside are listed below, with the reason.
            </p>
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

          <FilteredRows
            title="Needs more info"
            description="These postings do not state enough for the current filters — unknown is not the same as passing."
            rows={opportunityView.unknown.map((application) => ({
              application,
              // Unknown means the *filter* could not judge this posting, which
              // is not the same as a low Opportunity Value score (that is shown
              // on the card). Do not blame the number for the missing fact.
              reasons: ["The posting does not state the facts this filter needs."],
            }))}
          />
          <FilteredRows
            title="Excluded"
            description="Each of these was set aside by a filter or by your own minimum-pay and workload settings."
            rows={opportunityView.excluded}
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
