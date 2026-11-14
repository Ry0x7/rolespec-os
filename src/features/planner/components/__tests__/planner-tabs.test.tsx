import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PlannerTabs, resolveInitialTab } from "../planner-tabs"

vi.mock("../todo-list", () => ({
  TodoList: () => <div>todos panel</div>,
}))
vi.mock("../notes-list", () => ({
  NotesList: () => <div>notes panel</div>,
}))
vi.mock("../calendar-agenda", () => ({
  CalendarAgenda: () => <div>calendar panel</div>,
}))
vi.mock("../goals-tracker", () => ({
  GoalsTracker: () => <div>goals panel</div>,
}))

afterEach(cleanup)

/** The user's calendar day, as the planner page hands it in. */
const TODAY = new Date(Date.UTC(2026, 9, 12))

function renderTabs() {
  return render(
    <PlannerTabs todos={[]} notes={[]} agenda={[]} jobOptions={[]} today={TODAY} />
  )
}

describe("PlannerTabs", () => {
  it("exposes tablist/tab/tabpanel roles with a single selected tab", () => {
    renderTabs()
    expect(screen.getByRole("tablist")).toBeTruthy()
    const tabs = screen.getAllByRole("tab")
    expect(tabs).toHaveLength(4)
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1)
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "planner-tab-todos"
    )
  })

  it("uses a roving tabindex", () => {
    renderTabs()
    const [todos, notes, calendar, goals] = screen.getAllByRole("tab")
    expect(todos.getAttribute("tabindex")).toBe("0")
    expect(notes.getAttribute("tabindex")).toBe("-1")
    expect(calendar.getAttribute("tabindex")).toBe("-1")
    expect(goals.getAttribute("tabindex")).toBe("-1")
  })

  it("moves selection with ArrowRight and wraps at the end", () => {
    renderTabs()
    const tabs = screen.getAllByRole("tab")
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" })
    expect(screen.getByText("notes panel")).toBeTruthy()
    expect(document.activeElement).toBe(screen.getAllByRole("tab")[1])

    fireEvent.keyDown(screen.getAllByRole("tab")[1], { key: "ArrowRight" })
    expect(screen.getByText("calendar panel")).toBeTruthy()

    fireEvent.keyDown(screen.getAllByRole("tab")[2], { key: "ArrowRight" })
    expect(screen.getByText("goals panel")).toBeTruthy()

    fireEvent.keyDown(screen.getAllByRole("tab")[3], { key: "ArrowRight" })
    expect(screen.getByText("todos panel")).toBeTruthy()
    expect(screen.getByRole("tabpanel").getAttribute("id")).toBe("planner-panel-todos")
  })

  it("moves selection with ArrowLeft, Home and End", () => {
    renderTabs()
    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "ArrowLeft" })
    expect(screen.getByText("goals panel")).toBeTruthy()

    fireEvent.keyDown(screen.getAllByRole("tab")[2], { key: "Home" })
    expect(screen.getByText("todos panel")).toBeTruthy()

    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "End" })
    expect(screen.getByText("goals panel")).toBeTruthy()
    expect(screen.getByRole("tabpanel").getAttribute("id")).toBe("planner-panel-goals")
  })

  it("switches panel on click", () => {
    renderTabs()
    fireEvent.click(screen.getByRole("tab", { name: /Notes/ }))
    expect(screen.getByText("notes panel")).toBeTruthy()
    expect(screen.getByRole("tabpanel").getAttribute("id")).toBe("planner-panel-notes")
  })

  it("opens on the calendar when there are no todos but the agenda has items", () => {
    render(
      <PlannerTabs
        todos={[]}
        notes={[]}
        agenda={[
          {
            key: "follow-up:j1",
            type: "follow-up",
            date: new Date("2026-09-01T00:00:00.000Z"),
            title: "Engineer",
            company: "Sharp Atoms",
            jobApplicationId: "j1",
            overdue: true,
          },
        ]}
        jobOptions={[]}
        today={TODAY}
      />
    )

    expect(screen.getByText("calendar panel")).toBeTruthy()
    expect(screen.getByRole("tabpanel").getAttribute("id")).toBe(
      "planner-panel-calendar"
    )
  })
})

describe("resolveInitialTab", () => {
  it("stays on todos whenever the user has any", () => {
    expect(resolveInitialTab(2, 5)).toBe("todos")
  })

  it("stays on todos when both lists are empty", () => {
    expect(resolveInitialTab(0, 0)).toBe("todos")
  })

  it("opens the calendar only when todos are empty and the agenda is not", () => {
    expect(resolveInitialTab(0, 1)).toBe("calendar")
  })
})
