import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { assessOpportunityConfidence } from "@/features/discovery/services/opportunity-confidence.service"
import { serializeOpportunityValue } from "@/features/opportunity/serialize"
import type { OpportunityValue } from "@/features/opportunity/types"
import { describeNextStep } from "../../services/application-next-step.service"
import { quickActionsFor } from "../../services/application-quick-actions"
import { JobApplicationList } from "../job-application-list"
import type { JobApplicationCardData } from "../job-application-card"

const TODAY = new Date(Date.UTC(2026, 9, 12))

const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/jobs",
  useSearchParams: () => searchParams.current,
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("../../actions/job-application.actions", () => ({
  createJobApplication: vi.fn(),
  updateJobApplication: vi.fn(),
  updateJobApplicationStatus: vi.fn(),
  deleteJobApplication: vi.fn(),
  deleteJobApplications: vi.fn(),
  clearJobApplicationFollowUp: vi.fn(),
  scheduleJobApplicationFollowUp: vi.fn(),
  snoozeJobApplicationFollowUp: vi.fn(),
}))
vi.mock("../../actions/job-qualification.actions", () => ({
  recheckJobQualification: vi.fn(),
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

beforeEach(() => {
  searchParams.current = new URLSearchParams()
  window.history.replaceState(null, "", "/jobs")
  window.localStorage.clear()
})

/**
 * Only the Opportunity Value fields the list filters on matter here. The engine
 * builds the real object; a saved-job fixture does not need a second copy of it.
 */
function valueWith(overrides: {
  friction: number | null
  workload?: number | null
  accepted?: boolean
}): OpportunityValue {
  return {
    score: 70,
    grade: "DECENT",
    preset: "BALANCED",
    dimensions: [],
    compensation: { state: "SUPPORTED", signals: [] },
    hourly: { score: null },
    workload: { score: overrides.workload ?? 70, indicators: [] },
    friction: { score: overrides.friction, indicators: [] },
    rejections: overrides.accepted === false
      ? [{ code: "MINIMUM_PAY", message: "Pay is below your minimum.", severity: "BLOCK" }]
      : [],
    contradictions: [],
    accepted: overrides.accepted ?? true,
    coverage: 0.8,
    explanation: [],
  } as unknown as OpportunityValue
}

function makeApplication(overrides: {
  id: string
  company: string
  title?: string
  salary?: { min: string | null; max: string | null; currency: "USD" | "PHP" | null; period: "YEARLY" | "MONTHLY" | null }
  value?: OpportunityValue | null
}): JobApplicationCardData {
  const { id, company, title = "Engineer", salary, value = null } = overrides
  return {
    id,
    status: "APPLIED",
    dateApplied: null,
    interviewDate: null,
    followUpAt: null,
    outcomeAt: null,
    contact: null,
    notes: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    job: {
      companyName: company,
      title,
      location: "Remote",
      salaryMin: salary?.min ?? null,
      salaryMax: salary?.max ?? null,
      salaryCurrency: salary?.currency ?? null,
      salaryPeriod: salary?.period ?? null,
      salaryTermMonths: null,
      salaryText: null,
      salaryDisplay: {
        primary: salary?.min ? `${salary.currency} ${salary.min}` : null,
        equivalent: null,
        equivalentNotice: null,
        caveat: null,
      },
      salary: {
        min: salary?.min ?? null,
        max: salary?.max ?? null,
        currency: salary?.currency ?? null,
        period: salary?.period ?? null,
        termMonths: null,
      },
      ageDays: 40,
      deadline: null,
      url: null,
      description: null,
      jobType: null,
      workType: "REMOTE",
      riskLevel: null,
      requirementFlags: null,
    },
    verdict: null,
    confidence: assessOpportunityConfidence({
      source: "MANUAL",
      companyName: company,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    }),
    opportunityValue: value ? serializeOpportunityValue(value) : null,
    provenance: "Added manually",
    nextStep: describeNextStep(
      {
        status: "APPLIED",
        followUpAt: null,
        interviewDate: null,
        outcomeAt: null,
        deadline: null,
        verdict: null,
      },
      TODAY,
    ),
    quickActions: quickActionsFor(
      {
        status: "APPLIED",
        followUpAt: null,
        interviewDate: null,
        outcomeAt: null,
        deadline: null,
        verdict: null,
      },
      TODAY,
    ),
    coverLetters: [],
    _count: { coverLetters: 0 },
  }
}

const APPLICATIONS = [
  makeApplication({
    id: "acme",
    company: "Acme",
    title: "Acme Engineer",
    salary: { min: "900000", max: "900000", currency: "PHP", period: "YEARLY" },
    value: valueWith({ friction: 80 }),
  }),
  // Plenty of process, so "Easy to apply" excludes it.
  makeApplication({
    id: "globex",
    company: "Globex",
    title: "Globex Engineer",
    salary: { min: "185000", max: "185000", currency: "USD", period: "YEARLY" },
    value: valueWith({ friction: 40 }),
  }),
  // States no pay at all, so "High pay" cannot call it eligible.
  makeApplication({
    id: "initech",
    company: "Initech",
    title: "Initech Engineer",
    value: null,
  }),
]

const LIST_PROPS = {
  applications: APPLICATIONS,
  statusCounts: {
    INTERESTED: 0,
    APPLIED: 3,
    SCREENING: 0,
    INTERVIEW: 0,
    OFFER: 0,
    REJECTED: 0,
    WITHDRAWN: 0,
  },
  today: TODAY,
}

function renderList() {
  return render(<JobApplicationList {...LIST_PROPS} />)
}

describe("saved jobs opportunity filters", () => {
  it("moves a high-friction job to Excluded with the reason", () => {
    renderList()

    fireEvent.click(screen.getByRole("button", { name: "Easy to apply" }))

    expect(screen.getByText("Excluded (1)")).toBeTruthy()
    expect(screen.getByText("Application friction is higher than you allowed.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Globex Engineer" })).toBeTruthy()
  })

  it("keeps a payless job out of High pay and words it as needing more info", () => {
    renderList()

    fireEvent.click(screen.getByRole("button", { name: "High pay" }))

    expect(screen.getByText("Needs more info (1)")).toBeTruthy()
    expect(screen.getByText("Initech", { selector: "span" })).toBeTruthy()
    // Globex states its pay, so it stays in the grid.
    expect(screen.getByRole("link", { name: "Globex" })).toBeTruthy()
  })

  it("counts eligible, unknown and excluded over every row exactly once", () => {
    renderList()

    fireEvent.click(screen.getByRole("button", { name: "High pay / lighter workload" }))

    const counts = Array.from(document.querySelectorAll("p")).find((node) =>
      /eligible/.test(node.textContent ?? ""),
    )
    // Acme and Globex state pay and a light workload; Initech states neither.
    expect(counts?.textContent).toMatch(/2\s*eligible/)
    expect(counts?.textContent).toMatch(/1\s*need more info/)
    expect(counts?.textContent).toMatch(/0\s*excluded/)
  })

  it("resets the opportunity params while status and search survive", () => {
    searchParams.current = new URLSearchParams("preset=EASY_APPLY&status=APPLIED&q=Globex")
    window.history.replaceState(null, "", "/jobs?preset=EASY_APPLY&status=APPLIED&q=Globex")
    renderList()

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }))
    fireEvent.click(screen.getByRole("button", { name: /reset filters/i }))

    const params = new URLSearchParams(window.location.search)
    expect(params.get("preset")).toBeNull()
    expect(params.get("friction")).toBeNull()
    expect(params.get("status")).toBe("APPLIED")
    expect(params.get("q")).toBe("Globex")
  })

  it("re-reads the criteria when the URL changes under the mounted list", () => {
    const view = renderList()
    expect(screen.queryByText("Needs more info (1)")).toBeNull()

    // Back/forward or a deep link, not one of the list's own writes.
    searchParams.current = new URLSearchParams("preset=HIGH_PAY")
    view.rerender(<JobApplicationList {...LIST_PROPS} />)

    expect(screen.getByText("Needs more info (1)")).toBeTruthy()
    expect(screen.getByRole("button", { name: "High pay" }).getAttribute("aria-pressed")).toBe(
      "true",
    )
  })
})
