import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { TodoList } from "../todo-list"
import { deleteTodo, updateTodo } from "../../actions/todo.actions"
import type { TodoRow } from "../../types"

const push = vi.fn()
const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => push(...args),
    refresh: (...args: unknown[]) => refresh(...args),
  }),
}))

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock("../../actions/todo.actions", () => ({
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
}))

afterEach(cleanup)

/** The user's calendar day, as the planner page hands it in. */
const TODAY = new Date(Date.UTC(2026, 9, 12))

beforeEach(() => {
  vi.clearAllMocks()
})

function todo(overrides: Partial<TodoRow> = {}): TodoRow {
  return {
    id: "t1",
    title: "Follow up with recruiter",
    done: false,
    dueDate: null,
    jobApplicationId: null,
    job: null,
    ...overrides,
  }
}

describe("TodoList", () => {
  it("puts an overdue active todo under an Overdue heading", () => {
    render(
      <TodoList
        todos={[todo({ id: "overdue", title: "Overdue task", dueDate: new Date("2020-01-01T00:00:00.000Z") })]}
        jobOptions={[]}
        today={TODAY}
      />
    )

    expect(screen.getByText("Overdue")).toBeTruthy()
    expect(screen.getByText("Overdue task")).toBeTruthy()
  })

  it("does not put a due-today or future todo under Overdue", () => {
    render(
      <TodoList
        todos={[
          todo({ id: "today", title: "Today task", dueDate: TODAY }),
          todo({ id: "future", title: "Future task", dueDate: new Date("2031-10-12T00:00:00.000Z") }),
        ]}
        jobOptions={[]}
        today={TODAY}
      />
    )

    expect(screen.queryByText("Overdue")).toBeNull()
    expect(screen.getByText("Today task")).toBeTruthy()
    expect(screen.getByText("Future task")).toBeTruthy()
  })

  it("does not put a completed past-due todo under Overdue", () => {
    render(
      <TodoList
        todos={[
          todo({
            id: "done-late",
            title: "Done late task",
            done: true,
            dueDate: new Date("2020-01-01T00:00:00.000Z"),
          }),
        ]}
        jobOptions={[]}
        today={TODAY}
      />
    )

    expect(screen.queryByText("Overdue")).toBeNull()
    fireEvent.click(filterButton(/^Completed/))
    expect(screen.queryByText("Overdue")).toBeNull()
    expect(screen.getByText("Done late task")).toBeTruthy()
  })

  it("frames Overdue on the user's day even when rendered on a UTC host", () => {
    // 06:00 on 12 Oct for a UTC+8 reader, still 11 Oct on a UTC server.
    vi.setSystemTime(new Date("2026-10-11T22:00:00.000Z"))
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0)
    try {
      render(
        <TodoList
          todos={[
            todo({ id: "yesterday", title: "Yesterday task", dueDate: new Date("2026-10-11T00:00:00.000Z") }),
          ]}
          jobOptions={[]}
          today={TODAY}
        />
      )

      expect(screen.getByText("Overdue")).toBeTruthy()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})

function filterButton(name: RegExp) {
  return within(screen.getByRole("group", { name: "Filter todos" })).getByRole("button", { name })
}

function makeTodos(count: number, overrides: Partial<TodoRow> = {}, prefix = "Task") {
  return Array.from({ length: count }, (_, i) =>
    todo({ id: `${prefix}-${i + 1}`, title: `${prefix} ${i + 1}`, ...overrides })
  )
}

function visibleTitles() {
  return screen
    .getAllByRole("checkbox")
    .map((box) => box.getAttribute("aria-label")?.replace(/^Mark (.*) (in)?complete$/, "$1"))
}

describe("TodoList filter and paging", () => {
  it("defaults to Open with counts for each view and hides completed rows", () => {
    render(
      <TodoList
        todos={[...makeTodos(3), ...makeTodos(2, { done: true }, "Done")]}
        jobOptions={[]}
        today={TODAY}
      />
    )

    expect(filterButton(/^Open/).getAttribute("aria-pressed")).toBe("true")
    expect(filterButton(/^Open/).textContent).toContain("(3)")
    expect(filterButton(/^Completed/).textContent).toContain("(2)")
    expect(filterButton(/^All/).textContent).toContain("(5)")
    expect(visibleTitles()).toEqual(["Task 1", "Task 2", "Task 3"])

    fireEvent.click(filterButton(/^Completed/))
    expect(visibleTitles()).toEqual(["Done 1", "Done 2"])

    fireEvent.click(filterButton(/^All/))
    expect(visibleTitles()).toEqual(["Task 1", "Task 2", "Task 3", "Done 1", "Done 2"])
  })

  it("keeps Overdue above the paged list in Open and All, not in Completed", () => {
    render(
      <TodoList
        todos={[
          todo({ id: "late", title: "Late task", dueDate: new Date("2020-01-01T00:00:00.000Z") }),
          ...makeTodos(12),
          ...makeTodos(1, { done: true }, "Done"),
        ]}
        jobOptions={[]}
        today={TODAY}
      />
    )

    // Overdue is not paged: page 1 shows it plus 10 of the 12 other open rows.
    expect(screen.getByText("Overdue")).toBeTruthy()
    expect(visibleTitles()).toHaveLength(11)
    expect(screen.getByText("Page 1 of 2")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Overdue")).toBeTruthy()
    expect(visibleTitles()).toEqual(["Late task", "Task 11", "Task 12"])

    fireEvent.click(filterButton(/^Completed/))
    expect(screen.queryByText("Overdue")).toBeNull()
    expect(visibleTitles()).toEqual(["Done 1"])
  })

  it("pages at 10 with Previous/Next and goes back to page 1 on a filter change", () => {
    render(<TodoList todos={makeTodos(25)} jobOptions={[]} today={TODAY} />)

    const nav = screen.getByRole("navigation", { name: "Todos pages" })
    expect(within(nav).getByText("Page 1 of 3")).toBeTruthy()
    expect(visibleTitles()).toHaveLength(10)
    expect((within(nav).getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(nav).getByRole("button", { name: "Next" }))
    fireEvent.click(within(nav).getByRole("button", { name: "Next" }))
    expect(screen.getByText("Page 3 of 3")).toBeTruthy()
    expect(visibleTitles()).toEqual(["Task 21", "Task 22", "Task 23", "Task 24", "Task 25"])

    fireEvent.click(filterButton(/^All/))
    expect(screen.getByText("Page 1 of 3")).toBeTruthy()
    expect(visibleTitles()[0]).toBe("Task 1")
  })

  it("moves a completed row out of Open at once and clamps the last page", async () => {
    vi.mocked(updateTodo).mockResolvedValue({ success: true } as never)
    render(<TodoList todos={makeTodos(11)} jobOptions={[]} today={TODAY} />)

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Page 2 of 2")).toBeTruthy()
    expect(visibleTitles()).toEqual(["Task 11"])

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Mark Task 11 complete" }))
    })

    // The props never changed (refresh is mocked): the override alone moved it.
    expect(updateTodo).toHaveBeenCalledWith("Task-11", expect.any(FormData))
    expect(refresh).toHaveBeenCalled()
    expect(filterButton(/^Open/).textContent).toContain("(10)")
    expect(filterButton(/^Completed/).textContent).toContain("(1)")
    // One page left: no pagination, and page 1 shows rather than an empty page.
    expect(screen.queryByRole("navigation", { name: "Todos pages" })).toBeNull()
    expect(visibleTitles()).toHaveLength(10)
    expect(visibleTitles()).not.toContain("Task 11")
  })

  it("drops the override when the action fails", async () => {
    vi.mocked(updateTodo).mockResolvedValue({ error: "Nope" } as never)
    render(<TodoList todos={makeTodos(2)} jobOptions={[]} today={TODAY} />)

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Mark Task 1 complete" }))
    })

    expect(filterButton(/^Open/).textContent).toContain("(2)")
    expect(visibleTitles()).toEqual(["Task 1", "Task 2"])
  })

  it("hides a deleted row at once and keeps the current page when it still exists", async () => {
    vi.mocked(deleteTodo).mockResolvedValue({ success: true } as never)
    render(<TodoList todos={makeTodos(22)} jobOptions={[]} today={TODAY} />)

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete Task 12" }))
    })

    expect(screen.getByText("Page 2 of 3")).toBeTruthy()
    expect(visibleTitles()).not.toContain("Task 12")
    expect(filterButton(/^Open/).textContent).toContain("(21)")
  })
})
