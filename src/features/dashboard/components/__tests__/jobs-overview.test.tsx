import { describe, it, expect, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { JobsOverview } from "../jobs-overview"
import type {
  StatusCount,
  UpcomingEvent,
} from "@/features/jobs/services/dashboard-stats.service"

afterEach(cleanup)

const statusCounts: StatusCount[] = [
  { status: "INTERESTED", count: 4 },
  { status: "APPLIED", count: 12 },
  { status: "SCREENING", count: 0 },
  { status: "INTERVIEW", count: 2 },
  { status: "OFFER", count: 0 },
  { status: "REJECTED", count: 7 },
  { status: "WITHDRAWN", count: 0 },
]

function renderOverview(counts: StatusCount[] = statusCounts) {
  return render(
    <JobsOverview
      todayStart={new Date("2026-09-09T00:00:00.000Z")}
      appliedToday={1}
      statusCounts={counts}
      upcomingEvents={[]}
      recentApplications={[]}
    />,
  )
}

describe("JobsOverview status strip", () => {
  it("shows a labelled count for every status", () => {
    renderOverview()

    for (const { status, count } of statusCounts) {
      const label = status.charAt(0) + status.slice(1).toLowerCase()
      const item = screen.getByText(label).closest("li") as HTMLElement
      expect(within(item).getByText(String(count))).toBeTruthy()
    }
  })

  it("mutes the count for statuses with nothing in them", () => {
    renderOverview()

    const offer = screen.getByText("Offer").closest("li") as HTMLElement
    expect(within(offer).getByText("0").className).toContain(
      "text-muted-foreground",
    )

    const applied = screen.getByText("Applied").closest("li") as HTMLElement
    expect(within(applied).getByText("12").className).toContain("text-foreground")
  })
})

describe("JobsOverview upcoming events", () => {
  const upcomingEvents: UpcomingEvent[] = [
    {
      id: "app-1",
      title: "Acme Corp",
      subtitle: "Staff Engineer",
      status: "INTERVIEW",
      date: new Date("2026-09-10T00:00:00.000Z"),
      type: "interview",
      href: "/jobs/app-1",
    },
  ]

  it("links each upcoming row to its job application", () => {
    render(
      <JobsOverview
        todayStart={new Date("2026-09-09T00:00:00.000Z")}
        appliedToday={1}
        statusCounts={statusCounts}
        upcomingEvents={upcomingEvents}
        recentApplications={[]}
      />,
    )

    const link = screen.getByRole("link", { name: "Acme Corp" })
    expect(link.getAttribute("href")).toBe("/jobs/app-1")
  })

  it("shows a todo as a task row, linked where its own event points", () => {
    render(
      <JobsOverview
        todayStart={new Date("2026-09-09T00:00:00.000Z")}
        appliedToday={1}
        statusCounts={statusCounts}
        upcomingEvents={[
          ...upcomingEvents,
          {
            id: "todo-1",
            title: "Send the take-home",
            subtitle: "Acme Corp",
            status: null,
            date: new Date("2026-09-11T00:00:00.000Z"),
            type: "todo",
            href: "/jobs/app-1",
          },
          {
            id: "todo-2",
            title: "Update the portfolio",
            subtitle: null,
            status: null,
            date: new Date("2026-09-12T00:00:00.000Z"),
            type: "todo",
            href: "/planner",
          },
        ]}
        recentApplications={[]}
      />,
    )

    const linked = screen.getByRole("link", { name: "Send the take-home" })
    expect(linked.getAttribute("href")).toBe("/jobs/app-1")
    expect(linked.closest("li")?.textContent).toContain("Task")

    const standalone = screen.getByRole("link", { name: "Update the portfolio" })
    expect(standalone.getAttribute("href")).toBe("/planner")
  })
})

describe("JobsOverview layout", () => {
  const event: UpcomingEvent = {
    id: "app-1",
    title: "Acme Corp",
    subtitle: "Staff Engineer",
    status: "INTERVIEW",
    date: new Date("2026-09-10T00:00:00.000Z"),
    type: "interview",
    href: "/jobs/app-1",
  }

  it("leaves the upcoming card out entirely when nothing is scheduled", () => {
    renderOverview()

    expect(screen.queryByText("Upcoming (next 7 days)")).toBeNull()
    expect(screen.queryByText("Nothing scheduled")).toBeNull()
  })

  it("renders the upcoming card when there are events", () => {
    render(
      <JobsOverview
        todayStart={new Date("2026-09-09T00:00:00.000Z")}
        appliedToday={1}
        statusCounts={statusCounts}
        upcomingEvents={[event]}
        recentApplications={[]}
      />,
    )

    expect(screen.getByText("Upcoming (next 7 days)")).toBeTruthy()
  })

  it("puts the daily goal after recent applications", () => {
    renderOverview()

    const recent = screen.getByText("Recent applications")
    const goal = screen.getByText("Applied today")
    expect(
      recent.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

describe("JobsOverview upcoming overflow", () => {
  function events(count: number): UpcomingEvent[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `app-${i + 1}`,
      title: `Company ${i + 1}`,
      subtitle: null,
      status: "APPLIED",
      date: new Date("2026-09-10T00:00:00.000Z"),
      type: "deadline",
      href: `/jobs/app-${i + 1}`,
    }))
  }

  function renderWith(upcomingEvents: UpcomingEvent[]) {
    return render(
      <JobsOverview
        todayStart={new Date("2026-09-09T00:00:00.000Z")}
        appliedToday={1}
        statusCounts={statusCounts}
        upcomingEvents={upcomingEvents}
        recentApplications={[]}
      />,
    )
  }

  it("shows six rows until asked for the rest, then collapses again", () => {
    renderWith(events(9))

    expect(screen.getByRole("link", { name: "Company 6" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Company 7" })).toBeNull()

    const toggle = screen.getByRole("button", { name: "Show all (9)" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")

    fireEvent.click(toggle)

    expect(screen.getByRole("link", { name: "Company 9" })).toBeTruthy()
    const fewer = screen.getByRole("button", { name: "Show fewer" })
    expect(fewer.getAttribute("aria-expanded")).toBe("true")

    fireEvent.click(fewer)
    expect(screen.queryByRole("link", { name: "Company 7" })).toBeNull()
  })

  it("has no toggle when six or fewer events exist", () => {
    renderWith(events(6))

    expect(screen.getByRole("link", { name: "Company 6" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull()
  })
})
