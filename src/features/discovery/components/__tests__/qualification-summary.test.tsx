import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

// The detail card is a client component with a "Re-check fit" button; these
// tests only care about the reasoning it renders, so its wiring is stubbed.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/features/jobs/actions/job-qualification.actions", () => ({
  recheckJobQualification: vi.fn(),
}))

import { JobQualificationCard } from "@/features/jobs/components/job-qualification-card"

import { QualificationSummary } from "../qualification-summary"
import type { Qualification } from "../../services/qualify.service"

afterEach(cleanup)

const HONEST_RISK_LINE =
  "No scam signals in the quick heuristic check — run the AI risk check for a deeper look."

const qualification: Qualification = {
  worthIt: { signal: "GOOD", reasons: ["The posting is remote, which you want."] },
  eligible: { signal: "NEUTRAL", reasons: [] },
  match: { signal: "GOOD", reasons: [], matched: ["TypeScript"], confirmedCount: 1 },
  risk: { signal: "GOOD", reasons: [], level: "LOW" },
  verdict: "STRONG",
  nextAction: "Worth a read.",
  requirementFlags: [],
  marketFit: {
    fit: "UNKNOWN",
    reason: "The posting does not say where you need to be based.",
    label: "Location unstated",
  },
}

describe("QualificationSummary", () => {
  it("says the quick heuristics found nothing rather than 'Nothing to flag' for Risk?", () => {
    render(<QualificationSummary qualification={qualification} defaultExpanded />)

    expect(screen.getByText(HONEST_RISK_LINE)).toBeTruthy()
  })

  it("leaves the other questions' empty copy alone", () => {
    render(<QualificationSummary qualification={qualification} defaultExpanded />)

    // Eligible? and Match? have no reasons here; both keep the original wording.
    expect(screen.getAllByText("Nothing to flag.").length).toBe(2)
  })

  it("still lists real risk reasons instead of the empty line", () => {
    render(
      <QualificationSummary
        qualification={{
          ...qualification,
          risk: {
            signal: "CONCERN",
            reasons: ["The posting asks for payment."],
            level: "HIGH",
          },
        }}
        defaultExpanded
      />
    )

    expect(screen.getByText("The posting asks for payment.")).toBeTruthy()
    expect(screen.queryByText(HONEST_RISK_LINE)).toBeNull()
  })

  it("shows the same line on the collapsed discovery card once Why? is opened", () => {
    render(<QualificationSummary qualification={qualification} />)

    expect(screen.queryByText(HONEST_RISK_LINE)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Why\?/ }))

    expect(screen.getByText(HONEST_RISK_LINE)).toBeTruthy()
  })
})

describe("JobQualificationCard", () => {
  it("shows the same risk line on the persisted snapshot surface", () => {
    render(
      <JobQualificationCard
        jobApplicationId="app-1"
        qualification={{
          verdict: "STRONG",
          nextAction: "Worth a read.",
          checkedAt: "2026-01-05T00:00:00.000Z",
          worthIt: { signal: "GOOD", reasons: ["The posting is remote, which you want."] },
          eligible: { signal: "NEUTRAL", reasons: [] },
          match: { signal: "GOOD", reasons: [], matched: [], confirmedCount: 0 },
          risk: { signal: "GOOD", reasons: [], level: "LOW" },
        }}
      />
    )

    expect(screen.getByText("Why this job")).toBeTruthy()
    expect(screen.getByText(HONEST_RISK_LINE)).toBeTruthy()
  })
})

describe("next action on an already-saved application", () => {
  it("shows the discovery snapshot's own line when nothing overrides it", () => {
    render(<QualificationSummary qualification={qualification} />)

    expect(screen.getByText("Worth a read.")).toBeTruthy()
  })

  it("replaces it with the caller's next step, keeping the four stored steps", () => {
    render(
      <QualificationSummary
        qualification={{
          ...qualification,
          nextAction: "Save it and tailor a resume from the matching role family.",
        }}
        nextAction="Strong fit — prepare and apply"
        defaultExpanded
      />,
    )

    expect(screen.getByText("Strong fit — prepare and apply")).toBeTruthy()
    expect(screen.queryByText(/Save it and tailor a resume/)).toBeNull()
    // The four stored fit steps are untouched.
    expect(screen.getByText("The posting is remote, which you want.")).toBeTruthy()
    expect(screen.getByText(HONEST_RISK_LINE)).toBeTruthy()
  })

  it("passes the override through the job detail card", () => {
    render(
      <JobQualificationCard
        jobApplicationId="app-1"
        qualification={{
          verdict: "STRONG",
          nextAction: "Save it and tailor a resume from the matching role family.",
          checkedAt: "2026-09-11T00:00:00.000Z",
          worthIt: { signal: "GOOD", reasons: [] },
          eligible: { signal: "NEUTRAL", reasons: [] },
          match: { signal: "GOOD", reasons: [], matched: [], confirmedCount: 0 },
          risk: { signal: "GOOD", reasons: [], level: "LOW" },
        }}
        nextAction="Follow up — 13 days overdue"
      />,
    )

    expect(screen.getByText("Follow up — 13 days overdue")).toBeTruthy()
    expect(screen.queryByText(/Save it and tailor a resume/)).toBeNull()
  })
})
