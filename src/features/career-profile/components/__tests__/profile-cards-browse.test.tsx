import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { EvidenceCard } from "../evidence-card"
import { TargetRolesCard } from "../target-roles-card"
import type { EvidenceRow, TargetRoleRow } from "../../types"

const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
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

beforeEach(() => refresh.mockReset())
afterEach(cleanup)

function makeRoles(count: number) {
  return Array.from({ length: count }, (_, i): TargetRoleRow => ({
    id: `role-${i + 1}`,
    title: `Role ${i + 1}`,
    priority: i,
    active: true,
    roleFamilyId: null,
    roleFamilyName: null,
  }))
}

function makeEvidence(kinds: EvidenceRow["kind"][]) {
  return kinds.map(
    (kind, i): EvidenceRow => ({
      id: `evidence-${i + 1}`,
      kind,
      source: "USER_ENTERED",
      status: "CONFIRMED",
      title: `Item ${i + 1}`,
      organization: null,
      details: null,
      outcome: null,
      startDate: null,
      endDate: null,
    })
  )
}

function evidenceFilter(label: RegExp) {
  return within(screen.getByRole("group", { name: "Filter evidence by type" })).getByRole(
    "button",
    { name: label }
  )
}

function headings() {
  return Array.from(document.querySelectorAll(".overflow-y-auto p.uppercase")).map(
    (node) => node.textContent
  )
}

describe("TargetRolesCard paging", () => {
  it("pages 23 roles into 3 pages of 10 and keeps the total count", () => {
    render(<TargetRolesCard targetRoles={makeRoles(23)} roleFamilies={[]} />)
    expect(screen.getByText("23 target roles")).toBeTruthy()
    expect(screen.getByRole("navigation", { name: "Target roles pages" })).toBeTruthy()
    expect(screen.getByText("Page 1 of 3")).toBeTruthy()
    expect(screen.getByText("Role 10")).toBeTruthy()
    expect(screen.queryByText("Role 11")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Page 2 of 3")).toBeTruthy()
    expect(screen.getByText("Role 11")).toBeTruthy()
    expect(screen.queryByText("Role 10")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Previous" }))
    expect(screen.getByText("Page 1 of 3")).toBeTruthy()
  })

  it("hides the pager when every role fits on one page", () => {
    render(<TargetRolesCard targetRoles={makeRoles(10)} roleFamilies={[]} />)
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("steps back a page when a refresh removes the only row on the last page", () => {
    const roles = makeRoles(21)
    const { rerender } = render(<TargetRolesCard targetRoles={roles} roleFamilies={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Page 3 of 3")).toBeTruthy()

    rerender(<TargetRolesCard targetRoles={roles.slice(0, 20)} roleFamilies={[]} />)
    expect(screen.getByText("Page 2 of 2")).toBeTruthy()
    expect(screen.getByText("Role 20")).toBeTruthy()
  })

  it("keeps the list scroll position when the roles refresh", () => {
    const roles = makeRoles(8)
    const { rerender } = render(<TargetRolesCard targetRoles={roles} roleFamilies={[]} />)
    const scroller = document.querySelector(".overflow-y-auto") as HTMLElement
    scroller.scrollTop = 180
    fireEvent.scroll(scroller)
    scroller.scrollTop = 0

    rerender(
      <TargetRolesCard targetRoles={roles.map((role) => ({ ...role }))} roleFamilies={[]} />
    )
    expect(scroller.scrollTop).toBe(180)
  })

  it("starts the next page at the top of the list", () => {
    render(<TargetRolesCard targetRoles={makeRoles(23)} roleFamilies={[]} />)
    const scroller = document.querySelector(".overflow-y-auto") as HTMLElement
    scroller.scrollTop = 300
    fireEvent.scroll(scroller)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(scroller.scrollTop).toBe(0)
  })
})

describe("EvidenceCard filtering and paging", () => {
  // 7 experience, 3 achievements, 5 projects = 15 items.
  const evidence = makeEvidence([
    ...Array<EvidenceRow["kind"]>(7).fill("EXPERIENCE"),
    ...Array<EvidenceRow["kind"]>(5).fill("PROJECT"),
    ...Array<EvidenceRow["kind"]>(3).fill("ACHIEVEMENT"),
  ])

  it("offers All plus one option per kind that has items, with counts", () => {
    render(<EvidenceCard evidence={evidence} />)
    const group = screen.getByRole("group", { name: "Filter evidence by type" })
    const labels = within(group)
      .getAllByRole("button")
      .map((button) => button.textContent)
    expect(labels).toEqual(["All (15)", "Experience (7)", "Achievement (3)", "Project (5)"])
    expect(evidenceFilter(/^All/).getAttribute("aria-pressed")).toBe("true")
  })

  it("pages All in group order and groups each page under its headings", () => {
    render(<EvidenceCard evidence={evidence} />)
    expect(screen.getByText("Page 1 of 2")).toBeTruthy()
    // 7 Experience + 3 Achievement fill page 1.
    expect(headings()).toEqual(["Experience", "Achievement"])
    expect(screen.queryByText("Item 8")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Page 2 of 2")).toBeTruthy()
    expect(headings()).toEqual(["Project"])
    expect(screen.getByText("Item 8")).toBeTruthy()
  })

  it("filters to one kind without headings and resets to page 1", () => {
    render(<EvidenceCard evidence={evidence} />)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    fireEvent.click(evidenceFilter(/^Project/))
    expect(evidenceFilter(/^Project/).getAttribute("aria-pressed")).toBe("true")
    expect(headings()).toEqual([])
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(screen.getByText("Item 8")).toBeTruthy()
    expect(screen.queryByText("Item 1")).toBeNull()
  })

  it("falls back to All when the filtered kind disappears", () => {
    const { rerender } = render(<EvidenceCard evidence={evidence} />)
    fireEvent.click(evidenceFilter(/^Achievement/))
    rerender(<EvidenceCard evidence={evidence.filter((item) => item.kind !== "ACHIEVEMENT")} />)
    expect(evidenceFilter(/^All/).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText("Item 1")).toBeTruthy()
  })

  it("hides the kind filter when only one kind has items", () => {
    render(<EvidenceCard evidence={makeEvidence(Array<EvidenceRow["kind"]>(3).fill("PROJECT"))} />)
    expect(screen.queryByRole("group", { name: "Filter evidence by type" })).toBeNull()
    expect(screen.getByText("Item 1")).toBeTruthy()
    expect(screen.getByText("Item 3")).toBeTruthy()
  })

  it("opens the inline edit form inside the scroller without clipping", () => {
    const { container } = render(<EvidenceCard evidence={evidence} />)
    fireEvent.click(screen.getByRole("button", { name: "Edit evidence Item 2" }))
    const form = (screen.getByDisplayValue("Item 2") as HTMLInputElement).form!
    expect(form.closest(".overflow-y-auto")).not.toBeNull()
    expect(container.querySelector(".overflow-hidden")).toBeNull()
  })
})
