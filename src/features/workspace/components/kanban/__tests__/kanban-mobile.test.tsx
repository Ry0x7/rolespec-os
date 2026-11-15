import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, fireEvent } from "@testing-library/react"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { KanbanBoard } from "../kanban-board"
import type { WorkspaceJobRow } from "../../workspace-board"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@/features/jobs/actions/job-application.actions", () => ({
  updateJobApplicationStatus: vi.fn(async () => ({ success: true })),
}))

function makeJob(
  id: string,
  companyName: string,
  status: ApplicationStatus
): WorkspaceJobRow {
  return {
    id,
    status,
    interviewDate: null,
    followUpAt: null,
    job: { companyName, title: "Engineer", deadline: null },
  } as unknown as WorkspaceJobRow
}

const TODAY = new Date("2026-10-01T00:00:00.000Z")

describe("kanban phone layout", () => {
  beforeEach(() => {
    // jsdom has no matchMedia. Reporting a phone viewport is what most real
    // phones below xl get, and it is the branch under test.
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it("shows one status at a time and switches columns from the navigator", () => {
    const { container, getByRole, getByTitle, queryByText } = render(
      <KanbanBoard
        jobs={[
          makeJob("job-1", "Acme", ApplicationStatus.APPLIED),
          makeJob("job-2", "OfferCo", ApplicationStatus.OFFER),
        ]}
        today={TODAY}
      />
    )

    expect(container.querySelector("[data-kanban-mobile]")).not.toBeNull()
    expect(container.querySelector("[data-kanban-desktop]")).toBeNull()

    expect(getByRole("group", { name: "Application statuses" })).toBeTruthy()
    expect(getByTitle("Applied").getAttribute("aria-pressed")).toBe("true")
    expect(queryByText("Acme")).not.toBeNull()
    expect(queryByText("OfferCo")).toBeNull()

    fireEvent.click(getByTitle("Offer"))

    expect(queryByText("OfferCo")).not.toBeNull()
    expect(queryByText("Acme")).toBeNull()
    expect(getByTitle("Offer").getAttribute("aria-pressed")).toBe("true")
  })

  it("keeps the board free of a horizontal scroller below xl", () => {
    const { container } = render(
      <KanbanBoard
        jobs={[makeJob("job-1", "Acme", ApplicationStatus.APPLIED)]}
        today={TODAY}
      />
    )

    const mobile = container.querySelector("[data-kanban-mobile]") as HTMLElement
    expect(mobile.className).not.toContain("overflow-x-auto")
    expect(mobile.querySelector(".overflow-x-auto")).toBeNull()
  })
})
