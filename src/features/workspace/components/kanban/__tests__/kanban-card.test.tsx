import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { KanbanCard } from "../kanban-card"
import { KanbanTodayContext } from "../kanban-status"
import type { WorkspaceJobRow } from "../../workspace-board"

const clearJobApplicationFollowUp = vi.fn()
const snoozeJobApplicationFollowUp = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()
const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

vi.mock("@/features/jobs/actions/job-application.actions", () => ({
  clearJobApplicationFollowUp: (...args: unknown[]) =>
    clearJobApplicationFollowUp(...args),
  snoozeJobApplicationFollowUp: (...args: unknown[]) =>
    snoozeJobApplicationFollowUp(...args),
}))

/** The server page's day start; fixed so nothing here reads the clock. */
const TODAY = new Date("2026-10-01T00:00:00.000Z")

function row(overrides: Partial<WorkspaceJobRow> = {}): WorkspaceJobRow {
  return {
    id: "app-1",
    status: ApplicationStatus.APPLIED,
    dateApplied: null,
    interviewDate: null,
    followUpAt: null,
    job: { companyName: "Acme", title: "Engineer", deadline: null },
    ...overrides,
  }
}

function renderCard(job: WorkspaceJobRow) {
  return render(
    <KanbanTodayContext.Provider value={TODAY}>
      <KanbanCard job={job} />
    </KanbanTodayContext.Provider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  clearJobApplicationFollowUp.mockResolvedValue({ success: true })
  snoozeJobApplicationFollowUp.mockResolvedValue({ success: true })
})

describe("KanbanCard follow-up line", () => {
  it("shows a due-today follow-up on an APPLIED card, tinted as due", () => {
    renderCard(row({ followUpAt: TODAY }))
    const line = screen.getByText(/Follow up Oct 1, 2026/)
    expect(line.textContent).toBe("Follow up Oct 1, 2026 — due today")
    expect(line.className).toContain("text-error")
  })

  it("marks a past follow-up as overdue", () => {
    renderCard(
      row({
        status: ApplicationStatus.INTERVIEW,
        followUpAt: new Date("2026-09-28T00:00:00.000Z"),
      }),
    )
    expect(screen.getByText(/Follow up/).textContent).toBe(
      "Follow up Sep 28, 2026 — overdue",
    )
  })

  it("shows an upcoming follow-up untinted with no suffix", () => {
    renderCard(row({ followUpAt: new Date("2026-10-08T00:00:00.000Z") }))
    const line = screen.getByText(/Follow up/)
    expect(line.textContent).toBe("Follow up Oct 8, 2026")
    expect(line.className).not.toContain("text-error")
  })

  it("hides a stale follow-up on a WITHDRAWN card", () => {
    renderCard(
      row({ status: ApplicationStatus.WITHDRAWN, followUpAt: TODAY }),
    )
    expect(screen.queryByText(/Follow up/)).toBeNull()
    expect(screen.queryByRole("button", { name: /follow-up/i })).toBeNull()
  })

  it("shows nothing when no follow-up is scheduled", () => {
    renderCard(row())
    expect(screen.queryByText(/Follow up/)).toBeNull()
  })

  it("Done clears the follow-up through the Job Detail action", async () => {
    renderCard(row({ followUpAt: TODAY }))
    fireEvent.click(
      screen.getByRole("button", { name: "Mark the follow-up as done" }),
    )
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Follow-up logged"),
    )
    expect(clearJobApplicationFollowUp).toHaveBeenCalledWith("app-1")
    expect(refresh).toHaveBeenCalled()
  })

  it("Snooze 1 week snoozes through the Job Detail action", async () => {
    renderCard(row({ followUpAt: TODAY }))
    fireEvent.click(
      screen.getByRole("button", { name: "Snooze the follow-up by 1 week" }),
    )
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Follow-up snoozed for a week"),
    )
    expect(snoozeJobApplicationFollowUp).toHaveBeenCalledWith(
      "app-1",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    )
  })

  it("keeps presses on the controls from reaching the drag wrapper", () => {
    const onPointerDown = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <div onPointerDown={onPointerDown} onKeyDown={onKeyDown}>
        <KanbanTodayContext.Provider value={TODAY}>
          <KanbanCard job={row({ followUpAt: TODAY })} />
        </KanbanTodayContext.Provider>
      </div>,
    )
    const done = screen.getByRole("button", { name: "Mark the follow-up as done" })
    fireEvent.pointerDown(done)
    fireEvent.keyDown(done, { key: "Enter" })
    expect(onPointerDown).not.toHaveBeenCalled()
    expect(onKeyDown).not.toHaveBeenCalled()
  })
})
