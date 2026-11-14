import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, fireEvent, act } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { KanbanColumn } from "../kanban-column"
import { KanbanBoard } from "../kanban-board"
import type { WorkspaceJobRow } from "../../workspace-board"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@/features/jobs/actions/job-application.actions", () => ({
  updateJobApplicationStatus: vi.fn(async () => ({ ok: true })),
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

function touch(x: number, y: number) {
  return { touches: [{ clientX: x, clientY: y, identifier: 0 }] }
}

/** The card rendered inside a column (the DragOverlay copy is a separate node). */
function getCard(container: HTMLElement) {
  return container.querySelector('[role="button"]') as HTMLElement
}

/**
 * DragOverlay renders a second copy of the card only while a drag is active,
 * so the company name appears twice mid-drag and once otherwise. The overlay is
 * portalled to <body>, so this counts across the whole document.
 */
function isDragging() {
  const hits = [...document.body.querySelectorAll("p")].filter(
    (p) => p.textContent === "Acme",
  )
  return hits.length > 1
}

describe("kanban touch support", () => {
  it("does not put touch-action:none on the card, so swipes can scroll", () => {
    const { container } = render(
      <DndContext>
        <KanbanColumn status={ApplicationStatus.APPLIED} jobs={[job]} />
      </DndContext>,
    )
    const card = getCard(container)
    expect(card.className).not.toContain("touch-none")
    expect(getComputedStyle(card).touchAction).toBe("auto")
  })

  describe("KanbanBoard sensors", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it("a touch swipe past the tolerance does not start a drag", () => {
      const { container } = render(<KanbanBoard jobs={[job]} today={TODAY} />)
      const card = getCard(container)
      fireEvent.touchStart(card, touch(0, 0))
      // TouchSensor listens for touchmove on the target element itself.
      fireEvent.touchMove(card, touch(40, 0))
      act(() => void vi.advanceTimersByTime(600))
      expect(isDragging()).toBe(false)
    })

    it("a press-and-hold past 250ms starts a drag", () => {
      const { container } = render(<KanbanBoard jobs={[job]} today={TODAY} />)
      fireEvent.touchStart(getCard(container), touch(0, 0))
      act(() => void vi.advanceTimersByTime(300))
      expect(isDragging()).toBe(true)
    })

    it("a mouse move past the distance threshold starts a drag with no delay", () => {
      const { container } = render(<KanbanBoard jobs={[job]} today={TODAY} />)
      const card = getCard(container)
      act(() => {
        fireEvent.mouseDown(card, { clientX: 0, clientY: 0 })
        fireEvent.mouseMove(card, { clientX: 20, clientY: 0 })
      })
      expect(isDragging()).toBe(true)
    })
  })
})
