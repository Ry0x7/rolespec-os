import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import type {
  CareerCapabilityMatch,
  CareerPathGroupId,
  CareerPathResult,
  CareerRecommendation,
} from "../../types"
import { CareerPathExplorer } from "../career-path-explorer"

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("../../actions/career-path.actions", () => ({
  approveCareerPathRole: mocks.approve,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
}))

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

function capability(
  overrides: Partial<CareerCapabilityMatch> & { key: string; label: string }
): CareerCapabilityMatch {
  return {
    weight: 2,
    critical: true,
    source: "REQUIRED",
    status: "SUPPORTED",
    strength: 82,
    selfAssessment: "STRONG",
    evidence: [
      {
        id: `evidence-${overrides.key}`,
        title: `${overrides.label} case study`,
        kind: "PROJECT",
        sourceUrl: "https://example.com/case-study",
        outcome: "Reduced cycle time by 20%.",
      },
    ],
    explanation: "Backed by a confirmed project and a measured outcome.",
    ...overrides,
  }
}

function recommendation(
  overrides: Partial<CareerRecommendation> & {
    occupationId: string
    title: string
    group: CareerPathGroupId
  }
): CareerRecommendation {
  return {
    familyId: "engineering",
    familyLabel: "Engineering",
    summary: "A scoped role that grows toward owning a feature end to end.",
    entryLevel: "ENTRY",
    score: 78,
    coverage: 82,
    breakdown: {
      requiredCoverage: 100,
      preferredCoverage: 50,
      evidenceShare: 75,
      criticalPenalty: 0,
      total: 78,
    },
    confidence: "HIGH",
    evidenceBackedCapabilities: 2,
    matched: [capability({ key: "programming", label: "Programming" })],
    missing: [
      capability({
        key: "testing",
        label: "Testing",
        status: "MISSING",
        strength: null,
        evidence: [],
        critical: false,
        source: "PREFERRED",
        explanation: "No confirmed capability or evidence for this requirement.",
      }),
    ],
    entryFeasibility: {
      status: "FEASIBLE",
      label: "Entry fit",
      explanation: "Your stated level meets this role's entry level.",
    },
    geography: {
      status: "ELIGIBLE",
      label: "Open",
      explanation:
        "This catalogue entry has no region-specific credential requirement.",
    },
    steps: ["Ship a small project and record a measured outcome."],
    branch: [overrides.title],
    related: [],
    salaryPotential: null,
    reasons: ["Every required capability is backed by confirmed evidence."],
    ...overrides,
  }
}

const junior = recommendation({
  occupationId: "junior-software-engineer",
  title: "Junior Software Engineer",
  group: "QUALIFIED_NOW",
})

const dataAnalyst = recommendation({
  occupationId: "data-analyst",
  title: "Data Analyst",
  group: "QUALIFIED_NOW",
  familyId: "data",
  familyLabel: "Data",
})

const uxDesigner = recommendation({
  occupationId: "ux-designer",
  title: "UX Designer",
  group: "QUALIFIED_NOW",
  familyId: "design",
  familyLabel: "Design",
})

const operationsCoordinator = recommendation({
  occupationId: "operations-coordinator",
  title: "Operations Coordinator",
  group: "QUALIFIED_NOW",
  familyId: "operations",
  familyLabel: "Operations",
})

const marketingCoordinator = recommendation({
  occupationId: "marketing-coordinator",
  title: "Marketing Coordinator",
  group: "ADJACENT",
  familyId: "marketing",
  familyLabel: "Marketing",
  score: 61,
  coverage: 64,
})

const productManager = recommendation({
  occupationId: "product-manager",
  title: "Product Manager",
  group: "GROWTH",
  familyId: "product",
  familyLabel: "Product",
  score: 44,
  coverage: 48,
  confidence: "LOW",
})

junior.related = [
  {
    occupationId: marketingCoordinator.occupationId,
    title: marketingCoordinator.title,
    relationship: "ADJACENT",
  },
]

function makeResult(overrides: Partial<CareerPathResult> = {}): CareerPathResult {
  const groups = overrides.groups ?? {
    QUALIFIED_NOW: [junior, dataAnalyst, uxDesigner, operationsCoordinator],
    ADJACENT: [marketingCoordinator],
    GROWTH: [productManager],
  }
  return {
    taxonomyVersion: "career-path-test-1",
    attribution: ["A small curated test catalogue; not an ESCO or O*NET import."],
    groups,
    counts: {
      QUALIFIED_NOW: groups.QUALIFIED_NOW.length,
      ADJACENT: groups.ADJACENT.length,
      GROWTH: groups.GROWTH.length,
    },
    conflicts: [],
    notices: [],
    evaluatedCount: 6,
    hasEnoughEvidence: true,
    ...overrides,
  }
}

describe("CareerPathExplorer", () => {
  it("renders group counts, the active panel and data provenance", () => {
    render(<CareerPathExplorer result={makeResult()} approvedTitles={[]} />)

    expect(screen.getByText("Career paths")).toBeTruthy()
    expect(screen.getByText(/6 catalogue roles evaluated/)).toBeTruthy()
    expect(screen.getByText(/Catalogue version career-path-test-1/)).toBeTruthy()
    expect(screen.getByText("Data sources")).toBeTruthy()

    const qualifiedTab = screen.getByRole("tab", { name: /Qualified now/ })
    expect(qualifiedTab.getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("tab", { name: /Adjacent careers/ })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /Growth paths/ })).toBeTruthy()

    expect(screen.getByRole("heading", { name: "Junior Software Engineer" })).toBeTruthy()
    expect(screen.getByText(/Roles your confirmed, evidence-backed/)).toBeTruthy()
    expect(screen.getByRole("tabpanel")).toBeTruthy()
  })

  it("supports roving tab keyboard navigation", async () => {
    render(<CareerPathExplorer result={makeResult()} approvedTitles={[]} />)

    const qualifiedTab = screen.getByRole("tab", { name: /Qualified now/ })
    fireEvent.keyDown(qualifiedTab, { key: "ArrowRight" })

    const adjacentTab = screen.getByRole("tab", { name: /Adjacent careers/ })
    expect(adjacentTab.getAttribute("aria-selected")).toBe("true")
    await waitFor(() => expect(document.activeElement).toBe(adjacentTab))

    fireEvent.keyDown(adjacentTab, { key: "End" })
    expect(
      screen.getByRole("tab", { name: /Growth paths/ }).getAttribute("aria-selected")
    ).toBe("true")

    fireEvent.keyDown(screen.getByRole("tab", { name: /Growth paths/ }), {
      key: "Home",
    })
    expect(qualifiedTab.getAttribute("aria-selected")).toBe("true")

    fireEvent.keyDown(qualifiedTab, { key: "ArrowLeft" })
    expect(
      screen.getByRole("tab", { name: /Growth paths/ }).getAttribute("aria-selected")
    ).toBe("true")
  })

  it("expands one card with evidence, gaps, steps and a deterministic breakdown", () => {
    render(<CareerPathExplorer result={makeResult()} approvedTitles={[]} />)

    fireEvent.click(
      screen.getAllByRole("button", { name: "Explore evidence & steps" })[0]
    )

    expect(screen.getByText("Why this role appears here")).toBeTruthy()
    expect(screen.getByText(/Every required capability is backed/)).toBeTruthy()
    expect(screen.getByText("Score breakdown")).toBeTruthy()
    expect(screen.getByText(/required coverage 70%/)).toBeTruthy()
    expect(screen.getByText("Missing requirements")).toBeTruthy()
    expect(screen.getByText("Testing")).toBeTruthy()
    expect(screen.getByText("Ship a small project and record a measured outcome.")).toBeTruthy()
    expect(
      screen.getByText(/No verified regional pay data for this role/)
    ).toBeTruthy()

    const external = screen.getByRole("link", { name: /Programming case study/ })
    expect(external.getAttribute("href")).toBe("https://example.com/case-study")
    expect(external.getAttribute("target")).toBe("_blank")

    // Only http(s) provenance is turned into a link.
    expect(
      screen.queryByRole("link", { name: /Unsafe source/ })
    ).toBeNull()
  })

  it("shows a verified salary range only when the result carries one", () => {
    const paid = recommendation({
      occupationId: "paid-role",
      title: "Paid Role",
      group: "QUALIFIED_NOW",
      salaryPotential: {
        min: 90000,
        max: 120000,
        currency: "USD",
        period: "YEARLY",
        region: "US",
        source: "Test salary series",
        asOf: "2026-10-01",
      },
    })
    render(
      <CareerPathExplorer
        result={makeResult({
          groups: { QUALIFIED_NOW: [paid], ADJACENT: [], GROWTH: [] },
          evaluatedCount: 1,
        })}
        approvedTitles={[]}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Explore evidence & steps" }))

    expect(screen.getByText(/90,000/)).toBeTruthy()
    expect(screen.getByText(/Test salary series/)).toBeTruthy()
    expect(screen.queryByText(/No verified regional pay data/)).toBeNull()
  })

  it("navigates to a related role, switches group and focuses its heading", async () => {
    render(<CareerPathExplorer result={makeResult()} approvedTitles={[]} />)

    fireEvent.click(
      screen.getAllByRole("button", { name: "Explore evidence & steps" })[0]
    )
    fireEvent.click(screen.getByRole("button", { name: /Marketing Coordinator/ }))

    expect(
      screen.getByRole("tab", { name: /Adjacent careers/ }).getAttribute("aria-selected")
    ).toBe("true")
    const heading = screen.getByRole("heading", { name: "Marketing Coordinator" })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByText("Why this role appears here")).toBeTruthy()
  })

  it("reveals roles beyond the first three", () => {
    render(<CareerPathExplorer result={makeResult()} approvedTitles={[]} />)

    expect(screen.queryByRole("heading", { name: "Operations Coordinator" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Show 1 more/ }))
    expect(screen.getByRole("heading", { name: "Operations Coordinator" })).toBeTruthy()
  })

  it("approves a role once and refreshes target roles", async () => {
    mocks.approve.mockResolvedValue({ success: true, alreadyExists: false })
    render(<CareerPathExplorer result={makeResult()} approvedTitles={[]} />)

    fireEvent.click(
      screen.getAllByRole("button", { name: "Add to Target Roles" })[0]
    )

    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith("junior-software-engineer")
    )
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Added to Target Roles")
    expect(screen.getAllByText("On your target list").length).toBeGreaterThan(0)
  })

  it("shows a pending state while approval is in flight", async () => {
    let resolveApproval: (value: { success: true; alreadyExists: boolean }) => void =
      () => undefined
    mocks.approve.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve
        })
    )
    render(<CareerPathExplorer result={makeResult()} approvedTitles={[]} />)

    fireEvent.click(
      screen.getAllByRole("button", { name: "Add to Target Roles" })[0]
    )
    const pending = screen.getByRole("button", { name: "Adding…" }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)

    resolveApproval({ success: true, alreadyExists: false })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("disables approval for a role already in Target Roles", () => {
    render(
      <CareerPathExplorer
        result={makeResult()}
        approvedTitles={["Junior Software Engineer"]}
      />
    )

    expect(screen.getByText("On your target list")).toBeTruthy()
    const button = screen.getAllByRole("button", {
      name: "Add to Target Roles",
    })[0] as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it("keeps the button enabled and reports an action error", async () => {
    mocks.approve.mockResolvedValue({ error: "That role is unavailable." })
    render(<CareerPathExplorer result={makeResult()} approvedTitles={[]} />)

    fireEvent.click(
      screen.getAllByRole("button", { name: "Add to Target Roles" })[0]
    )

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "That role is unavailable."
    )
    expect(mocks.toastError).toHaveBeenCalledWith("That role is unavailable.")
    const button = screen.getAllByRole("button", {
      name: "Add to Target Roles",
    })[0] as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })

  it("explains sparse evidence without fabricating roles", () => {
    render(
      <CareerPathExplorer
        result={makeResult({
          groups: { QUALIFIED_NOW: [], ADJACENT: [], GROWTH: [] },
          counts: { QUALIFIED_NOW: 0, ADJACENT: 0, GROWTH: 0 },
          hasEnoughEvidence: false,
          notices: ["Confirm at least two capabilities before relying on these paths."],
        })}
        approvedTitles={[]}
      />
    )

    expect(screen.getByText("Not enough confirmed evidence yet")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Go to skills" }).getAttribute("href")).toBe(
      "#capabilities"
    )
    expect(
      screen.getByText(/Confirm at least two capabilities before relying on these paths/)
    ).toBeTruthy()
    expect(screen.queryByRole("tablist", { name: "Career path groups" })).toBeNull()
  })

  it("surfaces conflicting capability records and explains single counting", () => {
    render(
      <CareerPathExplorer
        result={makeResult({
          conflicts: [
            {
              capabilityKey: "react",
              label: "React",
              detail: "One record scored 78 and another 22. The stronger rating was used.",
            },
          ],
        })}
        approvedTitles={[]}
      />
    )

    expect(screen.getByText("Conflicting capability records")).toBeTruthy()
    expect(screen.getByText(/not added together/)).toBeTruthy()
    expect(screen.getByText(/One record scored 78/)).toBeTruthy()
  })

  it("renders worst-case text without losing the controls", () => {
    const longTitle = `Senior ${"International ".repeat(20)}Engineer`
    const longEvidence = `Evidence ${"with unbroken detail ".repeat(30)}`
    const role = recommendation({
      occupationId: "long-role",
      title: longTitle,
      group: "QUALIFIED_NOW",
      summary: "Long summary ".repeat(60),
      matched: [
        capability({
          key: "programming",
          label: "Programming",
          evidence: [
            {
              id: "long-evidence",
              title: longEvidence,
              kind: "PROJECT",
              sourceUrl: null,
              outcome: null,
            },
          ],
        }),
      ],
    })

    render(
      <CareerPathExplorer
        result={makeResult({
          groups: { QUALIFIED_NOW: [role], ADJACENT: [], GROWTH: [] },
          evaluatedCount: 1,
        })}
        approvedTitles={[]}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Explore evidence & steps" }))
    expect(screen.getByRole("heading", { name: longTitle })).toBeTruthy()
    expect(screen.getByText(/with unbroken detail/)).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Hide evidence & steps" })
    ).toBeTruthy()
  })
})
