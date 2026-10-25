"use client"

import { useEffect, useState, useMemo } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import {
  ApplicationStatus,
  JobRiskLevel,
  JobType,
  SalaryCurrency,
  SalaryPeriod,
  WorkType,
} from "@/generated/prisma/enums"
import type { OpportunityConfidence } from "@/features/discovery/services/opportunity-confidence.service"
import type { QualificationVerdict } from "@/features/discovery/services/qualify.service"
import { STATUS_OPTIONS } from "../components/job-form-options"
import {
  FOLLOW_UP_DUE_PARAM,
  FOLLOW_UP_STATUSES,
  isFollowUpDue,
  parseFollowUpFilterParam,
  type FollowUpFilterValue,
} from "../services/follow-up.service"
import type { ApplicationNextStep } from "../services/application-next-step.service"
import type { QuickAction } from "../services/application-quick-actions"
import {
  CONFIDENCE_SORT_PARAM,
  DEADLINE_SORT_PARAM,
  MATCH_SORT_PARAM,
  parseJobSortParam,
  RECENT_SORT_PARAM,
  SAVED_NEWEST_SORT_PARAM,
  SAVED_OLDEST_SORT_PARAM,
  sortJobRows,
  type JobSortValue,
} from "../services/job-sort.service"
import { isStaleJob } from "../services/job-staleness.service"
import { rememberJobsListHref } from "../lib/jobs-list-href"

/**
 * The posting itself, in `Job` vocabulary. The relation is optional in the
 * database, so pages normalise a missing `job` away at the mapping site — the
 * UI only ever sees a posting.
 */
export interface JobApplicationRowJob {
  companyName: string
  title: string
  location: string | null
  salary: number | null
  salaryPeriod: SalaryPeriod | null
  salaryCurrency: SalaryCurrency
  deadline: Date | null
  url: string | null
  description: string | null
  jobType: JobType | null
  workType: WorkType | null
  riskLevel: JobRiskLevel | null
  /**
   * Json column of `JobRequirementFlag` strings. Optional and `unknown` because
   * nothing guarantees a Json column's shape — `RequirementBadges` narrows it.
   */
  requirementFlags?: unknown
}

/**
 * One row of the `/jobs` list: the user's decision-side fields, plus the
 * posting they belong to nested under `job`.
 */
export interface JobApplicationRow {
  id: string
  status: ApplicationStatus
  dateApplied: Date | null
  interviewDate: Date | null
  followUpAt: Date | null
  /** The day a terminal status was first reached. Null while still in flight. */
  outcomeAt: Date | null
  contact: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
  job: JobApplicationRowJob
  /**
   * The four read-time assessments below are all computed on the server, in
   * `/jobs/page.tsx`, and travel as plain values. None of them is stored, and
   * none of the columns behind them (the `qualification` Json blob, the
   * provenance stamps) is shipped to the browser.
   */
  /** The stored qualification verdict, or null when the posting carries none. */
  verdict: QualificationVerdict | null
  /** "Is this posting worth my time?", separate from whether it fits the user. */
  confidence: OpportunityConfidence
  /** One line: where the posting came from and how old it is. */
  provenance: string
  /** The one thing to do next, decided against the user's own calendar day. */
  nextStep: ApplicationNextStep
  /** The one or two ways to act on that next step without opening the job. */
  quickActions: QuickAction[]
}

/** Per-status totals across ALL of the user's applications, counted on the server. */
export type StatusFilterCounts = Record<ApplicationStatus, number>

export type StatusFilterValue = ApplicationStatus | "ALL"

/** Maps the `status` search param onto the status filter; anything unknown is "ALL". */
export function parseStatusParam(param: string | null | undefined): StatusFilterValue {
  return (Object.values(ApplicationStatus) as string[]).includes(param ?? "")
    ? (param as ApplicationStatus)
    : "ALL"
}

/**
 * Options for the status filter, each labelled with how many applications the
 * user has in that status. Counts cover every application, not just the ones
 * that survive the current search — the filter is a navigation aid, so it has
 * to show what picking it would reveal.
 */
export function buildStatusFilterOptions(
  counts: StatusFilterCounts,
): { value: StatusFilterValue; label: string }[] {
  const total = STATUS_OPTIONS.reduce(
    (sum, option) => sum + (counts[option.value] ?? 0),
    0,
  )

  return [
    { value: "ALL" as const, label: `All statuses (${total})` },
    ...STATUS_OPTIONS.map((option) => ({
      value: option.value,
      label: `${option.label} (${counts[option.value] ?? 0})`,
    })),
  ]
}

/**
 * The confidence filter's buckets. LOW and UNKNOWN share one: both mean "the
 * signals do not vouch for this posting", which is the triage question.
 */
export type ConfidenceFilterValue = "ALL" | "HIGH" | "MEDIUM" | "LOW_UNKNOWN"

export const CONFIDENCE_FILTER_OPTIONS: { value: ConfidenceFilterValue; label: string }[] = [
  { value: "ALL", label: "All confidence" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW_UNKNOWN", label: "Low / unknown" },
]

/** Work-mode filter: mirrors the posting's `WorkType`, ALL means no filtering. */
export type WorkTypeFilterValue = "ALL" | "REMOTE" | "HYBRID" | "ONSITE"

export const WORK_TYPE_FILTER_OPTIONS: { value: WorkTypeFilterValue; label: string }[] = [
  { value: "ALL", label: "All work modes" },
  { value: "REMOTE", label: "Remote" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "ONSITE", label: "On-site" },
]

export function parseWorkTypeParam(param: string | null | undefined): WorkTypeFilterValue {
  return WORK_TYPE_FILTER_OPTIONS.some((o) => o.value !== "ALL" && o.value === param)
    ? (param as WorkTypeFilterValue)
    : "ALL"
}

/** Fit filter over the stored qualification verdict. */
export type VerdictFilterValue = "ALL" | "STRONG" | "WORTH_A_LOOK" | "WEAK" | "BLOCKED" | "UNCHECKED"

export const VERDICT_FILTER_OPTIONS: { value: VerdictFilterValue; label: string }[] = [
  { value: "ALL", label: "All fit" },
  { value: "STRONG", label: "Strong fit" },
  { value: "WORTH_A_LOOK", label: "Worth a look" },
  { value: "WEAK", label: "Weak" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "UNCHECKED", label: "Not checked" },
]

export function parseVerdictParam(param: string | null | undefined): VerdictFilterValue {
  return VERDICT_FILTER_OPTIONS.some((o) => o.value !== "ALL" && o.value === param)
    ? (param as VerdictFilterValue)
    : "ALL"
}

/** Maps the `confidence` search param onto the confidence filter; anything unknown is "ALL". */
export function parseConfidenceParam(
  param: string | null | undefined,
): ConfidenceFilterValue {
  return CONFIDENCE_FILTER_OPTIONS.some(
    (option) => option.value !== "ALL" && option.value === param,
  )
    ? (param as ConfidenceFilterValue)
    : "ALL"
}

export function matchesConfidenceFilter(
  level: OpportunityConfidence["level"],
  filter: ConfidenceFilterValue,
): boolean {
  if (filter === "ALL") return true
  if (filter === "LOW_UNKNOWN") return level === "LOW" || level === "UNKNOWN"
  return level === filter
}

// The filter's vocabulary and its query-param parsing live in
// `follow-up.service` so the server component can read the param too.
export type { FollowUpFilterValue }

/**
 * True when the application is one the user is still waiting on AND its
 * scheduled follow-up date has passed. Status matters: a rejected application
 * with a stale follow-up date is not a chase.
 *
 * `today` is the user's calendar day (UTC midnight) from the server page, not
 * the raw clock: `followUpAt` is a calendar date, so comparing it to an instant
 * hid a follow-up due today until 08:00 for a UTC+8 reader.
 */
export function isApplicationFollowUpOverdue(
  application: Pick<JobApplicationRow, "status" | "followUpAt">,
  today: Date,
): boolean {
  return (
    FOLLOW_UP_STATUSES.includes(application.status) &&
    isFollowUpDue(application.followUpAt, today)
  )
}

/** `/jobs?stale=1` — only stale saved jobs. Any other value is stripped. */
export const STALE_FILTER_PARAM_VALUE = "1"

/** Maps the `stale` search param onto the stale-only toggle. */
export function parseStaleParam(param: string | null | undefined): boolean {
  return param === STALE_FILTER_PARAM_VALUE
}

/** How long the search box waits after the last keystroke before writing `q`. */
export const SEARCH_PARAM_DEBOUNCE_MS = 250

function sortToParam(sort: JobSortValue): string | null {
  if (sort === "RECENT") return RECENT_SORT_PARAM
  if (sort === "CONFIDENCE") return CONFIDENCE_SORT_PARAM
  if (sort === "SAVED_NEWEST") return SAVED_NEWEST_SORT_PARAM
  if (sort === "SAVED_OLDEST") return SAVED_OLDEST_SORT_PARAM
  if (sort === "DEADLINE") return DEADLINE_SORT_PARAM
  if (sort === "MATCH_SCORE") return MATCH_SORT_PARAM
  return null
}

interface JobFilterState {
  q: string
  status: StatusFilterValue
  confidence: ConfidenceFilterValue
  workType: WorkTypeFilterValue
  verdict: VerdictFilterValue
  sort: JobSortValue
  followUp: FollowUpFilterValue
  stale: boolean
}

/** Reads the filters out of the URL; a missing param falls back to the server-read props. */
function parseJobFilterParams(
  searchParams: Pick<URLSearchParams, "get" | "has">,
  initialFollowUpFilter: FollowUpFilterValue,
  initialSort: JobSortValue,
): JobFilterState {
  return {
    q: searchParams.get("q") ?? "",
    status: parseStatusParam(searchParams.get("status")),
    confidence: parseConfidenceParam(searchParams.get("confidence")),
    workType: parseWorkTypeParam(searchParams.get("work")),
    verdict: parseVerdictParam(searchParams.get("fit")),
    sort: searchParams.has("sort")
      ? parseJobSortParam(searchParams.get("sort") ?? undefined)
      : initialSort,
    followUp: searchParams.has("filter")
      ? parseFollowUpFilterParam(searchParams.get("filter") ?? undefined)
      : initialFollowUpFilter,
    stale: parseStaleParam(searchParams.get("stale")),
  }
}

/**
 * The query the filters serialise to: non-default values are written, defaults
 * are deleted, and unrelated params are left alone.
 */
function serializeJobFilterParams(currentQuery: string, state: JobFilterState): string {
  const params = new URLSearchParams(currentQuery)
  const write = (key: string, value: string | null) => {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  write("q", state.q === "" ? null : state.q)
  write("status", state.status === "ALL" ? null : state.status)
  write("confidence", state.confidence === "ALL" ? null : state.confidence)
  write("work", state.workType === "ALL" ? null : state.workType)
  write("fit", state.verdict === "ALL" ? null : state.verdict)
  write("sort", sortToParam(state.sort))
  write("filter", state.followUp === "FOLLOW_UP_DUE" ? FOLLOW_UP_DUE_PARAM : null)
  write("stale", state.stale ? STALE_FILTER_PARAM_VALUE : null)
  return params.toString()
}

export function useJobFilters(
  applications: JobApplicationRow[],
  /** The user's calendar day, from the server page; frames the follow-up filter. */
  today: Date,
  /** Preselected follow-up filter, so a deep link can land on it. */
  initialFollowUpFilter: FollowUpFilterValue = "ALL",
  /** Preselected order, so a deep link can land on it. Same pattern as above. */
  initialSort: JobSortValue = "NEEDS_ACTION",
) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // The URL is the source of truth on mount, so a reload or a trip back from a
  // job lands on the same list. The server-read props only fill in when the URL
  // does not carry the param.
  const [initial] = useState(() =>
    parseJobFilterParams(searchParams, initialFollowUpFilter, initialSort),
  )
  const [searchQuery, setSearchQuery] = useState(initial.q)
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "ALL">(initial.status)
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilterValue>(initial.followUp)
  const [sort, setSort] = useState<JobSortValue>(initial.sort)
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilterValue>(
    initial.confidence,
  )
  const [workTypeFilter, setWorkTypeFilter] = useState<WorkTypeFilterValue>(initial.workType)
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilterValue>(initial.verdict)
  const [staleFilter, setStaleFilter] = useState(initial.stale)

  // Typing filters the list at once; only the URL write waits, so a search
  // does not replace the history entry on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_PARAM_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const filterState: JobFilterState = {
    q: debouncedQuery,
    status: statusFilter,
    confidence: confidenceFilter,
    workType: workTypeFilter,
    verdict: verdictFilter,
    sort,
    followUp: followUpFilter,
    stale: staleFilter,
  }

  // A soft navigation to another `/jobs?...` (a link, back/forward) keeps this
  // component mounted, so the URL can change under it. When the new URL is not
  // what the current state serialises to, it did not come from the write below:
  // re-read it. Adjusting during render, not in an effect, means the write
  // effect never sees the new URL with the old state and writes the old
  // filters back over it. The hook's own writes serialise to the same query, so
  // they are a no-op here.
  const observedQuery = searchParams.toString()
  const [lastObservedQuery, setLastObservedQuery] = useState(observedQuery)
  if (observedQuery !== lastObservedQuery) {
    setLastObservedQuery(observedQuery)
    if (serializeJobFilterParams(observedQuery, filterState) !== observedQuery) {
      const next = parseJobFilterParams(searchParams, initialFollowUpFilter, initialSort)
      setSearchQuery(next.q)
      setDebouncedQuery(next.q)
      setStatusFilter(next.status)
      setConfidenceFilter(next.confidence)
      setWorkTypeFilter(next.workType)
      setVerdictFilter(next.verdict)
      setSort(next.sort)
      setFollowUpFilter(next.followUp)
      setStaleFilter(next.stale)
    }
  }

  // Mirror the state into the URL.
  const query = serializeJobFilterParams(observedQuery, filterState)
  useEffect(() => {
    const href = query ? `${pathname}?${query}` : pathname
    // The Job Detail back link reads this: a client-side navigation into a job
    // leaves `document.referrer` untouched, so it cannot see the list's URL.
    rememberJobsListHref(href)
    if (query === observedQuery) return
    // The native History API, not `router.replace`: Next.js syncs it into
    // `useSearchParams` without a server round trip, and the list is already
    // filtered on the client.
    window.history.replaceState(null, "", href)
  }, [pathname, query, observedQuery])

  const filteredApplications = useMemo(() => {
    const q = debouncedQuery.toLowerCase().trim()
    const matching = applications.filter((app) => {
      const haystack = [
        app.job.companyName,
        app.job.title,
        app.job.location ?? "",
        app.contact ?? "",
        app.notes ?? "",
      ]
        .join(" ")
        .toLowerCase()
      const matchesSearch = q === "" || haystack.includes(q)
      const matchesStatus =
        statusFilter === "ALL" || app.status === statusFilter
      const matchesFollowUp =
        followUpFilter === "ALL" || isApplicationFollowUpOverdue(app, today)
      const matchesConfidence = matchesConfidenceFilter(
        app.confidence.level,
        confidenceFilter,
      )
      const matchesWorkType =
        workTypeFilter === "ALL" || app.job.workType === workTypeFilter
      const matchesVerdict =
        verdictFilter === "ALL" ||
        (verdictFilter === "UNCHECKED" ? app.verdict === null : app.verdict === verdictFilter)
      const matchesStale = !staleFilter || isStaleJob(app, today)
      return (
        matchesSearch &&
        matchesStatus &&
        matchesFollowUp &&
        matchesConfidence &&
        matchesWorkType &&
        matchesVerdict &&
        matchesStale
      )
    })
    // The server already hands the rows over in "Needs action" order; re-sorting
    // here is what makes the control switch them without a round trip.
    return sortJobRows(matching, sort)
  }, [
    applications,
    today,
    debouncedQuery,
    statusFilter,
    followUpFilter,
    confidenceFilter,
    workTypeFilter,
    verdictFilter,
    staleFilter,
    sort,
  ])

  function resetJobFilters() {
    setSearchQuery("")
    setStatusFilter("ALL")
    setFollowUpFilter("ALL")
    setConfidenceFilter("ALL")
    setWorkTypeFilter("ALL")
    setVerdictFilter("ALL")
    setStaleFilter(false)
    setSort("NEEDS_ACTION")
  }

  const hasActiveJobFilters =
    searchQuery !== "" ||
    statusFilter !== "ALL" ||
    followUpFilter !== "ALL" ||
    confidenceFilter !== "ALL" ||
    workTypeFilter !== "ALL" ||
    verdictFilter !== "ALL" ||
    staleFilter

  return {
    filteredApplications,
    searchQuery,
    debouncedQuery,
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
  }
}
