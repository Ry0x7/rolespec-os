import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { parseFollowUpFilterParam } from "@/features/jobs/services/follow-up.service"
import { describeNextStep } from "@/features/jobs/services/application-next-step.service"
import { quickActionsFor } from "@/features/jobs/services/application-quick-actions"
import { assessOpportunityConfidence } from "@/features/discovery/services/opportunity-confidence.service"
import {
  buildStatusFilterOptions,
  CONFIDENCE_FILTER_OPTIONS,
  parseConfidenceParam,
  parseStaleParam,
  parseStatusParam,
  SEARCH_PARAM_DEBOUNCE_MS,
  useJobFilters,
  type JobApplicationRow,
  type JobApplicationRowJob,
  type StatusFilterCounts,
} from "../use-job-filters"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { JOBS_LIST_HREF_STORAGE_KEY } from "../../lib/jobs-list-href"

/** The user's calendar day, as `/jobs/page.tsx` hands it in. */
const TODAY = new Date(Date.UTC(2026, 9, 12))

// The hook reads the URL through `useSearchParams` and writes it with the native
// `window.history.replaceState`. Each test sets the URL with `setUrl`; the params
// object keeps its identity between renders, like the real hook's.
const replace = vi.fn()
let currentParams = new URLSearchParams()
vi.mock("next/navigation", () => ({
  usePathname: () => "/jobs",
  useSearchParams: () => currentParams,
}))

function setUrl(search: string) {
  currentParams = new URLSearchParams(search)
}

beforeEach(() => {
  replace.mockReset()
  vi.spyOn(window.history, "replaceState").mockImplementation((...args) => replace(...args))
  setUrl("")
})

function makeApp(
  overrides: Partial<Omit<JobApplicationRow, "job">> & {
    job?: Partial<JobApplicationRowJob>
  } = {},
): JobApplicationRow {
  const {
    job,
    verdict,
    confidence,
    provenance,
    nextStep,
    quickActions,
    ...applicationOverrides
  } = overrides
  const row = {
    id: "app-1",
    status: ApplicationStatus.APPLIED,
    dateApplied: null,
    interviewDate: null,
    followUpAt: null,
    outcomeAt: null,
    contact: null,
    notes: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...applicationOverrides,
    job: {
      companyName: "Acme Corp",
      title: "Engineer",
      location: null,
      salary: null,
      salaryPeriod: null,
      salaryCurrency: "USD" as const,
      deadline: null,
      url: null,
      description: null,
      jobType: null,
      workType: null,
      riskLevel: null,
      ...job,
    },
  }

  // The four read-time fields are the server's work; the fixture reproduces it
  // so the hook sees the same shape `/jobs/page.tsx` sends.
  const today = TODAY
  return {
    ...row,
    verdict: verdict ?? null,
    confidence:
      confidence ??
      assessOpportunityConfidence({
        source: "MANUAL",
        companyName: row.job.companyName,
        createdAt: row.createdAt,
      }),
    provenance: provenance ?? "Added manually",
    nextStep:
      nextStep ??
      describeNextStep(
        {
          status: row.status,
          followUpAt: row.followUpAt,
          interviewDate: row.interviewDate,
          outcomeAt: row.outcomeAt,
          deadline: row.job.deadline,
          verdict: verdict ?? null,
        },
        today,
      ),
    quickActions:
      quickActions ??
      quickActionsFor(
        {
          status: row.status,
          followUpAt: row.followUpAt,
          interviewDate: row.interviewDate,
          outcomeAt: row.outcomeAt,
          deadline: row.job.deadline,
          verdict: verdict ?? null,
        },
        today,
      ),
  }
}

describe("useJobFilters", () => {
  it("returns all applications when no filters set", () => {
    const apps = [
      makeApp({ id: "1" }),
      makeApp({ id: "2" }),
      makeApp({ id: "3" }),
    ]
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.filteredApplications).toHaveLength(3)
  })

  it("filters by status", () => {
    const apps = [
      makeApp({ id: "1", status: ApplicationStatus.APPLIED }),
      makeApp({ id: "2", status: ApplicationStatus.APPLIED }),
      makeApp({ id: "3", status: ApplicationStatus.INTERVIEW }),
    ]
    const { result } = renderHook(() => useJobFilters(apps, TODAY))

    act(() => {
      result.current.setStatusFilter(ApplicationStatus.INTERVIEW)
    })

    expect(result.current.filteredApplications).toHaveLength(1)
    expect(result.current.filteredApplications[0].status).toBe(ApplicationStatus.INTERVIEW)
  })

  it("filters by companyName case-insensitive", () => {
    const apps = [
      makeApp({ id: "1", job: { companyName: "Google" } }),
      makeApp({ id: "2", job: { companyName: "Acme Corp" } }),
      makeApp({ id: "3", job: { companyName: "Microsoft" } }),
    ]
    const { result } = renderHook(() => useJobFilters(apps, TODAY))

    act(() => {
      result.current.setSearchQuery("google")
    })

    expect(result.current.filteredApplications).toHaveLength(1)
    expect(result.current.filteredApplications[0].job.companyName).toBe("Google")
  })

  it("filters by job title case-insensitive", () => {
    const apps = [
      makeApp({ id: "1", job: { title: "Frontend Dev" } }),
      makeApp({ id: "2", job: { title: "Backend Dev" } }),
      makeApp({ id: "3", job: { title: "PM" } }),
    ]
    const { result } = renderHook(() => useJobFilters(apps, TODAY))

    act(() => {
      result.current.setSearchQuery("frontend")
    })

    expect(result.current.filteredApplications).toHaveLength(1)
    expect(result.current.filteredApplications[0].job.title).toBe("Frontend Dev")
  })

  it("combined search + status filter", () => {
    const apps = [
      makeApp({ id: "1", job: { companyName: "Google" }, status: ApplicationStatus.APPLIED }),
      makeApp({ id: "2", job: { companyName: "Google" }, status: ApplicationStatus.INTERVIEW }),
      makeApp({ id: "3", job: { companyName: "Acme Corp" }, status: ApplicationStatus.APPLIED }),
      makeApp({ id: "4", job: { companyName: "Acme Corp" }, status: ApplicationStatus.INTERVIEW }),
    ]
    const { result } = renderHook(() => useJobFilters(apps, TODAY))

    act(() => {
      result.current.setSearchQuery("google")
    })
    act(() => {
      result.current.setStatusFilter(ApplicationStatus.APPLIED)
    })

    expect(result.current.filteredApplications).toHaveLength(1)
    expect(result.current.filteredApplications[0].job.companyName).toBe("Google")
    expect(result.current.filteredApplications[0].status).toBe(ApplicationStatus.APPLIED)
  })

  it("ALL resets status filter", () => {
    const apps = [
      makeApp({ id: "1", status: ApplicationStatus.APPLIED }),
      makeApp({ id: "2", status: ApplicationStatus.INTERVIEW }),
    ]
    const { result } = renderHook(() => useJobFilters(apps, TODAY))

    act(() => {
      result.current.setStatusFilter(ApplicationStatus.REJECTED)
    })
    expect(result.current.filteredApplications).toHaveLength(0)

    act(() => {
      result.current.setStatusFilter("ALL")
    })
    expect(result.current.filteredApplications).toHaveLength(2)
  })

  it("returns empty array when nothing matches", () => {
    const apps = [
      makeApp({ id: "1", job: { companyName: "Google" } }),
      makeApp({ id: "2", job: { companyName: "Acme Corp" } }),
    ]
    const { result } = renderHook(() => useJobFilters(apps, TODAY))

    act(() => {
      result.current.setSearchQuery("zzz")
    })

    expect(result.current.filteredApplications).toHaveLength(0)
  })
})

describe("useJobFilters follow-up filter", () => {
  const past = new Date(TODAY.getTime() - 3 * 86_400_000)
  const future = new Date(TODAY.getTime() + 3 * 86_400_000)

  const apps = [
    // Overdue and still live — the only row the filter should keep.
    makeApp({ id: "due", status: ApplicationStatus.APPLIED, followUpAt: past }),
    makeApp({ id: "later", status: ApplicationStatus.APPLIED, followUpAt: future }),
    makeApp({ id: "none", status: ApplicationStatus.APPLIED, followUpAt: null }),
    // Past date, but the application is closed — not a chase.
    makeApp({ id: "dead", status: ApplicationStatus.REJECTED, followUpAt: past }),
    makeApp({ id: "saved", status: ApplicationStatus.INTERESTED, followUpAt: past }),
  ]

  it("defaults to showing every application", () => {
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.followUpFilter).toBe("ALL")
    expect(result.current.filteredApplications).toHaveLength(5)
  })

  it("keeps only overdue follow-ups on live applications", () => {
    const { result } = renderHook(() => useJobFilters(apps, TODAY))

    act(() => {
      result.current.setFollowUpFilter("FOLLOW_UP_DUE")
    })

    expect(result.current.filteredApplications.map((a) => a.id)).toEqual(["due"])
  })

  it("keeps a follow-up due on the user's today, before 08:00 in UTC+8", () => {
    // 06:00 on 12 Oct in UTC+8 is still 11 Oct in UTC; the stored day is 12 Oct.
    vi.setSystemTime(new Date("2026-10-11T22:00:00.000Z"))
    try {
      const dueToday = [
        makeApp({ id: "today", status: ApplicationStatus.APPLIED, followUpAt: TODAY }),
      ]
      const { result } = renderHook(() => useJobFilters(dueToday, TODAY, "FOLLOW_UP_DUE"))

      expect(result.current.filteredApplications.map((a) => a.id)).toEqual(["today"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("starts on the follow-up filter when initialised with it", () => {
    const { result } = renderHook(() => useJobFilters(apps, TODAY, "FOLLOW_UP_DUE"))

    expect(result.current.followUpFilter).toBe("FOLLOW_UP_DUE")
    expect(result.current.filteredApplications.map((a) => a.id)).toEqual(["due"])
  })

  it("combines with the search box", () => {
    const withNames = [
      makeApp({
        id: "due-google",
        status: ApplicationStatus.APPLIED,
        followUpAt: past,
        job: { companyName: "Google" },
      }),
      makeApp({
        id: "due-acme",
        status: ApplicationStatus.APPLIED,
        followUpAt: past,
        job: { companyName: "Acme Corp" },
      }),
    ]
    const { result } = renderHook(() => useJobFilters(withNames, TODAY, "FOLLOW_UP_DUE"))

    act(() => {
      result.current.setSearchQuery("google")
    })

    expect(result.current.filteredApplications.map((a) => a.id)).toEqual([
      "due-google",
    ])
  })
})

describe("useJobFilters confidence filter", () => {
  type Level = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"
  function withLevel(id: string, level: Level, status: ApplicationStatus = ApplicationStatus.APPLIED) {
    return makeApp({
      id,
      status,
      confidence: { level, score: 0, signals: [], summary: `${level}.` },
    })
  }

  const apps = [
    withLevel("high", "HIGH"),
    withLevel("medium", "MEDIUM"),
    withLevel("low", "LOW"),
    withLevel("unknown", "UNKNOWN"),
  ]

  function ids(result: { current: { filteredApplications: JobApplicationRow[] } }) {
    return result.current.filteredApplications.map((app) => app.id).sort()
  }

  it("defaults to showing every confidence level", () => {
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.confidenceFilter).toBe("ALL")
    expect(ids(result)).toEqual(["high", "low", "medium", "unknown"])
  })

  it("keeps a single level for HIGH and MEDIUM", () => {
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    act(() => result.current.setConfidenceFilter("HIGH"))
    expect(ids(result)).toEqual(["high"])
    act(() => result.current.setConfidenceFilter("MEDIUM"))
    expect(ids(result)).toEqual(["medium"])
  })

  it("groups LOW and UNKNOWN into one bucket", () => {
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    act(() => result.current.setConfidenceFilter("LOW_UNKNOWN"))
    expect(ids(result)).toEqual(["low", "unknown"])
  })

  it("combines with the status filter", () => {
    const mixed = [
      withLevel("low-applied", "LOW", ApplicationStatus.APPLIED),
      withLevel("low-interview", "LOW", ApplicationStatus.INTERVIEW),
      withLevel("high-interview", "HIGH", ApplicationStatus.INTERVIEW),
    ]
    const { result } = renderHook(() => useJobFilters(mixed, TODAY))
    act(() => {
      result.current.setConfidenceFilter("LOW_UNKNOWN")
      result.current.setStatusFilter(ApplicationStatus.INTERVIEW)
    })
    expect(ids(result)).toEqual(["low-interview"])
  })

  it("labels the grouped bucket 'Low / unknown'", () => {
    expect(CONFIDENCE_FILTER_OPTIONS.map((option) => option.value)).toEqual([
      "ALL",
      "HIGH",
      "MEDIUM",
      "LOW_UNKNOWN",
    ])
    expect(
      CONFIDENCE_FILTER_OPTIONS.find((option) => option.value === "LOW_UNKNOWN")?.label,
    ).toBe("Low / unknown")
  })

  it("orders HIGH to UNKNOWN when switched to the confidence sort", () => {
    const { result } = renderHook(() =>
      useJobFilters([apps[3], apps[2], apps[0], apps[1]], TODAY),
    )
    act(() => result.current.setSort("CONFIDENCE"))
    expect(result.current.filteredApplications.map((app) => app.id)).toEqual([
      "high",
      "medium",
      "low",
      "unknown",
    ])
  })
})

describe("parseFollowUpFilterParam", () => {
  it("maps the documented value onto the filter", () => {
    expect(parseFollowUpFilterParam("follow-up-due")).toBe("FOLLOW_UP_DUE")
  })

  it("falls back to ALL for anything else", () => {
    expect(parseFollowUpFilterParam(undefined)).toBe("ALL")
    expect(parseFollowUpFilterParam("")).toBe("ALL")
    expect(parseFollowUpFilterParam("FOLLOW_UP_DUE")).toBe("ALL")
  })
})

describe("buildStatusFilterOptions", () => {
  const counts: StatusFilterCounts = {
    INTERESTED: 2,
    APPLIED: 5,
    SCREENING: 0,
    INTERVIEW: 1,
    OFFER: 0,
    REJECTED: 3,
    WITHDRAWN: 0,
  }

  it("labels every status with its count and totals them for ALL", () => {
    const options = buildStatusFilterOptions(counts)

    expect(options[0]).toEqual({ value: "ALL", label: "All statuses (11)" })
    expect(options.map((option) => option.label)).toEqual([
      "All statuses (11)",
      "Interested (2)",
      "Applied (5)",
      "Screening (0)",
      "Interview (1)",
      "Offer (0)",
      "Rejected (3)",
      "Withdrawn (0)",
    ])
  })

  it("keeps every status option even when the user has none", () => {
    const empty = Object.fromEntries(
      Object.keys(counts).map((status) => [status, 0]),
    ) as StatusFilterCounts

    const options = buildStatusFilterOptions(empty)

    expect(options).toHaveLength(8)
    expect(options[0].label).toBe("All statuses (0)")
  })
})

describe("parseStatusParam / parseConfidenceParam", () => {
  it("accepts known values", () => {
    expect(parseStatusParam("APPLIED")).toBe("APPLIED")
    expect(parseStatusParam("INTERVIEW")).toBe("INTERVIEW")
    expect(parseConfidenceParam("HIGH")).toBe("HIGH")
    expect(parseConfidenceParam("LOW_UNKNOWN")).toBe("LOW_UNKNOWN")
  })

  it("falls back to ALL for anything else", () => {
    for (const bad of [null, undefined, "", "BOGUS", "applied", "ALL"]) {
      expect(parseStatusParam(bad)).toBe("ALL")
      expect(parseConfidenceParam(bad)).toBe("ALL")
    }
    expect(parseConfidenceParam("LOW")).toBe("ALL")
  })
})

describe("useJobFilters URL state", () => {
  const apps = [
    makeApp({ id: "1", status: ApplicationStatus.APPLIED, job: { companyName: "Acme" } }),
    makeApp({ id: "2", status: ApplicationStatus.INTERESTED, job: { companyName: "Beta" } }),
  ]

  afterEach(() => {
    vi.useRealTimers()
  })

  it("hydrates every param from the URL", () => {
    setUrl("q=acme&status=APPLIED&confidence=HIGH&sort=confidence&filter=follow-up-due")
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.searchQuery).toBe("acme")
    expect(result.current.statusFilter).toBe("APPLIED")
    expect(result.current.confidenceFilter).toBe("HIGH")
    expect(result.current.sort).toBe("CONFIDENCE")
    expect(result.current.followUpFilter).toBe("FOLLOW_UP_DUE")
  })

  it("hydrates sort=recent", () => {
    setUrl("sort=recent")
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.sort).toBe("RECENT")
  })

  it("filters the list by the hydrated values", () => {
    setUrl("status=INTERESTED")
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.filteredApplications.map((a) => a.id)).toEqual(["2"])
  })

  it("falls back to defaults for invalid values", () => {
    setUrl("status=BOGUS&confidence=nope&sort=sideways&filter=whatever")
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.statusFilter).toBe("ALL")
    expect(result.current.confidenceFilter).toBe("ALL")
    expect(result.current.sort).toBe("NEEDS_ACTION")
    expect(result.current.followUpFilter).toBe("ALL")
  })

  it("prefers the URL over the server-read props", () => {
    setUrl("sort=recent")
    const { result } = renderHook(() => useJobFilters(apps, TODAY, "FOLLOW_UP_DUE", "CONFIDENCE"))
    expect(result.current.sort).toBe("RECENT")
    // No `filter` param in the URL, so the prop still applies.
    expect(result.current.followUpFilter).toBe("FOLLOW_UP_DUE")
  })

  it("does not write the URL when everything is at its default", () => {
    vi.useFakeTimers()
    renderHook(() => useJobFilters(apps, TODAY))
    act(() => {
      vi.advanceTimersByTime(SEARCH_PARAM_DEBOUNCE_MS * 2)
    })
    expect(replace).not.toHaveBeenCalled()
  })

  it("does not rewrite a URL that already matches the state", () => {
    setUrl("status=APPLIED&sort=confidence")
    renderHook(() => useJobFilters(apps, TODAY))
    expect(replace).not.toHaveBeenCalled()
  })

  it("writes status, confidence, sort and filter immediately", () => {
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    act(() => result.current.setStatusFilter(ApplicationStatus.APPLIED))
    expect(replace).toHaveBeenLastCalledWith(null, "", "/jobs?status=APPLIED")
    act(() => result.current.setConfidenceFilter("MEDIUM"))
    expect(replace).toHaveBeenLastCalledWith(null, "", "/jobs?status=APPLIED&confidence=MEDIUM")
    act(() => result.current.setSort("CONFIDENCE"))
    expect(replace).toHaveBeenLastCalledWith(
      null,
      "",
      "/jobs?status=APPLIED&confidence=MEDIUM&sort=confidence",
    )
    act(() => result.current.setFollowUpFilter("FOLLOW_UP_DUE"))
    expect(replace).toHaveBeenLastCalledWith(
      null,
      "",
      "/jobs?status=APPLIED&confidence=MEDIUM&sort=confidence&filter=follow-up-due",
    )
  })

  it("deletes a param when it goes back to its default, keeping unrelated ones", () => {
    setUrl("status=APPLIED&sort=recent&utm=x")
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    act(() => result.current.setStatusFilter("ALL"))
    expect(replace).toHaveBeenLastCalledWith(null, "", "/jobs?sort=recent&utm=x")
  })

  it("debounces the q write but filters at once", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    act(() => result.current.setSearchQuery("ac"))
    act(() => result.current.setSearchQuery("acme"))
    expect(result.current.filteredApplications.map((a) => a.id)).toEqual(["1"])
    act(() => {
      vi.advanceTimersByTime(SEARCH_PARAM_DEBOUNCE_MS - 1)
    })
    expect(replace).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(null, "", "/jobs?q=acme")
  })

  it("remembers the list URL for the Job Detail back link", () => {
    window.sessionStorage.clear()
    setUrl("status=APPLIED")
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(window.sessionStorage.getItem(JOBS_LIST_HREF_STORAGE_KEY)).toBe("/jobs?status=APPLIED")
    act(() => result.current.setSort("RECENT"))
    expect(window.sessionStorage.getItem(JOBS_LIST_HREF_STORAGE_KEY)).toBe(
      "/jobs?status=APPLIED&sort=recent",
    )
  })

  it("re-reads the URL when a soft navigation changes it after mount", () => {
    const { result, rerender } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.statusFilter).toBe("ALL")
    setUrl("status=APPLIED&sort=confidence")
    rerender()
    expect(result.current.statusFilter).toBe("APPLIED")
    expect(result.current.sort).toBe("CONFIDENCE")
    expect(result.current.filteredApplications.map((a) => a.id)).toEqual(["1"])
    // The new URL already matches the state, so nothing is written back over it.
    expect(replace).not.toHaveBeenCalled()
  })

  it("clears the search box when the new URL carries no q", () => {
    setUrl("q=acme&status=APPLIED")
    const { result, rerender } = renderHook(() => useJobFilters(apps, TODAY))
    setUrl("status=INTERESTED")
    rerender()
    expect(result.current.searchQuery).toBe("")
    expect(result.current.statusFilter).toBe("INTERESTED")
    expect(result.current.filteredApplications.map((a) => a.id)).toEqual(["2"])
    expect(replace).not.toHaveBeenCalled()
  })

  it("does not reset the state when the URL changes to the hook's own write", () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(() => useJobFilters(apps, TODAY))
    act(() => result.current.setStatusFilter(ApplicationStatus.APPLIED))
    act(() => result.current.setSearchQuery("ac"))
    act(() => {
      vi.advanceTimersByTime(SEARCH_PARAM_DEBOUNCE_MS)
    })
    expect(replace).toHaveBeenLastCalledWith(null, "", "/jobs?q=ac&status=APPLIED")
    // Typing goes on while Next.js syncs the write into `useSearchParams`.
    act(() => result.current.setSearchQuery("acm"))
    const writes = replace.mock.calls.length
    setUrl("q=ac&status=APPLIED")
    rerender()
    expect(result.current.searchQuery).toBe("acm")
    expect(result.current.statusFilter).toBe("APPLIED")
    expect(replace).toHaveBeenCalledTimes(writes)
  })

  it("falls back to defaults when a soft navigation lands on invalid values", () => {
    setUrl("status=APPLIED")
    const { result, rerender } = renderHook(() => useJobFilters(apps, TODAY))
    setUrl("status=BOGUS")
    rerender()
    expect(result.current.statusFilter).toBe("ALL")
    expect(result.current.confidenceFilter).toBe("ALL")
    expect(result.current.sort).toBe("NEEDS_ACTION")
    expect(result.current.followUpFilter).toBe("ALL")
    // The invalid param is stripped, as on mount.
    expect(replace).toHaveBeenLastCalledWith(null, "", "/jobs")
  })
})

describe("useJobFilters stale filter", () => {
  const old = new Date(TODAY.getTime() - 45 * 86_400_000)
  const recent = new Date(TODAY.getTime() - 2 * 86_400_000)
  const apps = [
    makeApp({ id: "old-saved", status: ApplicationStatus.INTERESTED, createdAt: old }),
    makeApp({
      id: "past-deadline",
      status: ApplicationStatus.INTERESTED,
      createdAt: recent,
      job: { deadline: new Date(TODAY.getTime() - 86_400_000) },
    }),
    makeApp({ id: "fresh-saved", status: ApplicationStatus.INTERESTED, createdAt: recent }),
    // Old, but already applied — never stale.
    makeApp({ id: "old-applied", status: ApplicationStatus.APPLIED, createdAt: old }),
  ]

  it("parses only stale=1", () => {
    expect(parseStaleParam("1")).toBe(true)
    for (const bad of [null, undefined, "", "0", "true", "yes", "2"]) {
      expect(parseStaleParam(bad)).toBe(false)
    }
  })

  it("defaults to off and shows every application", () => {
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.staleFilter).toBe(false)
    expect(result.current.filteredApplications).toHaveLength(4)
  })

  it("keeps only stale saved jobs when stale=1", () => {
    setUrl("stale=1")
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.staleFilter).toBe(true)
    expect(result.current.filteredApplications.map((a) => a.id).sort()).toEqual([
      "old-saved",
      "past-deadline",
    ])
    expect(replace).not.toHaveBeenCalled()
  })

  it("writes stale=1 when toggled on", () => {
    setUrl("utm=x")
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    act(() => result.current.setStaleFilter(true))
    expect(replace).toHaveBeenLastCalledWith(null, "", "/jobs?utm=x&stale=1")
  })

  it("deletes stale when toggled off, keeping unrelated params", () => {
    setUrl("stale=1&utm=x")
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    act(() => result.current.setStaleFilter(false))
    expect(replace).toHaveBeenLastCalledWith(null, "", "/jobs?utm=x")
  })

  it("strips an invalid stale value", () => {
    setUrl("stale=yes&status=INTERESTED")
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.staleFilter).toBe(false)
    expect(replace).toHaveBeenLastCalledWith(null, "", "/jobs?status=INTERESTED")
  })

  it("hydrates the saved sorts from the URL and writes them back", () => {
    setUrl("sort=saved-oldest")
    const { result } = renderHook(() => useJobFilters(apps, TODAY))
    expect(result.current.sort).toBe("SAVED_OLDEST")
    expect(replace).not.toHaveBeenCalled()
    act(() => result.current.setSort("SAVED_NEWEST"))
    expect(replace).toHaveBeenLastCalledWith(null, "", "/jobs?sort=saved-newest")
  })
})
