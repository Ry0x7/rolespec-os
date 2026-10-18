import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"

import { localCalendarDateString } from "@/shared/lib/dates"
import { NeedsAttention } from "../needs-attention"
import type {
  AwaitingOutcomeItem,
  DecideQueueItem,
  OverdueFollowUp,
} from "@/features/jobs/services/dashboard-attention.service"

const clearJobApplicationFollowUp = vi.fn()
const scheduleJobApplicationFollowUp = vi.fn()
const snoozeJobApplicationFollowUp = vi.fn()
const updateJobApplicationStatus = vi.fn()
const refresh = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: (...args: unknown[]) => refresh(...args) }),
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
  scheduleJobApplicationFollowUp: (...args: unknown[]) =>
    scheduleJobApplicationFollowUp(...args),
  snoozeJobApplicationFollowUp: (...args: unknown[]) =>
    snoozeJobApplicationFollowUp(...args),
  updateJobApplicationStatus: (...args: unknown[]) =>
    updateJobApplicationStatus(...args),
}))

// The quick-action buttons reach a second server-action module for "Check fit";
// unmocked it drags `next-auth` into jsdom at import time.
vi.mock("@/features/jobs/actions/job-qualification.actions", () => ({
  recheckJobQualification: vi.fn(),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  clearJobApplicationFollowUp.mockResolvedValue({ success: true })
  snoozeJobApplicationFollowUp.mockResolvedValue({ success: true })
})

const overdue: OverdueFollowUp[] = [
  {
    id: "app-1",
    companyName: "SharpAtoms",
    jobTitle: "Senior Engineer",
    followUpAt: new Date("2026-09-01T00:00:00.000Z"),
    daysOverdue: 8,
  },
]

const decide: DecideQueueItem[] = [
  {
    id: "app-2",
    companyName: "Northwind",
    jobTitle: "Platform Engineer",
    verdict: "STRONG",
    reason: "Strong fit — prepare and apply",
    confidence: {
      level: "HIGH",
      summary: "Official ATS board, posted 4 days ago, named employer.",
    },
  },
]

describe("NeedsAttention", () => {
  it("renders nothing when both lists are empty", () => {
    const { container } = render(
      <NeedsAttention
        overdueFollowUps={[]}
        overdueTotal={0}
        decideQueue={[]}
        interestedTotal={0}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it("shows an overdue follow-up with its day count, linked to the application", () => {
    render(
      <NeedsAttention
        overdueFollowUps={overdue}
        overdueTotal={1}
        decideQueue={[]}
        interestedTotal={0}
      />,
    )

    expect(screen.getByText("Overdue follow-ups")).toBeTruthy()
    expect(screen.getByText("8 days overdue")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "SharpAtoms" }).getAttribute("href"),
    ).toBe("/jobs/app-1#track")
  })

  it("labels a follow-up due today rather than '0 days overdue'", () => {
    render(
      <NeedsAttention
        overdueFollowUps={[{ ...overdue[0], daysOverdue: 0 }]}
        overdueTotal={1}
        decideQueue={[]}
        interestedTotal={0}
      />,
    )

    expect(screen.getByText("Due today")).toBeTruthy()
    expect(screen.queryByText("0 days overdue")).toBeNull()
  })

  it("offers the filtered list only when more are overdue than shown", () => {
    const { rerender } = render(
      <NeedsAttention
        overdueFollowUps={overdue}
        overdueTotal={1}
        decideQueue={[]}
        interestedTotal={0}
      />,
    )
    expect(screen.queryByText("View all 5")).toBeNull()

    rerender(
      <NeedsAttention
        overdueFollowUps={overdue}
        overdueTotal={5}
        decideQueue={[]}
        interestedTotal={0}
      />,
    )
    expect(
      screen.getByRole("link", { name: "View all 5" }).getAttribute("href"),
    ).toBe("/jobs?filter=follow-up-due")
  })

  it("shows a decide row with its verdict badge, reason, and job link", () => {
    render(
      <NeedsAttention
        overdueFollowUps={[]}
        overdueTotal={0}
        decideQueue={decide}
        interestedTotal={13}
      />,
    )

    expect(screen.getByText("Decide next")).toBeTruthy()
    expect(screen.getByText("Strong fit")).toBeTruthy()
    expect(
      screen.getByText("Strong fit — prepare and apply"),
    ).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: /Northwind/ })
        .getAttribute("href"),
    ).toBe("/jobs/app-2#decide")
    expect(
      screen.getByRole("link", { name: "All 13 to decide" }).getAttribute("href"),
    ).toBe("/jobs")
  })

  it("renders a decide row with no readable snapshot, without a badge", () => {
    render(
      <NeedsAttention
        overdueFollowUps={[]}
        overdueTotal={0}
        decideQueue={[
          {
            ...decide[0],
            verdict: null,
            reason: "Not assessed — open it and judge for yourself",
          },
        ]}
        interestedTotal={1}
      />,
    )

    expect(screen.getByRole("link", { name: /Northwind/ })).toBeTruthy()
    expect(screen.queryByText("Strong fit")).toBeNull()
    expect(
      screen.getByText("Not assessed — open it and judge for yourself"),
    ).toBeTruthy()
  })

  it("puts the overdue section above the decide section", () => {
    const { container } = render(
      <NeedsAttention
        overdueFollowUps={overdue}
        overdueTotal={1}
        decideQueue={decide}
        interestedTotal={13}
      />,
    )

    const headings = Array.from(container.querySelectorAll("h3")).map((node) =>
      node.textContent?.trim(),
    )
    expect(headings).toEqual(["Overdue follow-ups", "Decide next"])
  })
})

describe("NeedsAttention overdue actions", () => {
  it("offers Done and Snooze on each overdue row", () => {
    render(
      <NeedsAttention
        overdueFollowUps={overdue}
        overdueTotal={1}
        decideQueue={[]}
        interestedTotal={0}
      />,
    )

    expect(
      screen.getByRole("button", {
        name: "Mark the follow-up for SharpAtoms as done",
      }).textContent,
    ).toMatch("Done")
    expect(
      screen.getByRole("button", {
        name: "Snooze the follow-up for SharpAtoms by 1 week",
      }).textContent,
    ).toMatch("Snooze 1 week")
  })

  it("clears the follow-up and refreshes the dashboard", async () => {
    render(
      <NeedsAttention
        overdueFollowUps={overdue}
        overdueTotal={1}
        decideQueue={[]}
        interestedTotal={0}
      />,
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "Mark the follow-up for SharpAtoms as done",
      }),
    )

    await waitFor(() =>
      expect(clearJobApplicationFollowUp).toHaveBeenCalledWith("app-1"),
    )
    expect(toastSuccess).toHaveBeenCalledWith("Follow-up logged")
    expect(refresh).toHaveBeenCalled()
  })

  it("snoozes the follow-up a week out from the reader's own day", async () => {
    render(
      <NeedsAttention
        overdueFollowUps={overdue}
        overdueTotal={1}
        decideQueue={[]}
        interestedTotal={0}
      />,
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "Snooze the follow-up for SharpAtoms by 1 week",
      }),
    )

    await waitFor(() =>
      expect(snoozeJobApplicationFollowUp).toHaveBeenCalledWith(
        "app-1",
        localCalendarDateString(),
      ),
    )
    expect(toastSuccess).toHaveBeenCalledWith("Follow-up snoozed for a week")
    expect(refresh).toHaveBeenCalled()
  })

  it("reports a failure and leaves the dashboard as it was", async () => {
    snoozeJobApplicationFollowUp.mockResolvedValue({ error: "Not found" })
    render(
      <NeedsAttention
        overdueFollowUps={overdue}
        overdueTotal={1}
        decideQueue={[]}
        interestedTotal={0}
      />,
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "Snooze the follow-up for SharpAtoms by 1 week",
      }),
    )

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not found"))
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe("NeedsAttention awaiting outcome", () => {
  const awaiting: AwaitingOutcomeItem[] = [
    {
      id: "app-3",
      companyName: "Contoso",
      jobTitle: "Staff Engineer",
      interviewDate: new Date("2026-09-10T15:00:00.000Z"),
      daysSince: 4,
    },
  ]

  it("shows a past interview with its age, linked to the Track section", () => {
    render(
      <NeedsAttention
        overdueFollowUps={[]}
        overdueTotal={0}
        awaitingOutcome={awaiting}
        decideQueue={[]}
        interestedTotal={0}
      />,
    )

    expect(screen.getByText("Interview was 4 days ago · Log the outcome")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Contoso" }).getAttribute("href"),
    ).toBe("/jobs/app-3#track")
    // Track owns the status; the row does not offer its own select.
    expect(screen.queryByRole("combobox")).toBeNull()
  })

  it("says '1 day ago' for yesterday's interview", () => {
    render(
      <NeedsAttention
        overdueFollowUps={[]}
        overdueTotal={0}
        awaitingOutcome={[{ ...awaiting[0], daysSince: 1 }]}
        decideQueue={[]}
        interestedTotal={0}
      />,
    )

    expect(screen.getByText("Interview was 1 day ago · Log the outcome")).toBeTruthy()
  })

  it("sits between the overdue and decide rows", () => {
    render(
      <NeedsAttention
        overdueFollowUps={overdue}
        overdueTotal={1}
        awaitingOutcome={awaiting}
        decideQueue={decide}
        interestedTotal={1}
      />,
    )

    const links = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter((href) => href?.startsWith("/jobs/app-"))
    expect(links.indexOf("/jobs/app-1#track")).toBeLessThan(
      links.indexOf("/jobs/app-3#track"),
    )
    expect(links.indexOf("/jobs/app-3#track")).toBeLessThan(
      links.indexOf("/jobs/app-2#decide"),
    )
  })
})
