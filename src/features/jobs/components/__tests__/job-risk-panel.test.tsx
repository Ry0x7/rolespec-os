import type { ComponentProps } from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const { mockAssessJobRisk, mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockAssessJobRisk: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: mockToastSuccess },
}))
vi.mock("../../actions/job-risk.actions", () => ({
  assessJobRisk: mockAssessJobRisk,
}))

import { JobEditContext } from "../job-edit-context"
import { JobRiskPanel } from "../job-risk-panel"
import { RiskBadge } from "../risk-badge"

const baseProps: ComponentProps<typeof JobRiskPanel> = {
  jobApplicationId: "j1",
  riskLevel: null,
  riskReasons: [],
  riskSource: null,
  riskCheckedAt: null,
  hasJobDescription: true,
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe("job risk panel", () => {
  it("renders the badge and reasons when the job is flagged", () => {
    render(
      <JobRiskPanel
        {...baseProps}
        riskLevel="HIGH"
        riskReasons={["Asks for a payment", "Personal email domain"]}
        riskSource="HEURISTIC"
        riskCheckedAt="2026-08-15T00:00:00.000Z"
      />,
    )

    expect(screen.getByText("Likely scam")).toBeTruthy()
    expect(screen.getByText("Asks for a payment")).toBeTruthy()
    expect(screen.getByText("Personal email domain")).toBeTruthy()
    expect(screen.getByText("Heuristic check at save")).toBeTruthy()
  })

  it("says not checked yet when nothing has run", () => {
    render(<JobRiskPanel {...baseProps} />)
    expect(screen.getByText("Not checked yet")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: /run ai risk check/i }),
    ).toBeTruthy()
  })

  it("disables the check and offers a way out of the dead end without a description", () => {
    const openEdit = vi.fn()
    render(
      <JobEditContext.Provider value={{ openEdit }}>
        <JobRiskPanel {...baseProps} hasJobDescription={false} />
      </JobEditContext.Provider>,
    )

    const run = screen.getByRole("button", { name: /run ai risk check/i })
    expect(run.hasAttribute("disabled")).toBe(true)
    expect(screen.getByText("Add a job description to run a risk check.")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /add job description/i }))
    expect(openEdit).toHaveBeenCalledWith("jobDescription")
  })

  it("says no red flags once an AI check cleared the job, and offers a re-check", () => {
    render(
      <JobRiskPanel
        {...baseProps}
        riskSource="AI"
        riskCheckedAt="2026-08-15T00:00:00.000Z"
      />,
    )
    expect(screen.getByText("No red flags detected")).toBeTruthy()
    expect(screen.getByRole("button", { name: /re-check/i })).toBeTruthy()
  })

  it("disables the button with a hint when there is no job description", () => {
    render(<JobRiskPanel {...baseProps} hasJobDescription={false} />)

    const button = screen.getByRole("button", { name: /run ai risk check/i })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Add a job description to run a risk check.")).toBeTruthy()
  })

  it("calls the action and shows the returned verdict", async () => {
    mockAssessJobRisk.mockResolvedValue({
      success: true,
      level: "MEDIUM",
      reasons: ["Vague company details"],
    })

    render(<JobRiskPanel {...baseProps} />)
    fireEvent.click(screen.getByRole("button", { name: /run ai risk check/i }))

    await waitFor(() => expect(mockAssessJobRisk).toHaveBeenCalledWith("j1"))
    await waitFor(() => expect(screen.getByText("Possible scam")).toBeTruthy())
    expect(screen.getByText("Vague company details")).toBeTruthy()
  })

  it("shows the action error inline", async () => {
    mockAssessJobRisk.mockResolvedValue({ error: "Something went wrong." })

    render(<JobRiskPanel {...baseProps} />)
    fireEvent.click(screen.getByRole("button", { name: /run ai risk check/i }))

    await waitFor(() => expect(screen.getByText("Something went wrong.")).toBeTruthy())
    expect(mockToastError).toHaveBeenCalledWith("Something went wrong.")
  })
})

describe("risk badge", () => {
  it("labels a HIGH level as likely scam", () => {
    render(<RiskBadge level="HIGH" />)
    expect(screen.getByText("Likely scam")).toBeTruthy()
  })

  it("renders nothing without a level", () => {
    const { container } = render(<RiskBadge level={null} />)
    expect(container.innerHTML).toBe("")
  })
})
