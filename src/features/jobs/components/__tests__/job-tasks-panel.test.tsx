import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { JobTasksPanel, type JobTask } from "../job-tasks-panel"

const createTodo = vi.fn()
const updateTodo = vi.fn()
const deleteTodo = vi.fn()
const refresh = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: (...args: unknown[]) => refresh(...args) }),
}))

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

vi.mock("@/features/planner/actions/todo.actions", () => ({
  createTodo: (...args: unknown[]) => createTodo(...args),
  updateTodo: (...args: unknown[]) => updateTodo(...args),
  deleteTodo: (...args: unknown[]) => deleteTodo(...args),
}))

const JOB_ID = "app-1"

function task(overrides: Partial<JobTask> = {}): JobTask {
  return { id: "t1", title: "Email the recruiter", done: false, dueDate: null, ...overrides }
}

afterEach(cleanup)
afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  createTodo.mockResolvedValue({ success: true, id: "t9" })
  updateTodo.mockResolvedValue({ success: true })
  deleteTodo.mockResolvedValue({ success: true })
})

describe("JobTasksPanel", () => {
  it("says so when the application has no tasks", () => {
    render(<JobTasksPanel jobApplicationId={JOB_ID} todos={[]} />)

    expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy()
    expect(screen.getByText("No tasks yet")).toBeTruthy()
  })

  it("renders each task with its due date", () => {
    // The panel decides "overdue" against the reader's own clock, so a fixed
    // due date quietly turns overdue once the real date passes it. Pin the
    // clock instead: this test is about the date line, not the tint.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0))

    render(
      <JobTasksPanel
        jobApplicationId={JOB_ID}
        todos={[task({ dueDate: "2026-09-15" }), task({ id: "t2", title: "Prep answers", done: true })]}
      />,
    )

    expect(screen.getByText("Due Sep 15, 2026")).toBeTruthy()
    expect(screen.getByText("Prep answers")).toBeTruthy()
    expect(screen.queryByText("No tasks yet")).toBeNull()
  })

  it("tints a past due date on an open task", () => {
    render(
      <JobTasksPanel jobApplicationId={JOB_ID} todos={[task({ dueDate: "2020-01-02" })]} />,
    )

    const due = screen.getByText(/Due Jan 2, 2020/)
    expect(due.className).toContain("text-error")
    expect(due.textContent).toContain("overdue")
  })

  it("adds a task against this application, never asking which job", async () => {
    render(<JobTasksPanel jobApplicationId={JOB_ID} todos={[]} />)

    fireEvent.change(screen.getByLabelText("New task"), {
      target: { value: "Send the take-home" },
    })
    fireEvent.change(screen.getByLabelText("Due date (optional)"), {
      target: { value: "2026-09-20" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add" }))

    await waitFor(() => expect(createTodo).toHaveBeenCalledTimes(1))
    const submitted = createTodo.mock.calls[0][0] as FormData
    expect(submitted.get("title")).toBe("Send the take-home")
    expect(submitted.get("dueDate")).toBe("2026-09-20")
    expect(submitted.get("jobApplicationId")).toBe(JOB_ID)
    expect(toastSuccess).toHaveBeenCalledWith("Task added")
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("toggles a task done", async () => {
    render(<JobTasksPanel jobApplicationId={JOB_ID} todos={[task()]} />)

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mark Email the recruiter complete" }),
    )

    await waitFor(() => expect(updateTodo).toHaveBeenCalledTimes(1))
    expect(updateTodo.mock.calls[0][0]).toBe("t1")
    expect((updateTodo.mock.calls[0][1] as FormData).get("done")).toBe("true")
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("deletes a task", async () => {
    render(<JobTasksPanel jobApplicationId={JOB_ID} todos={[task()]} />)

    fireEvent.click(screen.getByRole("button", { name: "Delete Email the recruiter" }))

    await waitFor(() => expect(deleteTodo).toHaveBeenCalledWith("t1"))
    expect(toastSuccess).toHaveBeenCalledWith("Task deleted")
  })

  it("surfaces a failed write instead of pretending it worked", async () => {
    deleteTodo.mockResolvedValue({ error: "Not found" })
    render(<JobTasksPanel jobApplicationId={JOB_ID} todos={[task()]} />)

    fireEvent.click(screen.getByRole("button", { name: "Delete Email the recruiter" }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not found"))
    expect(refresh).not.toHaveBeenCalled()
  })
})
