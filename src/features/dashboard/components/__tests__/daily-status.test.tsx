import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { DailyStatus } from "../daily-status"
import type { UpcomingEvent } from "@/features/jobs/services/dashboard-stats.service"

afterEach(cleanup)

const todayStart = new Date("2026-11-14T00:00:00.000Z")

const interview: UpcomingEvent = {
  id: "app-1",
  title: "Acme",
  subtitle: "Staff Engineer",
  status: "INTERVIEW",
  date: new Date("2026-11-15T15:00:00.000Z"),
  type: "interview",
  href: "/jobs/app-1",
}

function metric(name: "applications" | "follow-ups" | "upcoming") {
  return screen.getByText(
    name === "applications"
      ? "Applications today"
      : name === "follow-ups"
        ? "Follow-ups due"
        : "Coming up",
  ).closest(`[data-metric="${name}"]`) as HTMLElement
}

describe("DailyStatus", () => {
  it("puts applications, follow-ups and upcoming events at the top of the day", () => {
    render(
      <DailyStatus
        todayStart={todayStart}
        appliedToday={1}
        followUpDue={2}
        upcomingEvents={[interview]}
      />,
    )

    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy()

    const applications = metric("applications")
    expect(within(applications).getByText("1")).toBeTruthy()
    expect(within(applications).getByText("1 to go")).toBeTruthy()

    const followUps = metric("follow-ups")
    expect(within(followUps).getByText("2")).toBeTruthy()
    expect(within(followUps).getByText("Needs a nudge")).toBeTruthy()
    expect(followUps.getAttribute("href")).toBe("/jobs?filter=follow-up-due")

    const upcoming = metric("upcoming")
    expect(within(upcoming).getByText("Acme · Interview")).toBeTruthy()
    expect(within(upcoming).getByText("Tomorrow")).toBeTruthy()
  })

  it("moves every indicator to a clear state when the day is done", () => {
    render(
      <DailyStatus
        todayStart={todayStart}
        appliedToday={2}
        followUpDue={0}
        upcomingEvents={[]}
      />,
    )

    const applications = metric("applications")
    expect(within(applications).getByText("Goal met")).toBeTruthy()
    expect(
      within(applications)
        .getByRole("progressbar")
        .getAttribute("aria-valuenow"),
    ).toBe("2")

    expect(within(metric("follow-ups")).getByText("Clear")).toBeTruthy()
    expect(
      within(metric("upcoming")).getByText("Next 7 days are clear"),
    ).toBeTruthy()
  })
})
