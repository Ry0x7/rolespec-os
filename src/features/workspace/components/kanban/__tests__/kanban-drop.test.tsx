import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, fireEvent, act, waitFor } from "@testing-library/react"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { localCalendarDateString } from "@/shared/lib/dates"
import { KanbanBoard } from "../kanban-board"
import type { WorkspaceJobRow } from "../../workspace-board"

const updateJobApplicationStatus = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@/features/jobs/actions/job-application.actions", () => ({
  updateJobApplicationStatus: (...args: unknown[]) =>
    updateJobApplicationStatus(...args),
}))

const job = {
  id: "job-1",
  status: ApplicationStatus.APPLIED,
  interviewDate: null,
  followUpAt: null,
  job: { companyName: "Acme", title: "Engineer", deadline: null },
} as unknown as WorkspaceJobRow

/** The server page's day start; fixed so nothing here reads the clock. */
const TODAY = new Date("2026-10-01T00:00:00.000Z")

/** Column order rendered by KanbanBoard. */
const COLUMN_WIDTH = 250
const COLUMN_HEIGHT = 400

function columnNodes() {
  return [...document.body.querySelectorAll("div")].filter((el) =>
    el.className.includes("min-w-[240px]"),
  )
}

/**
 * jsdom gives every element a 0x0 rect, so dnd-kit can never register a
 * collision. Lay the columns out side by side (index 0 = Interested) and give
 * everything else a small non-empty rect.
 */
function stubLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const index = columnNodes().indexOf(this as HTMLDivElement)
      const left = index >= 0 ? index * COLUMN_WIDTH : 0
      const width = index >= 0 ? 240 : 200
      const height = index >= 0 ? COLUMN_HEIGHT : 50
      return {
        x: left,
        y: 0,
        left,
        top: 0,
        width,
        height,
        right: left + width,
        bottom: height,
        toJSON: () => ({}),
      } as DOMRect
    },
  )
}

function getCard(container: HTMLElement) {
  return container.querySelector('[role="button"]') as HTMLElement
}

describe("kanban drop", () => {
  beforeEach(() => {
    updateJobApplicationStatus.mockClear()
    updateJobApplicationStatus.mockResolvedValue({
      success: true,
    })
    stubLayout()
  })
  afterEach(() => vi.restoreAllMocks())

  it("dropping a card on another column saves the new status", async () => {
    const { container } = render(<KanbanBoard jobs={[job]} today={TODAY} />)
    const card = getCard(container)

    // Screening is the third column: 500 <= x < 740.
    const target = { clientX: 2 * COLUMN_WIDTH + 120, clientY: 200 }

    act(() => {
      fireEvent.mouseDown(card, { clientX: COLUMN_WIDTH + 120, clientY: 200 })
      fireEvent.mouseMove(document, { clientX: COLUMN_WIDTH + 140, clientY: 200 })
    })
    await act(async () => {
      fireEvent.mouseMove(document, target)
    })
    await act(async () => {
      fireEvent.mouseUp(document, target)
    })

    await waitFor(() =>
      expect(updateJobApplicationStatus).toHaveBeenCalledWith(
        "job-1",
        ApplicationStatus.SCREENING,
        localCalendarDateString(),
      ),
    )
  })

  it("does not save when the card is dropped back on its own column", async () => {
    const { container } = render(<KanbanBoard jobs={[job]} today={TODAY} />)
    const card = getCard(container)
    const target = { clientX: COLUMN_WIDTH + 200, clientY: 300 }

    act(() => {
      fireEvent.mouseDown(card, { clientX: COLUMN_WIDTH + 120, clientY: 200 })
      fireEvent.mouseMove(document, { clientX: COLUMN_WIDTH + 140, clientY: 200 })
    })
    await act(async () => {
      fireEvent.mouseMove(document, target)
      fireEvent.mouseUp(document, target)
    })

    expect(updateJobApplicationStatus).not.toHaveBeenCalled()
  })

  it("the card status select saves without any drag", async () => {
    const { container } = render(<KanbanBoard jobs={[job]} today={TODAY} />)
    const select = container.querySelector("select") as HTMLSelectElement

    expect(select.value).toBe(ApplicationStatus.APPLIED)
    await act(async () => {
      fireEvent.change(select, { target: { value: ApplicationStatus.OFFER } })
    })

    expect(updateJobApplicationStatus).toHaveBeenCalledWith(
      "job-1",
      ApplicationStatus.OFFER,
      localCalendarDateString(),
    )
  })
})
