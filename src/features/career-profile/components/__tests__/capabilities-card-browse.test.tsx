import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { CapabilitiesCard } from "../capabilities-card"
import { setCapabilityConfirmed } from "../../actions/career-capability.actions"
import type { CapabilityRow } from "../../types"

const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("../../actions/career-capability.actions", () => ({
  createCapabilities: vi.fn(),
  deleteCapability: vi.fn(),
  linkEvidenceToCapability: vi.fn(),
  setCapabilityConfirmed: vi.fn(),
  unlinkEvidenceFromCapability: vi.fn(),
}))

const setConfirmed = vi.mocked(setCapabilityConfirmed)

beforeEach(() => {
  refresh.mockReset()
  setConfirmed.mockReset()
})
afterEach(cleanup)

function makeCapabilities(count: number, confirmed: (i: number) => boolean = () => false) {
  return Array.from({ length: count }, (_, i): CapabilityRow => ({
    id: `capability-${i + 1}`,
    name: `Skill ${i + 1}`,
    category: null,
    confirmed: confirmed(i),
    selfAssessment: null,
    notes: null,
    links: [],
  }))
}

function filterButton(label: RegExp) {
  return within(screen.getByRole("group", { name: "Filter capabilities" })).getByRole(
    "button",
    { name: label }
  )
}

function rowFor(name: string) {
  return screen.getByText(name).closest(".rounded-lg") as HTMLElement
}

describe("CapabilitiesCard browsing", () => {
  it("defaults to Unconfirmed when any capability is unconfirmed", () => {
    render(
      <CapabilitiesCard
        capabilities={makeCapabilities(4, (i) => i < 2)}
        evidenceOptions={[]}
      />
    )
    expect(filterButton(/^Unconfirmed/).getAttribute("aria-pressed")).toBe("true")
    expect(screen.queryByText("Skill 1")).toBeNull()
    expect(screen.getByText("Skill 3")).toBeTruthy()
  })

  it("defaults to All when every capability is confirmed", () => {
    render(
      <CapabilitiesCard capabilities={makeCapabilities(3, () => true)} evidenceOptions={[]} />
    )
    expect(filterButton(/^All/).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText("Skill 1")).toBeTruthy()
  })

  it("shows the count for each filter", () => {
    render(
      <CapabilitiesCard
        capabilities={makeCapabilities(7, (i) => i < 3)}
        evidenceOptions={[]}
      />
    )
    expect(filterButton(/^Unconfirmed/).textContent).toBe("Unconfirmed (4)")
    expect(filterButton(/^Confirmed/).textContent).toBe("Confirmed (3)")
    expect(filterButton(/^All/).textContent).toBe("All (7)")
  })

  it("shows a filtered empty state", () => {
    render(
      <CapabilitiesCard
        capabilities={makeCapabilities(2, () => false)}
        evidenceOptions={[]}
      />
    )
    fireEvent.click(filterButton(/^Confirmed/))
    expect(screen.getByText("No confirmed capabilities")).toBeTruthy()
    expect(screen.queryByText("No capabilities yet")).toBeNull()
  })

  it("pages 23 items into 3 pages of 10 with Next and Previous", () => {
    render(<CapabilitiesCard capabilities={makeCapabilities(23)} evidenceOptions={[]} />)
    expect(screen.getByText("Page 1 of 3")).toBeTruthy()
    expect(screen.getByText("Skill 10")).toBeTruthy()
    expect(screen.queryByText("Skill 11")).toBeNull()
    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true)

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Page 2 of 3")).toBeTruthy()
    expect(screen.getByText("Skill 11")).toBeTruthy()
    expect(screen.queryByText("Skill 10")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Page 3 of 3")).toBeTruthy()
    expect(screen.getByText("Skill 23")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true)

    fireEvent.click(screen.getByRole("button", { name: "Previous" }))
    expect(screen.getByText("Page 2 of 3")).toBeTruthy()
  })

  it("hides the pager when everything fits on one page", () => {
    render(<CapabilitiesCard capabilities={makeCapabilities(10)} evidenceOptions={[]} />)
    expect(screen.queryByText(/^Page \d+ of/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull()
  })

  it("resets to page 1 when the filter changes", () => {
    render(<CapabilitiesCard capabilities={makeCapabilities(23)} evidenceOptions={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Page 2 of 3")).toBeTruthy()
    fireEvent.click(filterButton(/^All/))
    expect(screen.getByText("Page 1 of 3")).toBeTruthy()
    expect(screen.getByText("Skill 1")).toBeTruthy()
  })

  it("confirms optimistically before the server action resolves", async () => {
    let resolve!: (value: { success: true }) => void
    setConfirmed.mockReturnValue(new Promise((r) => (resolve = r)))
    render(<CapabilitiesCard capabilities={makeCapabilities(3)} evidenceOptions={[]} />)
    fireEvent.click(filterButton(/^All/))

    fireEvent.click(within(rowFor("Skill 2")).getByRole("button", { name: "Confirm" }))

    // Server action still pending: the row already reads as confirmed.
    expect(setConfirmed).toHaveBeenCalledWith("capability-2", true)
    expect(within(rowFor("Skill 2")).getByText("Confirmed")).toBeTruthy()
    expect(filterButton(/^Confirmed/).textContent).toBe("Confirmed (1)")
    expect(filterButton(/^Unconfirmed/).textContent).toBe("Unconfirmed (2)")
    expect(refresh).not.toHaveBeenCalled()

    await act(async () => resolve({ success: true }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("rolls the optimistic confirm back when the server action fails", async () => {
    setConfirmed.mockResolvedValue({ error: "Not found" } as never)
    render(<CapabilitiesCard capabilities={makeCapabilities(3)} evidenceOptions={[]} />)
    fireEvent.click(filterButton(/^All/))
    await act(async () => {
      fireEvent.click(within(rowFor("Skill 2")).getByRole("button", { name: "Confirm" }))
    })
    expect(within(rowFor("Skill 2")).getByText("Unconfirmed")).toBeTruthy()
    expect(filterButton(/^Confirmed/).textContent).toBe("Confirmed (0)")
  })

  it("removes a confirmed row from the Unconfirmed view and keeps the row order", () => {
    setConfirmed.mockReturnValue(new Promise(() => {}))
    render(<CapabilitiesCard capabilities={makeCapabilities(5)} evidenceOptions={[]} />)
    fireEvent.click(within(rowFor("Skill 3")).getByRole("button", { name: "Confirm" }))
    expect(screen.queryByText("Skill 3")).toBeNull()
    expect(filterButton(/^Unconfirmed/).textContent).toBe("Unconfirmed (4)")

    // In All the row stays where it was rather than jumping to the top.
    fireEvent.click(filterButton(/^All/))
    const names = Array.from(document.querySelectorAll(".overflow-y-auto p.text-sm")).map(
      (node) => node.textContent
    )
    expect(names).toEqual(["Skill 1", "Skill 2", "Skill 3", "Skill 4", "Skill 5"])
  })

  it("moves to the previous page when confirming empties the last page", () => {
    setConfirmed.mockReturnValue(new Promise(() => {}))
    render(<CapabilitiesCard capabilities={makeCapabilities(21)} evidenceOptions={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Page 3 of 3")).toBeTruthy()

    fireEvent.click(within(rowFor("Skill 21")).getByRole("button", { name: "Confirm" }))

    expect(screen.getByText("Page 2 of 2")).toBeTruthy()
    expect(screen.getByText("Skill 20")).toBeTruthy()
    expect(screen.queryByText("No unconfirmed capabilities")).toBeNull()
  })

  it("keeps the list scroll position when the capabilities refresh", () => {
    const capabilities = makeCapabilities(8)
    const { rerender } = render(
      <CapabilitiesCard capabilities={capabilities} evidenceOptions={[]} />
    )
    const scroller = document.querySelector(".overflow-y-auto") as HTMLElement
    scroller.scrollTop = 240
    fireEvent.scroll(scroller)
    // Something resets the container (as the browser did on reorder in prod).
    scroller.scrollTop = 0

    rerender(
      <CapabilitiesCard
        capabilities={capabilities.map((row) => ({ ...row }))}
        evidenceOptions={[]}
      />
    )
    expect(scroller.scrollTop).toBe(240)
  })
})
