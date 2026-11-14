import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

import { ApplicationStatusTimeline } from "../application-status-timeline"

const TRACKING_STARTED = new Date("2026-10-01T09:00:00.000Z")

describe("ApplicationStatusTimeline", () => {
  it("renders each move oldest first, with the starting point, note and source", () => {
    render(
      <ApplicationStatusTimeline
        trackingStartedAt={TRACKING_STARTED}
        events={[
          {
            id: "evt-1",
            fromStatus: null,
            toStatus: "INTERESTED",
            note: null,
            source: "MIGRATION",
            createdAt: new Date("2026-10-01T09:00:00.000Z"),
          },
          {
            id: "evt-2",
            fromStatus: "INTERESTED",
            toStatus: "APPLIED",
            note: "Applied through the company site.",
            source: "USER",
            createdAt: new Date("2026-10-02T10:30:00.000Z"),
          },
        ]}
      />
    )

    expect(screen.getByRole("list", { name: "Application status history" })).toBeTruthy()
    expect(screen.getByText("Tracking started · Interested")).toBeTruthy()
    expect(screen.getByText("Interested → Applied")).toBeTruthy()
    expect(screen.getByText("Applied through the company site.")).toBeTruthy()
    expect(screen.getByText(/Starting point recorded/)).toBeTruthy()
    expect(screen.getByText(/Moved by you/)).toBeTruthy()
  })

  it("states when tracking began when no events exist yet", () => {
    render(
      <ApplicationStatusTimeline events={[]} trackingStartedAt={TRACKING_STARTED} />
    )

    expect(screen.getByText(/Tracking started/)).toBeTruthy()
    expect(
      screen.getByText(/Status changes will appear here as you move this application/)
    ).toBeTruthy()
  })

  it("uses a time element with the exact instant for each event", () => {
    render(
      <ApplicationStatusTimeline
        trackingStartedAt={TRACKING_STARTED}
        events={[
          {
            id: "evt-1",
            fromStatus: "APPLIED",
            toStatus: "INTERVIEW",
            note: null,
            source: "USER",
            createdAt: new Date("2026-10-03T12:00:00.000Z"),
          },
        ]}
      />
    )

    expect(
      screen.getByText("Applied → Interview").closest("li")?.querySelector("time")
        ?.getAttribute("datetime")
    ).toBe("2026-10-03T12:00:00.000Z")
  })
})
