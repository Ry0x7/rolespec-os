import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"

import { DiscoveryView } from "../discovery-view"
import type { DiscoveryCandidate } from "../../actions/discovery.actions"

const runDiscovery = vi.fn()
const saveDiscoveredJob = vi.fn()
const addJobByUrl = vi.fn()
const replace = vi.fn()

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("../../actions/discovery.actions", () => ({
  runDiscovery: (...args: unknown[]) => runDiscovery(...args),
  addJobByUrl: (...args: unknown[]) => addJobByUrl(...args),
  saveDiscoveredJob: (...args: unknown[]) => saveDiscoveredJob(...args),
  probeCompanyBoards: vi.fn(),
}))

vi.mock("../../actions/watchlist.actions", () => ({
  updateAtsWatchlist: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => "/discovery",
  useSearchParams: () => new URLSearchParams(),
}))

// The filter test is about which bucket a posting lands in, not about the
// qualification panel's own rendering (covered elsewhere).
vi.mock("../qualification-summary", () => ({
  QualificationSummary: () => <div data-testid="qualification" />,
}))
vi.mock("../opportunity-value-summary", () => ({
  OpportunityValueSummary: () => <div data-testid="value-summary" />,
}))

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

function candidate(overrides: Partial<DiscoveryCandidate>): DiscoveryCandidate {
  return {
    provider: "remotive",
    externalId: overrides.externalId ?? "1",
    title: "Engineer",
    companyName: "Globex",
    url: "https://example.com/jobs/1",
    canonicalUrl: `https://example.com/jobs/${overrides.externalId ?? "1"}`,
    alreadySaved: false,
    confidence: null,
    qualification: {
      verdict: "STRONG",
      requirementFlags: [],
      risk: { signal: "GOOD", reasons: [], level: "LOW" },
      marketFit: { fit: "UNKNOWN", reason: "Not stated", label: "Location unstated" },
    },
    ...overrides,
  } as unknown as DiscoveryCandidate
}

const VALUE = {
  score: 80,
  grade: "STRONG",
  coverage: 0.9,
  accepted: true,
  rejections: [],
  workload: { score: 80, indicators: [] },
  friction: { score: 80 },
} as unknown as NonNullable<DiscoveryCandidate["opportunityValue"]>

const CANDIDATES: DiscoveryCandidate[] = [
  candidate({
    externalId: "paid",
    title: "Paid Role",
    companyName: "Alpha",
    salaryText: "PHP 120,000 per month",
    opportunityValue: VALUE,
  }),
  candidate({
    externalId: "mystery",
    title: "Mystery Pay",
    companyName: "Beta",
    salaryText: undefined,
    opportunityValue: { ...VALUE, score: 60, grade: "DECENT", coverage: 0.6 },
  }),
  candidate({
    externalId: "blocked",
    title: "Blocked Role",
    companyName: "Gamma",
    opportunityValue: {
      ...VALUE,
      accepted: false,
      grade: "BLOCKED",
      score: 20,
      rejections: [{ code: "MINIMUM_PAY", severity: "BLOCK", message: "Pay is below your minimum." }],
    },
  }),
]

async function renderWithResults() {
  runDiscovery.mockResolvedValue({ candidates: CANDIDATES, sources: [] })
  render(
    <DiscoveryView
      queries={["Frontend Engineer"]}
      activeTargetRoleCount={1}
      atsWatchlist={{ greenhouse: [], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] }}
      requiresSponsorship={false}
      marketCountry={null}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Search" }))
  await screen.findByText("Paid Role")
}

describe("discovery compensation filters", () => {
  it("keeps the payless posting eligible by default and lists the engine exclusion with its reason", async () => {
    await renderWithResults()

    expect(screen.getByText("Mystery Pay")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: /Needs more info/ })).toBeNull()
    expect(screen.getByText("Pay is below your minimum.")).toBeTruthy()
    expect(screen.queryByText("Blocked Role")).toBeNull()
  })

  it("moves a posting without stated pay into Needs more info under High pay", async () => {
    await renderWithResults()

    fireEvent.click(screen.getByRole("button", { name: "High pay" }))

    const heading = await screen.findByRole("heading", { name: "Needs more info (1)" })
    expect(within(heading.parentElement as HTMLElement).getByText("Mystery Pay")).toBeTruthy()
    expect(screen.getByText("Paid Role")).toBeTruthy()
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("preset=HIGH_PAY"), { scroll: false })
  })

  it("resets every filter and the URL from the disclosure", async () => {
    await renderWithResults()
    fireEvent.click(screen.getByRole("button", { name: "High pay" }))
    await screen.findByRole("heading", { name: "Needs more info (1)" })

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }))
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }))

    expect(screen.queryByRole("heading", { name: /Needs more info/ })).toBeNull()
    expect(screen.getByText("Mystery Pay")).toBeTruthy()
    expect(replace).toHaveBeenLastCalledWith("/discovery", { scroll: false })
  })
})
