import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { localCalendarDateString } from "@/shared/lib/dates"
import { assessOpportunityConfidence } from "@/features/discovery/services/opportunity-confidence.service"
import { describeNextStep } from "../../services/application-next-step.service"
import { quickActionsFor } from "../../services/application-quick-actions"
import { JobApplicationList } from "../job-application-list"
import type { JobApplicationCardData } from "../job-application-card"
import type { JobApplicationRowJob } from "../../hooks/use-job-filters"

/** Fixed so the converted-salary assertions are arithmetic, not a live rate. */
const FX_RATE = 58

/** The user's calendar day, as `/jobs/page.tsx` hands it in. */
const TODAY = new Date(Date.UTC(2026, 9, 12))

const STATUS_COUNTS = {
  INTERESTED: 1,
  APPLIED: 2,
  SCREENING: 0,
  INTERVIEW: 0,
  OFFER: 0,
  REJECTED: 0,
  WITHDRAWN: 0,
}

const createJobApplication = vi.fn()
const updateJobApplication = vi.fn()
const updateJobApplicationStatus = vi.fn()
const deleteJobApplication = vi.fn()
const deleteJobApplications = vi.fn()
const clearJobApplicationFollowUp = vi.fn()
const scheduleJobApplicationFollowUp = vi.fn()
const snoozeJobApplicationFollowUp = vi.fn()
const recheckJobQualification = vi.fn()
const refresh = vi.fn()
const push = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: (...args: unknown[]) => refresh(...args),
    push: (...args: unknown[]) => push(...args),
    replace: vi.fn(),
  }),
  // `useJobFilters` mirrors its state into the URL.
  usePathname: () => "/jobs",
  useSearchParams: () => emptySearchParams,
}))

const emptySearchParams = new URLSearchParams()

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

vi.mock("../../actions/job-application.actions", () => ({
  createJobApplication: (...args: unknown[]) => createJobApplication(...args),
  updateJobApplication: (...args: unknown[]) => updateJobApplication(...args),
  updateJobApplicationStatus: (...args: unknown[]) =>
    updateJobApplicationStatus(...args),
  deleteJobApplication: (...args: unknown[]) => deleteJobApplication(...args),
  deleteJobApplications: (...args: unknown[]) => deleteJobApplications(...args),
  clearJobApplicationFollowUp: (...args: unknown[]) =>
    clearJobApplicationFollowUp(...args),
  scheduleJobApplicationFollowUp: (...args: unknown[]) =>
    scheduleJobApplicationFollowUp(...args),
  snoozeJobApplicationFollowUp: (...args: unknown[]) =>
    snoozeJobApplicationFollowUp(...args),
}))

// The "Check fit" quick action reaches a second server-action module; unmocked
// it drags `next-auth` into jsdom at import time.
vi.mock("../../actions/job-qualification.actions", () => ({
  recheckJobQualification: (...args: unknown[]) => recheckJobQualification(...args),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  createJobApplication.mockResolvedValue({ success: true, id: "new-id" })
  updateJobApplicationStatus.mockResolvedValue({ success: true })
  updateJobApplication.mockResolvedValue({ success: true })
  deleteJobApplication.mockResolvedValue({ success: true })
  deleteJobApplications.mockResolvedValue({ success: true, deletedCount: 2, skippedIds: [] })
  clearJobApplicationFollowUp.mockResolvedValue({ success: true })
  scheduleJobApplicationFollowUp.mockResolvedValue({ success: true })
  snoozeJobApplicationFollowUp.mockResolvedValue({ success: true })
  recheckJobQualification.mockResolvedValue({
    success: true,
    verdict: "WORTH_A_LOOK",
    checkedAt: "2026-09-14T00:00:00.000Z",
  })
})

/**
 * `verdict`, `confidence`, `provenance` and `nextStep` are computed on the
 * server by `/jobs/page.tsx`, so the fixture computes them the same way — with
 * the real services and the reader's own calendar day — unless a test pins one.
 */
function makeApplication(
  overrides: Partial<Omit<JobApplicationCardData, "job">> & {
    job?: Partial<JobApplicationRowJob>
  } = {}
): JobApplicationCardData {
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
    status: "INTERESTED" as const,
    dateApplied: new Date("2026-07-01T00:00:00.000Z"),
    interviewDate: null,
    followUpAt: null,
    outcomeAt: null,
    contact: null,
    notes: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    coverLetters: [],
    _count: { coverLetters: 0 },
    ...applicationOverrides,
    job: {
      companyName: "Globex",
      title: "Staff Engineer",
      location: "Remote",
      salary: 185000,
      salaryPeriod: null,
      salaryCurrency: "USD" as const,
      deadline: null,
      url: null,
      description: null,
      jobType: "FULL_TIME" as const,
      workType: null,
      riskLevel: null,
      ...job,
    },
  }

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
    provenance: provenance ?? "Added manually · Posting date unknown · Seen Jun 1, 2026",
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

/**
 * The status filter renders the same status words as `<option>`s, so status
 * assertions are scoped to the card that owns the company link.
 */
function cardFor(company: string): HTMLElement {
  const card = screen
    .getByRole("link", { name: company })
    .closest("div.bg-card") as HTMLElement | null
  if (!card) throw new Error(`No card found for ${company}`)
  return card
}

describe("JobApplicationList grid", () => {
  it("renders a card per application with company, title and status", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication(),
          makeApplication({
            id: "app-2",
            job: { companyName: "Initech", title: "Designer" },
            status: "OFFER",
          }),
        ]}
      />
    )

    const globex = cardFor("Globex")
    expect(globex.textContent).toMatch("Staff Engineer")
    expect(globex.textContent).toMatch("Interested")
    expect(globex.textContent).toMatch("Remote")
    expect(globex.textContent).toMatch("$185,000 / year")
    expect(globex.textContent).toMatch("Full-time")
    // The formatted date itself is locale/timezone dependent — only the label
    // and the year are asserted so the test does not encode the runner's zone.
    expect(globex.textContent).toMatch(/Applied \w+ \d+, 2026/)

    const initech = cardFor("Initech")
    expect(initech.textContent).toMatch("Designer")
    expect(initech.textContent).toMatch("Offer")

    expect(screen.getByRole("link", { name: "Globex" }).getAttribute("href")).toBe(
      "/jobs/app-1"
    )
  })

  it("shows the empty state when there are no applications at all", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[]}
      />,
    )
    expect(screen.getByText("No applications yet")).toBeTruthy()
  })

  it("opens the create dialog from the empty state CTA", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[]}
      />,
    )

    const cta = screen.getByRole("button", { name: "Add your first application" })
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(cta)

    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByLabelText("Company")).toBeTruthy()
  })

  it("hides non-matching cards on search and shows the no-results state", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication(),
          makeApplication({ id: "app-2", job: { companyName: "Initech" } }),
        ]}
      />
    )

    fireEvent.change(screen.getByLabelText("Search applications"), {
      target: { value: "initech" },
    })
    expect(screen.queryByText("Globex")).toBe(null)
    expect(screen.getByText("Initech")).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Search applications"), {
      target: { value: "nothing matches this" },
    })
    expect(screen.queryByText("Initech")).toBe(null)
    expect(screen.getByText("No results")).toBeTruthy()
  })

  it("filters by status", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication(),
          makeApplication({
            id: "app-2",
            job: { companyName: "Initech" },
            status: "OFFER",
          }),
        ]}
      />
    )

    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "OFFER" },
    })
    expect(screen.queryByText("Globex")).toBe(null)
    expect(screen.getByText("Initech")).toBeTruthy()
  })

  it("labels each status option with the server-side count", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[makeApplication()]}
      />,
    )

    const select = screen.getByLabelText("Filter by status") as HTMLSelectElement
    const labels = Array.from(select.options).map((option) => option.text)

    // Counts come from STATUS_COUNTS, not from the single rendered card.
    expect(labels[0]).toBe("All statuses (3)")
    expect(labels).toContain("Interested (1)")
    expect(labels).toContain("Applied (2)")
    expect(labels).toContain("Offer (0)")
  })
})

describe("JobApplicationList quick actions", () => {
  /** The list under test, with whatever rows the case needs. */
  function renderList(applications: JobApplicationCardData[]) {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={applications}
      />,
    )
  }

  it("offers Mark applied and Open on a saved job that already has a verdict", () => {
    renderList([makeApplication({ verdict: "STRONG" })])

    expect(
      screen.getByRole("button", { name: "Mark Globex as applied" }).textContent,
    ).toMatch("Mark applied")
    expect(
      screen.getByRole("link", { name: "Open — Globex" }).getAttribute("href"),
    ).toBe("/jobs/app-1")
  })

  it("offers Check fit instead when the row has no verdict", async () => {
    renderList([makeApplication()])

    expect(screen.queryByRole("button", { name: "Mark Globex as applied" })).toBeNull()
    const button = screen.getByRole("button", {
      name: "Check how Globex fits your Career Profile",
    })
    expect(button.textContent).toMatch("Check fit")

    fireEvent.click(button)

    await waitFor(() =>
      expect(recheckJobQualification).toHaveBeenCalledWith("app-1"),
    )
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Fit checked"))
  })

  it("offers Done and Snooze on an overdue follow-up", () => {
    renderList([
      makeApplication({
        status: "APPLIED",
        followUpAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    ])

    expect(
      screen.getByRole("button", {
        name: "Mark the follow-up for Globex as done",
      }).textContent,
    ).toMatch("Done")
    expect(
      screen.getByRole("button", {
        name: "Snooze the follow-up for Globex by 1 week",
      }).textContent,
    ).toMatch("Snooze 1 week")
  })

  it("offers scheduling one on an application with no follow-up", () => {
    renderList([makeApplication({ status: "APPLIED" })])

    expect(
      screen.getByRole("button", {
        name: "Schedule a follow-up for Globex in 1 week",
      }).textContent,
    ).toMatch("Schedule follow-up")
  })

  it("offers nothing to press on a closed application", () => {
    renderList([
      makeApplication({
        status: "REJECTED",
        outcomeAt: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ])

    expect(screen.queryByText("Mark applied")).toBeNull()
    expect(screen.queryByText("Done")).toBeNull()
    expect(screen.queryByText("Schedule follow-up")).toBeNull()
  })

  it("drops the Create cover letter control on a closed application", () => {
    renderList([
      makeApplication({ status: "REJECTED" }),
      makeApplication({ id: "app-2", job: { companyName: "Initech" } }),
    ])

    expect(
      screen.queryByRole("link", { name: "Create cover letter for Globex" }),
    ).toBeNull()
    // The live row keeps it, so the control has not simply disappeared.
    expect(
      screen.getByRole("link", { name: "Create cover letter for Initech" }),
    ).toBeTruthy()
  })

  it("snoozes through the same action the job page uses, then refreshes", async () => {
    renderList([
      makeApplication({
        status: "APPLIED",
        followUpAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    ])

    fireEvent.click(
      screen.getByRole("button", {
        name: "Snooze the follow-up for Globex by 1 week",
      }),
    )

    await waitFor(() =>
      expect(snoozeJobApplicationFollowUp).toHaveBeenCalledWith(
        "app-1",
        localCalendarDateString(),
      ),
    )
    expect(toastSuccess).toHaveBeenCalledWith("Follow-up snoozed for a week")
    expect(refresh).toHaveBeenCalled()
  })

  it("reports a failed quick action and leaves the list alone", async () => {
    snoozeJobApplicationFollowUp.mockResolvedValue({ error: "Not found" })
    renderList([
      makeApplication({
        status: "APPLIED",
        followUpAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    ])

    fireEvent.click(
      screen.getByRole("button", {
        name: "Snooze the follow-up for Globex by 1 week",
      }),
    )

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not found"))
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe("JobApplicationList next-step line", () => {
  it("shows the outcome date on a terminal-status card", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication({
            status: "REJECTED",
            outcomeAt: new Date("2026-09-09T00:00:00.000Z"),
          }),
        ]}
      />
    )

    expect(cardFor("Globex").textContent).toMatch("Closed Sep 9, 2026")
  })

  it("says nothing for an application still in flight", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication({
            status: "INTERVIEW",
            outcomeAt: new Date("2026-09-09T00:00:00.000Z"),
          }),
        ]}
      />
    )

    expect(cardFor("Globex").textContent).not.toMatch("Sep 9, 2026")
  })

  it("says only Closed for a terminal application with no recorded date", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[makeApplication({ status: "WITHDRAWN", outcomeAt: null })]}
      />
    )

    const card = cardFor("Globex")
    expect(card.textContent).toMatch("Closed")
    expect(card.textContent).not.toMatch(/Closed \w/)
  })

  it("replaces the old overdue badge with one overdue instruction", () => {
    // A calendar date, counted from the reader own day start the way the
    // column stores one.
    const followUpAt = new Date(
      TODAY.getTime() -
        3 * 86_400_000,
    )
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[makeApplication({ status: "APPLIED", followUpAt })]}
      />,
    )

    const card = cardFor("Globex")
    expect(card.textContent).toMatch("Follow up — 3 days overdue")
    expect(card.textContent).not.toMatch("Follow up overdue")
  })

  it("drops the Not-applied-yet filler in favour of the decision to make", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[makeApplication({ dateApplied: null })]}
      />,
    )

    const card = cardFor("Globex")
    expect(card.textContent).toMatch("Review and decide")
    expect(card.textContent).not.toMatch("Not applied yet")
  })
})

describe("JobApplicationList fit, confidence and provenance", () => {
  it("badges the stored verdict before the posting confidence", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[makeApplication({ verdict: "STRONG" })]}
      />,
    )

    const card = cardFor("Globex")
    const badges = Array.from(card.querySelectorAll("span")).map((el) => el.textContent)
    expect(badges).toContain("Strong fit")
    const confidenceIndex = badges.findIndex((text) => text?.endsWith("confidence"))
    expect(confidenceIndex).toBeGreaterThan(-1)
    expect(badges.indexOf("Strong fit")).toBeLessThan(confidenceIndex)
  })

  it("spells out the negative confidence signals inline on a LOW row", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication({
            confidence: {
              level: "LOW",
              score: -4,
              signals: [
                { key: "provenance", label: "Job board listing", tone: "neutral" },
                { key: "freshness", label: "Posted 4 months ago", tone: "negative" },
                { key: "employer", label: "Employer not named", tone: "negative" },
                { key: "completeness", label: "No posting text", tone: "negative" },
              ],
              summary:
                "Job board listing, posted 4 months ago, employer not named, no posting text.",
            },
          }),
        ]}
      />,
    )

    const reasons = cardFor("Globex").querySelector('[data-testid="confidence-reasons"]')
    // Only the first two negatives, joined; the neutral signal is not a reason.
    expect(reasons?.textContent).toBe("Posted 4 months ago · Employer not named")
    expect(reasons?.className).toContain("truncate")
    // The tooltip still carries the full sentence.
    expect(screen.getByText("Low confidence").getAttribute("title")).toContain(
      "no posting text",
    )
  })

  it("adds nothing beside the badge for a HIGH row with no negatives", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication({
            confidence: {
              level: "HIGH",
              score: 6,
              signals: [
                { key: "provenance", label: "Official ATS board", tone: "positive" },
                { key: "freshness", label: "Posted 2 days ago", tone: "positive" },
                { key: "employer", label: "Named employer", tone: "positive" },
              ],
              summary: "Official ATS board, posted 2 days ago, named employer.",
            },
          }),
        ]}
      />,
    )

    const card = cardFor("Globex")
    expect(screen.getByText("High confidence")).toBeTruthy()
    expect(card.querySelector('[data-testid="confidence-reasons"]')).toBeNull()
    expect(card.textContent).not.toMatch("Official ATS board")
  })

  it("narrows the list with the confidence filter, grouping LOW and UNKNOWN", () => {
    const at = (id: string, company: string, level: "HIGH" | "LOW" | "UNKNOWN") =>
      makeApplication({
        id,
        job: { companyName: company },
        confidence: { level, score: 0, signals: [], summary: `${level}.` },
      })
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          at("a", "HighCo", "HIGH"),
          at("b", "LowCo", "LOW"),
          at("c", "UnknownCo", "UNKNOWN"),
        ]}
      />,
    )

    fireEvent.change(screen.getByLabelText("Filter by confidence"), {
      target: { value: "LOW_UNKNOWN" },
    })

    expect(screen.queryByRole("link", { name: "HighCo" })).toBeNull()
    expect(screen.getByRole("link", { name: "LowCo" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "UnknownCo" })).toBeTruthy()
  })

  it("omits the verdict badge when the posting was never qualified", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[makeApplication()]}
      />,
    )

    expect(cardFor("Globex").textContent).not.toMatch("Strong fit")
  })

  it("shows the provenance line the job detail page uses", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication({ provenance: "Kalibrr · Posted Sep 8, 2026" }),
        ]}
      />,
    )

    expect(cardFor("Globex").textContent).toMatch("Kalibrr · Posted Sep 8, 2026")
  })
})

describe("JobApplicationList sort", () => {
  function twoRows() {
    return [
      // Updated far more recently, but there is nothing left to do about it.
      makeApplication({
        id: "closed",
        status: "REJECTED",
        outcomeAt: new Date("2026-09-09T00:00:00.000Z"),
        updatedAt: new Date("2026-09-10T00:00:00.000Z"),
        job: { companyName: "Initech" },
      }),
      makeApplication({
        id: "urgent",
        status: "APPLIED",
        followUpAt: new Date(
          TODAY.getTime() -
            2 * 86_400_000,
        ),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ]
  }

  function companyOrder(): string[] {
    return Array.from(document.querySelectorAll("h3 a")).map(
      (el) => el.textContent ?? "",
    )
  }

  it("puts the row that needs action first by default", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={twoRows()}
      />,
    )

    expect(companyOrder()).toEqual(["Globex", "Initech"])
  })

  it("switches to most recently updated on request", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={twoRows()}
      />,
    )

    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "RECENT" } })
    expect(companyOrder()).toEqual(["Initech", "Globex"])
  })

  it("honours the order the server was asked for", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        initialSort="RECENT"
        applications={twoRows()}
      />,
    )

    expect(companyOrder()).toEqual(["Initech", "Globex"])
  })
})

describe("JobApplicationList deadlines", () => {
  it("flags a deadline inside the next week", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication({ job: { deadline: new Date("2026-10-15T00:00:00.000Z") } }),
        ]}
      />
    )
    expect(cardFor("Globex").textContent).toMatch(/Deadline \w+ \d+, 2026/)
    expect(cardFor("Globex").textContent).toMatch("3d left")
  })

  it("leaves a distant deadline untinted", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication({ job: { deadline: new Date("2026-12-12T00:00:00.000Z") } }),
        ]}
      />
    )
    const card = cardFor("Globex")
    expect(card.textContent).toMatch(/Deadline \w+ \d+, 2026/)
    expect(card.textContent).not.toMatch("left")
    expect(card.className).not.toMatch("border-warning")
  })
})

describe("JobApplicationList cover letter action", () => {
  it("opens the most recent letter when the application has one", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication({
            coverLetters: [
              { id: "letter-1", updatedAt: new Date("2026-07-10T00:00:00.000Z") },
            ],
            _count: { coverLetters: 2 },
          }),
        ]}
      />
    )

    const link = screen.getByRole("link", {
      name: "Open cover letter for Globex (2 cover letters)",
    })
    expect(link.getAttribute("href")).toBe("/jobs/cover-letter/letter-1")
    // The badge tells the user more letters exist behind the one that opens.
    expect(screen.getByText("2")).toBeTruthy()
  })

  it("labels the salary with its period, defaulting legacy rows to yearly", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication(),
          makeApplication({
            id: "app-2",
            job: {
              companyName: "Initech",
              salary: 4500,
              salaryPeriod: "MONTHLY",
            },
          }),
        ]}
      />
    )

    expect(cardFor("Globex").textContent).toMatch("$185,000 / year")
    expect(cardFor("Initech").textContent).toMatch("$4,500 / month")
  })

  it("shows the yearly equivalents converted at the supplied rate", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication(),
          makeApplication({
            id: "app-2",
            job: { companyName: "Initech", salary: 50, salaryPeriod: "HOURLY" },
          }),
        ]}
      />
    )

    // Already yearly: only the preferred currency is worth showing.
    expect(cardFor("Globex").textContent).toMatch("≈ ₱10,730,000 / year")
    expect(cardFor("Initech").textContent).toMatch(
      "≈ $104,000 / year · ₱6,032,000 / year"
    )
  })

  it("converts into the user's preferred currency", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="USD"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication({
            job: {
              companyName: "Initech",
              salary: 80000,
              salaryPeriod: "MONTHLY",
              salaryCurrency: "PHP",
            },
          }),
        ]}
      />
    )

    expect(cardFor("Initech").textContent).toMatch(
      "≈ ₱960,000 / year · $16,552 / year"
    )
  })

  it("annualises a sub-yearly salary already in the preferred currency", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="USD"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication({
            job: { companyName: "Initech", salary: 50, salaryPeriod: "HOURLY" },
          }),
        ]}
      />
    )

    // No conversion, so no second figure and no rate in the tooltip.
    const equivalents = cardFor("Initech").querySelector(
      '[title="Approximate yearly equivalent"]'
    )
    expect(equivalents?.textContent).toBe("≈ $104,000 / year")
  })

  it("omits the equivalents line when the salary is already in the preferred currency", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="USD"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[makeApplication()]}
      />
    )

    expect(cardFor("Globex").textContent).toMatch("$185,000 / year")
    expect(cardFor("Globex").textContent).not.toMatch("≈")
  })

  it("links to the create route when the application has no letter", () => {
    render(<JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[makeApplication()]}
      />)

    const link = screen.getByRole("link", {
      name: "Create cover letter for Globex",
    })
    expect(link.getAttribute("href")).toBe("/jobs/cover-letter/new?jobId=app-1")
  })
})

describe("JobApplicationList create dialog", () => {
  function submitCreate(status: string) {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[]}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Add application" }))
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Acme" },
    })
    fireEvent.change(screen.getByLabelText("Job title"), {
      target: { value: "Engineer" },
    })
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: status },
    })
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!)
  }

  it("creates without a status then transitions to APPLIED so XP fires", async () => {
    submitCreate("APPLIED")

    await waitFor(() => expect(updateJobApplicationStatus).toHaveBeenCalled())
    const formData = createJobApplication.mock.calls[0][0] as FormData
    expect(formData.has("status")).toBe(false)
    expect(formData.get("companyName")).toBe("Acme")
    expect(formData.get("jobTitle")).toBe("Engineer")
    expect(updateJobApplicationStatus).toHaveBeenCalledWith(
      "new-id",
      "APPLIED",
      localCalendarDateString()
    )
    // The success toast carries an "Open" action to the new job's detail page.
    expect(toastSuccess).toHaveBeenCalledWith("Application added", {
      action: { label: "Open", onClick: expect.any(Function) },
    })
    const toastOptions = toastSuccess.mock.calls[0][1] as {
      action: { onClick: () => void }
    }
    toastOptions.action.onClick()
    expect(push).toHaveBeenCalledWith("/jobs/new-id")
  })

  it("uses a single create call for any other status", async () => {
    submitCreate("INTERVIEW")

    await waitFor(() => expect(createJobApplication).toHaveBeenCalled())
    const formData = createJobApplication.mock.calls[0][0] as FormData
    expect(formData.get("status")).toBe("INTERVIEW")
    expect(updateJobApplicationStatus).not.toHaveBeenCalled()
  })

  it("omits blank optional fields so the create schema does not reject them", async () => {
    submitCreate("INTERESTED")

    await waitFor(() => expect(createJobApplication).toHaveBeenCalled())
    const formData = createJobApplication.mock.calls[0][0] as FormData
    expect(formData.has("jobType")).toBe(false)
    expect(formData.has("salary")).toBe(false)
    expect(formData.has("salaryPeriod")).toBe(false)
    expect(formData.has("notes")).toBe(false)
  })

  it("sends the chosen salary period alongside the amount", async () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[]}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Add application" }))
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme" } })
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Engineer" } })
    fireEvent.change(screen.getByLabelText("Salary"), { target: { value: "4500" } })
    fireEvent.change(screen.getByLabelText("Salary period"), {
      target: { value: "MONTHLY" },
    })
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!)

    await waitFor(() => expect(createJobApplication).toHaveBeenCalled())
    const formData = createJobApplication.mock.calls[0][0] as FormData
    expect(formData.get("salary")).toBe("4500")
    expect(formData.get("salaryPeriod")).toBe("MONTHLY")
  })
})

describe("JobApplicationList delete flow", () => {
  it("deletes only after the confirmation is accepted", async () => {
    render(<JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[makeApplication()]}
      />)

    fireEvent.click(screen.getByRole("button", { name: "Delete Globex" }))
    expect(deleteJobApplication).not.toHaveBeenCalled()

    const dialog = screen.getByRole("dialog")
    expect(dialog.textContent).toMatch(/unlinked, not\s+deleted/)

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(deleteJobApplication).toHaveBeenCalledWith("app-1"))
    expect(toastSuccess).toHaveBeenCalledWith("Application deleted")
    expect(refresh).toHaveBeenCalled()
  })

  it("keeps the card and surfaces the error when the delete fails", async () => {
    deleteJobApplication.mockResolvedValue({ error: "Not found" })
    render(<JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[makeApplication()]}
      />)

    fireEvent.click(screen.getByRole("button", { name: "Delete Globex" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not found"))
    expect(screen.getByText("Globex")).toBeTruthy()
  })
})

describe("JobApplicationList bulk delete", () => {
  function renderThree() {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[
          makeApplication(),
          makeApplication({ id: "app-2", job: { companyName: "Initech", title: "Designer" } }),
          makeApplication({ id: "app-3", job: { companyName: "Umbrella", title: "Chemist" } }),
        ]}
      />,
    )
  }

  it("shows a labelled checkbox on each card only in select mode", () => {
    renderThree()
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "Select" }))

    expect(screen.getAllByRole("checkbox")).toHaveLength(3)
    expect(
      screen.getByRole("checkbox", { name: "Select Staff Engineer at Globex" }),
    ).toBeTruthy()
    expect(screen.getByText("0 selected")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Select" }))
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
  })

  it("deletes exactly the ticked rows after confirmation, then clears the selection", async () => {
    renderThree()
    fireEvent.click(screen.getByRole("button", { name: "Select" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Staff Engineer at Globex" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Chemist at Umbrella" }))
    expect(screen.getByText("2 selected")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }))
    expect(deleteJobApplications).not.toHaveBeenCalled()
    const dialog = screen.getByRole("dialog")
    expect(dialog.textContent).toMatch("Delete 2 saved jobs?")
    expect(dialog.textContent).toMatch("cannot be undone")

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(deleteJobApplications).toHaveBeenCalledTimes(1))
    expect([...deleteJobApplications.mock.calls[0][0]].sort()).toEqual(["app-1", "app-3"])
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Deleted 2 jobs"))
    expect(refresh).toHaveBeenCalled()
    // Select mode is left and the selection is gone.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Select" }))
    expect(screen.getByText("0 selected")).toBeTruthy()
  })

  it("mentions skipped rows and keeps the selection when the delete fails", async () => {
    deleteJobApplications.mockResolvedValueOnce({
      success: true,
      deletedCount: 1,
      skippedIds: ["app-2"],
    })
    renderThree()
    fireEvent.click(screen.getByRole("button", { name: "Select" }))
    fireEvent.click(screen.getByRole("button", { name: "Select all on this page" }))
    expect(screen.getByText("3 selected")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Deleted 1 job (1 skipped)"),
    )

    deleteJobApplications.mockResolvedValueOnce({ error: "Invalid selection" })
    fireEvent.click(screen.getByRole("button", { name: "Select" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Designer at Initech" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Invalid selection"))
    expect(screen.getByText("1 selected")).toBeTruthy()
  })

  it("clears the selection with Clear", () => {
    renderThree()
    fireEvent.click(screen.getByRole("button", { name: "Select" }))
    fireEvent.click(screen.getByRole("button", { name: "Select all on this page" }))
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(screen.getByText("0 selected")).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "Delete selected" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe("JobApplicationList edit dialog", () => {
  it("routes a status change through the XP-awarding action", async () => {
    render(<JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={TODAY}
        applications={[makeApplication()]}
      />)

    fireEvent.click(screen.getByRole("button", { name: "Edit Globex" }))
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "APPLIED" },
    })
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!)

    await waitFor(() => expect(updateJobApplication).toHaveBeenCalled())
    const [id, formData] = updateJobApplication.mock.calls[0] as [string, FormData]
    expect(id).toBe("app-1")
    expect(formData.has("status")).toBe(false)
    expect(formData.get("companyName")).toBe("Globex")
    await waitFor(() =>
      expect(updateJobApplicationStatus).toHaveBeenCalledWith(
        "app-1",
        "APPLIED",
        localCalendarDateString()
      )
    )
  })
})

describe("JobApplicationList on the user's calendar day", () => {
  // 06:00 on 12 Oct for a UTC+8 reader, still 11 Oct in UTC. The page hands the
  // list the user's day; nothing on screen may fall back to the raw clock.
  const NOW = new Date("2026-10-11T22:00:00.000Z")
  const USER_TODAY = new Date(Date.UTC(2026, 9, 12))

  beforeEach(() => vi.setSystemTime(NOW))
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("counts and keeps a follow-up due on the user's today before 08:00", () => {
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={USER_TODAY}
        initialFollowUpFilter="FOLLOW_UP_DUE"
        applications={[makeApplication({ status: "APPLIED", followUpAt: USER_TODAY })]}
      />,
    )

    expect(screen.getByRole("option", { name: "Follow-up overdue (1)" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Globex" })).toBeTruthy()
  })

  it("counts a deadline's days left from the user's day, not the host's", () => {
    // A server render on a UTC host.
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0)
    render(
      <JobApplicationList
        usdPhpRate={FX_RATE}
        preferredCurrency="PHP"
        statusCounts={STATUS_COUNTS}
        today={USER_TODAY}
        applications={[makeApplication({ job: { deadline: USER_TODAY } })]}
      />,
    )

    const card = cardFor("Globex")
    expect(card.textContent).toMatch("Due today")
    expect(card.textContent).not.toMatch("1d left")
  })
})

describe("JobApplicationList paging", () => {
  /** `count` rows named Company 01..N so each card is findable by its link. */
  function manyApplications(count: number, overrides: { status?: "APPLIED" } = {}) {
    return Array.from({ length: count }, (_, index) => {
      const n = String(index + 1).padStart(2, "0")
      return makeApplication({
        id: `app-${n}`,
        // Newest first under RECENT, so Company 01 leads the list.
        createdAt: new Date(Date.UTC(2026, 5, 30 - index)),
        ...overrides,
        job: { companyName: `Company ${n}` },
      })
    })
  }

  function renderList(applications: JobApplicationCardData[]) {
    return render(
      <JobApplicationList
        applications={applications}
        usdPhpRate={FX_RATE}
        preferredCurrency="USD"
        statusCounts={STATUS_COUNTS}
        initialSort="RECENT"
        today={TODAY}
      />,
    )
  }

  function cardCount() {
    return screen.queryAllByRole("link", { name: /^Company \d\d$/ }).length
  }

  it("shows every row and no pager when twelve or fewer match", () => {
    renderList(manyApplications(12))
    expect(cardCount()).toBe(12)
    expect(screen.getByText("Showing 1–12 of 12")).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Application pages" })).toBeNull()
  })

  it("pages the list at twelve with Previous and Next", () => {
    renderList(manyApplications(30))
    const pager = screen.getByRole("navigation", { name: "Application pages" })
    expect(cardCount()).toBe(12)
    expect(screen.getByText("Showing 1–12 of 30")).toBeTruthy()
    expect(pager.textContent).toContain("Page 1 of 3")
    expect(
      (screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Showing 13–24 of 30")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Company 01" })).toBeNull()
    expect(screen.getByRole("link", { name: "Company 13" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Showing 25–30 of 30")).toBeTruthy()
    expect(cardCount()).toBe(6)
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it("returns to page 1 when a filter changes", () => {
    const applications = [
      ...manyApplications(20),
      ...manyApplications(15, { status: "APPLIED" }).map((application, index) => ({
        ...application,
        id: `applied-${index}`,
      })),
    ]
    renderList(applications)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Showing 13–24 of 35")).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "APPLIED" },
    })
    expect(screen.getByText("Showing 1–12 of 15")).toBeTruthy()
    expect(
      screen.getByRole("navigation", { name: "Application pages" }).textContent,
    ).toContain("Page 1 of 2")
  })

  it("returns to page 1 on search and drops the pager when one page is left", () => {
    renderList(manyApplications(30))
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    fireEvent.change(screen.getByLabelText("Search applications"), {
      target: { value: "Company 2" },
    })
    // Company 20..29.
    expect(screen.getByText("Showing 1–10 of 10")).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Application pages" })).toBeNull()
  })

  it("clamps to the last page when rows drop out under it", () => {
    const { rerender } = renderList(manyApplications(25))
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Showing 25–25 of 25")).toBeTruthy()

    rerender(
      <JobApplicationList
        applications={manyApplications(24)}
        usdPhpRate={FX_RATE}
        preferredCurrency="USD"
        statusCounts={STATUS_COUNTS}
        initialSort="RECENT"
        today={TODAY}
      />,
    )
    expect(screen.getByText("Showing 13–24 of 24")).toBeTruthy()
  })

  it("scrolls the list top into view on a page change only when it is above the viewport", () => {
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      renderList(manyApplications(30))
      const list = screen.getByText("Showing 1–12 of 30").parentElement as HTMLElement
      const top = vi.spyOn(list, "getBoundingClientRect")

      top.mockReturnValue({ top: 40 } as DOMRect)
      fireEvent.click(screen.getByRole("button", { name: "Next" }))
      expect(scrollIntoView).not.toHaveBeenCalled()

      top.mockReturnValue({ top: -600 } as DOMRect)
      fireEvent.click(screen.getByRole("button", { name: "Next" }))
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" })

      // A filter change never scrolls.
      fireEvent.change(screen.getByLabelText("Filter by status"), {
        target: { value: "APPLIED" },
      })
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })
})
