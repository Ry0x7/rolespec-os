import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const { mockRecheck, mockRefresh, mockToast } = vi.hoisted(() => ({
  mockRecheck: vi.fn(),
  mockRefresh: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("sonner", () => ({ toast: mockToast }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }))
vi.mock("../../actions/job-qualification.actions", () => ({
  recheckJobQualification: mockRecheck,
}))

import { JobQualificationCard } from "../job-qualification-card"

const SNAPSHOT = {
  verdict: "STRONG",
  nextAction: "Worth a read.",
  checkedAt: "2026-01-05T00:00:00.000Z",
  worthIt: { signal: "GOOD", reasons: ["The posting is remote, which you want."] },
  eligible: { signal: "NEUTRAL", reasons: [] },
  match: { signal: "GOOD", reasons: [], matched: [], confirmedCount: 0 },
  risk: { signal: "GOOD", reasons: [], level: "LOW" },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRecheck.mockResolvedValue({
    success: true,
    verdict: "WORTH_A_LOOK",
    checkedAt: "2026-09-14T00:00:00.000Z",
  })
})

afterEach(cleanup)

describe("JobQualificationCard", () => {
  it("dates the snapshot without claiming it was taken at save time", () => {
    render(<JobQualificationCard jobApplicationId="app-1" qualification={SNAPSHOT} />)

    expect(
      screen.getByText(/Checked against your Career Profile on/),
    ).toBeTruthy()
    expect(screen.queryByText(/when you saved it/)).toBeNull()
  })

  it("renders the empty state and the check button when there is no snapshot", () => {
    render(<JobQualificationCard jobApplicationId="app-1" qualification={null} />)

    expect(screen.getByText("Why this job")).toBeTruthy()
    expect(screen.getByText("Not checked yet")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Check fit" })).toBeTruthy()
    // Nothing to date yet, so the caption stays off.
    expect(screen.queryByText(/Checked against your Career Profile/)).toBeNull()
  })

  it("re-checks the fit and refreshes the page", async () => {
    render(<JobQualificationCard jobApplicationId="app-1" qualification={SNAPSHOT} />)

    fireEvent.click(screen.getByRole("button", { name: "Re-check fit" }))

    await waitFor(() => expect(mockRecheck).toHaveBeenCalledWith("app-1"))
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Fit re-checked"))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it("calls a first check a check, not a re-check", async () => {
    render(<JobQualificationCard jobApplicationId="app-1" qualification={null} />)

    fireEvent.click(screen.getByRole("button", { name: "Check fit" }))

    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Fit checked"))
    expect(mockToast.success).not.toHaveBeenCalledWith("Fit re-checked")
  })

  it("surfaces a failure instead of pretending the check ran", async () => {
    mockRecheck.mockResolvedValue({ error: "Job application not found" })

    render(<JobQualificationCard jobApplicationId="app-1" qualification={SNAPSHOT} />)
    fireEvent.click(screen.getByRole("button", { name: "Re-check fit" }))

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith("Job application not found"),
    )
    expect(screen.getByText("Job application not found")).toBeTruthy()
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
