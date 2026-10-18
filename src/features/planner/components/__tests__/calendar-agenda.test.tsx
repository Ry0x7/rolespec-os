import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CalendarAgenda } from "../calendar-agenda"
import type { AgendaItem } from "../../services/calendar.service"

const updateTodo = vi.fn()
const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: (...args: unknown[]) => refresh(...args) }),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("../../actions/todo.actions", () => ({
  createTodo: vi.fn(),
  updateTodo: (...args: unknown[]) => updateTodo(...args),
  deleteTodo: vi.fn(),
}))

// The follow-up row now carries the shared quick-action buttons, which reach
// two server-action modules; unmocked they drag `next-auth` into jsdom.
vi.mock("@/features/jobs/actions/job-application.actions", () => ({
  clearJobApplicationFollowUp: vi.fn(),
  scheduleJobApplicationFollowUp: vi.fn(),
  snoozeJobApplicationFollowUp: vi.fn(),
  updateJobApplicationStatus: vi.fn(),
}))

vi.mock("@/features/jobs/actions/job-qualification.actions", () => ({
  recheckJobQualification: vi.fn(),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  updateTodo.mockResolvedValue({ success: true })
})

function item(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return {
    key: "follow-up:j1",
    type: "follow-up",
    date: new Date("2026-09-01T00:00:00.000Z"),
    title: "Software Engineer",
    company: "Sharp Atoms",
    jobApplicationId: "j1",
    ...overrides,
  }
}

describe("CalendarAgenda", () => {
  it("renders an Overdue section for items already past", () => {
    render(<CalendarAgenda items={[item({ overdue: true })]} />)

    expect(screen.getByText("Overdue")).toBeTruthy()
  })

  it("keeps scheduled items out of the Overdue section", () => {
    render(<CalendarAgenda items={[item()]} />)

    expect(screen.queryByText("Overdue")).toBeNull()
  })

  it("links an entry to its application", () => {
    const { container } = render(<CalendarAgenda items={[item({ overdue: true })]} />)

    const links = container.querySelectorAll("a")
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute("href")).toBe("/jobs/j1#track")
  })

  it("sends an interview to Track and a deadline or todo to the page top", () => {
    const { container } = render(
      <CalendarAgenda
        items={[
          item({ key: "interview:j2", type: "interview", jobApplicationId: "j2" }),
          item({ key: "deadline:j3", type: "deadline", jobApplicationId: "j3" }),
          item({
            key: "todo:t9",
            type: "todo",
            title: "Prep portfolio",
            jobApplicationId: "j4",
            done: false,
          }),
        ]}
      />
    )

    const hrefs = Array.from(container.querySelectorAll("a")).map((link) =>
      link.getAttribute("href")
    )
    expect(hrefs).toContain("/jobs/j2#track")
    expect(hrefs).toContain("/jobs/j3")
    expect(hrefs).toContain("/jobs/j4")
  })

  it("renders a standalone todo without a link", () => {
    const { container } = render(
      <CalendarAgenda
        items={[
          item({
            key: "todo:t1",
            type: "todo",
            title: "Prep portfolio",
            company: null,
            jobApplicationId: null,
            done: false,
          }),
        ]}
      />
    )

    expect(screen.getByText("Prep portfolio")).toBeTruthy()
    expect(container.querySelectorAll("a")).toHaveLength(0)
  })

  it("shows the company on a job-linked todo", () => {
    render(
      <CalendarAgenda
        items={[
          item({
            key: "todo:t1",
            type: "todo",
            title: "Prep portfolio",
            company: "Sharp Atoms",
            jobApplicationId: "j1",
            done: false,
          }),
        ]}
      />
    )

    expect(screen.getByText("Sharp Atoms")).toBeTruthy()
  })

  it("puts the overdue group above the day groups", () => {
    const { container } = render(
      <CalendarAgenda
        items={[
          item({ key: "follow-up:late", overdue: true }),
          item({
            key: "interview:soon",
            type: "interview",
            date: new Date("2026-09-20T13:00:00.000Z"),
            jobApplicationId: "j2",
          }),
        ]}
      />
    )

    const headings = Array.from(container.querySelectorAll("h3")).map(
      (node) => node.textContent
    )
    expect(headings[0]).toBe("Overdue")
    expect(headings).toHaveLength(2)
  })
})

describe("CalendarAgenda actions", () => {
  it("offers Done and Snooze on a follow-up, and keeps the link to the job", () => {
    render(<CalendarAgenda items={[item({ overdue: true })]} />)

    expect(
      screen.getByRole("button", {
        name: "Mark the follow-up for Sharp Atoms as done",
      })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", {
        name: "Snooze the follow-up for Sharp Atoms by 1 week",
      })
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Software Engineer" }).getAttribute("href")
    ).toBe("/jobs/j1#track")
  })

  it("does not offer follow-up buttons on an interview row", () => {
    render(
      <CalendarAgenda
        items={[
          item({ key: "interview:j1", type: "interview", date: new Date("2026-09-20T13:00:00.000Z") }),
        ]}
      />
    )

    expect(screen.queryByRole("button")).toBeNull()
  })

  it("lists an overdue todo under Overdue, with its checkbox", async () => {
    const { container } = render(
      <CalendarAgenda
        items={[
          item({
            key: "todo:t1",
            type: "todo",
            date: new Date("2026-08-28T00:00:00.000Z"),
            title: "Prep portfolio",
            company: null,
            jobApplicationId: null,
            done: false,
            overdue: true,
          }),
        ]}
      />
    )

    const headings = Array.from(container.querySelectorAll("h3")).map(
      (node) => node.textContent
    )
    expect(headings).toEqual(["Overdue"])
    expect(screen.getByText("Was due Fri, Aug 28", { exact: false })).toBeTruthy()

    fireEvent.click(screen.getByRole("checkbox", { name: "Mark Prep portfolio complete" }))

    await waitFor(() => expect(updateTodo).toHaveBeenCalledTimes(1))
    expect(updateTodo.mock.calls[0][0]).toBe("t1")
  })

  it("ticks a todo off from the agenda", async () => {
    render(
      <CalendarAgenda
        items={[
          item({
            key: "todo:t1",
            type: "todo",
            title: "Prep portfolio",
            company: null,
            jobApplicationId: null,
            done: false,
          }),
        ]}
      />
    )

    fireEvent.click(screen.getByRole("checkbox", { name: "Mark Prep portfolio complete" }))

    await waitFor(() => expect(updateTodo).toHaveBeenCalledTimes(1))
    expect(updateTodo.mock.calls[0][0]).toBe("t1")
    expect((updateTodo.mock.calls[0][1] as FormData).get("done")).toBe("true")
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})
