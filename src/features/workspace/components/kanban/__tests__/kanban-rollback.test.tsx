import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, fireEvent, act, waitFor } from "@testing-library/react"
import { ApplicationStatus } from "@/generated/prisma/enums"
import { KanbanBoard } from "../kanban-board"
import type { WorkspaceJobRow } from "../../workspace-board"

const updateJobApplicationStatus = vi.fn()
const toastError = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}))

vi.mock("@/features/jobs/actions/job-application.actions", () => ({
  updateJobApplicationStatus: (...args: unknown[]) =>
    updateJobApplicationStatus(...args),
}))

function makeJob(id: string, companyName: string): WorkspaceJobRow {
  return {
    id,
    status: ApplicationStatus.APPLIED,
    interviewDate: null,
    followUpAt: null,
    job: { companyName, title: "Engineer", deadline: null },
  } as unknown as WorkspaceJobRow
}

const TODAY = new Date("2026-10-01T00:00:00.000Z")

function selectFor(container: HTMLElement, companyName: string) {
  const card = [...container.querySelectorAll('[role="button"]')].find((el) =>
    el.textContent?.includes(companyName),
  )
  return card?.querySelector("select") as HTMLSelectElement
}

describe("kanban failed move rollback", () => {
  beforeEach(() => {
    updateJobApplicationStatus.mockReset()
    toastError.mockReset()
  })

  it("rolls back only the failed card, keeping a card moved in the meantime", async () => {
    let failFirst: (value: unknown) => void = () => {}
    updateJobApplicationStatus.mockImplementation((jobId: string) =>
      jobId === "job-1"
        ? new Promise((resolve) => {
            failFirst = resolve
          })
        : Promise.resolve({ success: true }),
    )

    const { container } = render(
      <KanbanBoard
        jobs={[makeJob("job-1", "Acme"), makeJob("job-2", "Globex")]}
        today={TODAY}
      />,
    )

    // job-1's save is still pending when job-2 is moved.
    await act(async () => {
      fireEvent.change(selectFor(container, "Acme"), {
        target: { value: ApplicationStatus.OFFER },
      })
    })
    await act(async () => {
      fireEvent.change(selectFor(container, "Globex"), {
        target: { value: ApplicationStatus.SCREENING },
      })
    })
    expect(selectFor(container, "Globex").value).toBe(ApplicationStatus.SCREENING)

    await act(async () => {
      failFirst({ error: "Could not update status" })
    })

    await waitFor(() =>
      expect(selectFor(container, "Acme").value).toBe(ApplicationStatus.APPLIED),
    )
    expect(selectFor(container, "Globex").value).toBe(ApplicationStatus.SCREENING)
    expect(toastError).toHaveBeenCalledWith("Could not update status")
  })
})
