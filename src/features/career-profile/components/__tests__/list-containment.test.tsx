import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { CapabilitiesCard } from "../capabilities-card"
import { EvidenceCard } from "../evidence-card"
import { TargetRolesCard } from "../target-roles-card"
import type { CapabilityRow, EvidenceRow, TargetRoleRow } from "../../types"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock("../../actions/career-profile.actions", () => ({
  createRoleFamily: vi.fn(),
  createTargetRole: vi.fn(),
  deleteRoleFamily: vi.fn(),
  deleteTargetRole: vi.fn(),
  setTargetRoleActive: vi.fn(),
}))
vi.mock("../../actions/career-evidence.actions", () => ({
  confirmEvidence: vi.fn(),
  createEvidence: vi.fn(),
  deleteEvidence: vi.fn(),
  updateEvidence: vi.fn(),
}))
vi.mock("../../actions/enhance", () => ({
  enhanceCareerGoals: vi.fn(),
  enhanceEvidence: vi.fn(),
}))
vi.mock("../../actions/career-capability.actions", () => ({
  createCapabilities: vi.fn(),
  deleteCapability: vi.fn(),
  linkEvidenceToCapability: vi.fn(),
  setCapabilityConfirmed: vi.fn(),
  unlinkEvidenceFromCapability: vi.fn(),
}))

afterEach(cleanup)

const targetRoles: TargetRoleRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: `role-${i}`,
  title: `Target role ${i}`,
  priority: i,
  active: i % 2 === 0,
  roleFamilyId: null,
  roleFamilyName: null,
}))

const evidence: EvidenceRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: `evidence-${i}`,
  kind: i % 2 === 0 ? "EXPERIENCE" : "PROJECT",
  source: "USER_ENTERED",
  status: "CONFIRMED",
  title: `Evidence ${i}`,
  organization: null,
  details: null,
  outcome: null,
  startDate: null,
  endDate: null,
}))

const capabilities: CapabilityRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: `capability-${i}`,
  name: `Capability ${i}`,
  category: null,
  confirmed: false,
  selfAssessment: null,
  notes: null,
  links: [],
}))

/** The scroll container is the nearest ancestor that can actually scroll. */
function scrollerFor(element: Element) {
  return element.closest(".overflow-y-auto")
}

describe("career profile list containment", () => {
  it("puts the target roles list inside a capped scroll container", () => {
    const { container } = render(
      <TargetRolesCard targetRoles={targetRoles} roleFamilies={[]} />
    )
    const scroller = scrollerFor(screen.getByText("Target role 0"))
    expect(scroller).not.toBeNull()
    expect(scroller!.className).toContain("max-h-[min(50vh,420px)]")
    expect(scroller!.className).toContain("overscroll-contain")
    // Every row on the current page lives in the same scroller, so the card
    // height stays bounded. The list is paged (10 per page), so rows 10 and 11
    // wait for "Next".
    expect(scroller!.contains(screen.getByText("Target role 9"))).toBe(true)
    expect(screen.queryByText("Target role 11")).toBeNull()
    expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(1)
  })

  it("shows how many target roles there are", () => {
    render(<TargetRolesCard targetRoles={targetRoles} roleFamilies={[]} />)
    // The total, not the page size.
    expect(screen.getByText("12 target roles")).toBeTruthy()
  })

  it("renders the target roles empty state outside any scroll container", () => {
    const { container } = render(<TargetRolesCard targetRoles={[]} roleFamilies={[]} />)
    const empty = screen.getByText("No target roles yet")
    expect(scrollerFor(empty)).toBeNull()
    expect(container.querySelector(".overflow-y-auto")).toBeNull()
  })

  it("puts every evidence group inside one capped scroll container", () => {
    const { container } = render(<EvidenceCard evidence={evidence} />)
    const scroller = scrollerFor(screen.getByText("Evidence 0"))
    expect(scroller).not.toBeNull()
    expect(scroller!.className).toContain("max-h-[min(60vh,520px)]")
    expect(scroller!.className).toContain("overscroll-contain")
    // Group headings scroll with their rows rather than sitting above the cap.
    // Matched by element, since the "Type" select repeats the same labels.
    const headings = Array.from(scroller!.querySelectorAll("p.uppercase")).map(
      (node) => node.textContent
    )
    expect(headings).toEqual(["Experience", "Project"])
    // Paged at 10 in group order: all 6 Experience rows, then the first 4
    // Project rows (Evidence 1, 3, 5, 7); Evidence 9 and 11 are on page 2.
    expect(scroller!.contains(screen.getByText("Evidence 7"))).toBe(true)
    expect(screen.queryByText("Evidence 11")).toBeNull()
    expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(1)
  })

  it("renders the evidence empty state outside any scroll container", () => {
    const { container } = render(<EvidenceCard evidence={[]} />)
    expect(scrollerFor(screen.getByText("No evidence yet"))).toBeNull()
    expect(container.querySelector(".overflow-y-auto")).toBeNull()
  })

  it("puts the capabilities list inside a capped scroll container", () => {
    const { container } = render(
      <CapabilitiesCard capabilities={capabilities} evidenceOptions={[]} />
    )
    const scroller = scrollerFor(screen.getByText("Capability 0"))
    expect(scroller).not.toBeNull()
    expect(scroller!.className).toContain("max-h-[min(60vh,520px)]")
    expect(scroller!.className).toContain("overscroll-contain")
    // The list is paged (10 per page), so every row on the current page lives
    // in the same scroller and later rows wait for "Next".
    expect(scroller!.contains(screen.getByText("Capability 9"))).toBe(true)
    expect(screen.queryByText("Capability 11")).toBeNull()
    expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(1)
    // The inline "link evidence" form expands in place, so nothing may clip it.
    expect(container.querySelector(".overflow-hidden")).toBeNull()
  })

  it("renders the capabilities empty state outside any scroll container", () => {
    const { container } = render(
      <CapabilitiesCard capabilities={[]} evidenceOptions={[]} />
    )
    expect(scrollerFor(screen.getByText("No capabilities yet"))).toBeNull()
    expect(container.querySelector(".overflow-y-auto")).toBeNull()
  })
})
