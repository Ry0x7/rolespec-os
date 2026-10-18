import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const { mockRecheck, mockStatus, mockRefresh, mockToast } = vi.hoisted(() => ({
  mockRecheck: vi.fn(),
  mockStatus: vi.fn(),
  mockRefresh: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("sonner", () => ({ toast: mockToast }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }))
vi.mock("../../actions/job-application.actions", () => ({
  updateJobApplicationStatus: mockStatus,
  clearJobApplicationFollowUp: vi.fn(),
  scheduleJobApplicationFollowUp: vi.fn(),
  snoozeJobApplicationFollowUp: vi.fn(),
}))
vi.mock("../../actions/job-qualification.actions", () => ({
  recheckJobQualification: mockRecheck,
}))

import { QuickActionButtons } from "../quick-action-buttons"

beforeEach(() => {
  vi.clearAllMocks()
  mockRecheck.mockResolvedValue({
    success: true,
    verdict: "WORTH_A_LOOK",
    checkedAt: "2026-09-14T00:00:00.000Z",
  })
})

afterEach(cleanup)

function renderCheckFit() {
  return render(
    <QuickActionButtons
      applicationId="app-1"
      companyName="Acme"
      actions={[{ kind: "check-fit", label: "Check fit" }]}
    />,
  )
}

describe("QuickActionButtons — check fit", () => {
  it("names the company in the accessible label", () => {
    renderCheckFit()

    expect(
      screen.getByRole("button", {
        name: "Check how Acme fits your Career Profile",
      }),
    ).toBeTruthy()
  })

  it("runs the re-check, confirms it and refreshes the list", async () => {
    renderCheckFit()

    fireEvent.click(screen.getByRole("button", { name: /Check how Acme/ }))

    await waitFor(() => expect(mockRecheck).toHaveBeenCalledWith("app-1"))
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Fit checked"))
    expect(mockRefresh).toHaveBeenCalled()
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it("reports a failure without refreshing", async () => {
    mockRecheck.mockResolvedValue({ error: "Job application not found" })
    renderCheckFit()

    fireEvent.click(screen.getByRole("button", { name: /Check how Acme/ }))

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith("Job application not found"),
    )
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

describe("QuickActionButtons — open", () => {
  function hrefFor(action: { label: string; section?: "decide" | "track" }) {
    render(
      <QuickActionButtons
        applicationId="app-1"
        companyName="Acme"
        actions={[{ kind: "open", ...action }]}
      />,
    )
    return screen
      .getByRole("link", { name: `${action.label} — Acme` })
      .getAttribute("href")
  }

  it("lands Decide on the Decide section", () => {
    expect(hrefFor({ label: "Decide", section: "decide" })).toBe("/jobs/app-1#decide")
  })

  it("lands Log the outcome on the Track section", () => {
    expect(hrefFor({ label: "Log the outcome", section: "track" })).toBe(
      "/jobs/app-1#track",
    )
  })

  it("keeps a plain Open at the top of the page", () => {
    expect(hrefFor({ label: "Open" })).toBe("/jobs/app-1")
  })
})
