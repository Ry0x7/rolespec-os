import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { EvidenceCard } from "../evidence-card"
import { PreferencesForm } from "../preferences-form"
import type { CareerPreferencesValues, EvidenceRow } from "../../types"

const mocks = vi.hoisted(() => ({
  enhanceCareerGoals: vi.fn(),
  enhanceEvidence: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))
vi.mock("../../actions/enhance", () => ({
  enhanceCareerGoals: mocks.enhanceCareerGoals,
  enhanceEvidence: mocks.enhanceEvidence,
}))
vi.mock("../../actions/career-profile.actions", () => ({
  updateCareerPreferences: vi.fn(),
}))
vi.mock("../../actions/career-evidence.actions", () => ({
  confirmEvidence: vi.fn(),
  createEvidence: vi.fn(),
  deleteEvidence: vi.fn(),
  updateEvidence: vi.fn(),
}))

const preferences: CareerPreferencesValues = {
  experienceLevel: null,
  locations: [],
  openToRelocation: false,
  workModes: [],
  workAuthorization: null,
  requiresSponsorship: null,
  salaryMin: null,
  salaryMax: null,
  salaryPeriod: null,
  salaryCurrency: "USD",
  careerGoals: "want to be like a manager maybe",
}

function evidenceRow(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    id: "ev_1",
    kind: "EXPERIENCE",
    source: "USER_ENTERED",
    status: "CONFIRMED",
    title: "Frontend Engineer",
    organization: null,
    details: "did stuff with the checkout thing",
    outcome: null,
    startDate: null,
    endDate: null,
    ...overrides,
  }
}

function goalsField() {
  return screen.getByLabelText("Career goals") as HTMLTextAreaElement
}

function goalsEnhanceButton() {
  return screen.getByRole("button", { name: /enhance/i }) as HTMLButtonElement
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

describe("career goals enhance", () => {
  it("applies the enhanced text to the field and says it was saved", async () => {
    mocks.enhanceCareerGoals.mockResolvedValue({
      success: true,
      previous: "want to be like a manager maybe",
      enhanced: "Move into engineering management while staying hands-on.",
      unchanged: false,
    })
    render(<PreferencesForm values={preferences} />)

    fireEvent.click(goalsEnhanceButton())

    await waitFor(() =>
      expect(goalsField().value).toBe(
        "Move into engineering management while staying hands-on."
      )
    )
    expect(screen.getByText(/Enhanced and saved/)).toBeTruthy()
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Career goals enhanced")
  })

  it("leaves the field alone when nothing needed changing", async () => {
    mocks.enhanceCareerGoals.mockResolvedValue({
      success: true,
      previous: "want to be like a manager maybe",
      enhanced: "want to be like a manager maybe",
      unchanged: true,
    })
    render(<PreferencesForm values={preferences} />)

    fireEvent.click(goalsEnhanceButton())

    await waitFor(() =>
      expect(screen.getByText("Already clear — nothing was changed.")).toBeTruthy()
    )
    expect(goalsField().value).toBe("want to be like a manager maybe")
  })

  it("surfaces the action's error and applies nothing", async () => {
    mocks.enhanceCareerGoals.mockResolvedValue({ error: "Unauthorized" })
    render(<PreferencesForm values={preferences} />)

    fireEvent.click(goalsEnhanceButton())

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Unauthorized")
    )
    expect(goalsField().value).toBe("want to be like a manager maybe")
    expect(screen.queryByText(/Enhanced and saved/)).toBeNull()
  })

  it("waits for a save before offering to enhance an unsaved edit", () => {
    render(<PreferencesForm values={preferences} />)

    fireEvent.change(goalsField(), { target: { value: "something new" } })

    expect(goalsEnhanceButton().disabled).toBe(true)
    expect(mocks.enhanceCareerGoals).not.toHaveBeenCalled()
  })

  it("offers nothing to enhance on an empty field", () => {
    render(<PreferencesForm values={{ ...preferences, careerGoals: null }} />)

    expect(goalsEnhanceButton().disabled).toBe(true)
  })
})

describe("evidence enhance", () => {
  it("enhances the row the button belongs to and notes the change", async () => {
    mocks.enhanceEvidence.mockResolvedValue({
      success: true,
      previous: "did stuff with the checkout thing",
      enhanced: "Rebuilt the checkout flow end to end.",
      unchanged: false,
    })
    render(<EvidenceCard evidence={[evidenceRow()]} />)

    fireEvent.click(
      screen.getByRole("button", { name: "Enhance details for Frontend Engineer" })
    )

    expect(mocks.enhanceEvidence).toHaveBeenCalledWith("ev_1")
    await waitFor(() => expect(screen.getByText(/Enhanced and saved/)).toBeTruthy())
  })

  it("shows no enhance button on a row with no details", () => {
    render(<EvidenceCard evidence={[evidenceRow({ details: null })]} />)

    expect(screen.queryByRole("button", { name: /Enhance details/ })).toBeNull()
  })

  it("surfaces the action's error and writes no note", async () => {
    mocks.enhanceEvidence.mockResolvedValue({ error: "Not found" })
    render(<EvidenceCard evidence={[evidenceRow()]} />)

    fireEvent.click(
      screen.getByRole("button", { name: "Enhance details for Frontend Engineer" })
    )

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Not found"))
    expect(screen.queryByText(/Enhanced and saved/)).toBeNull()
  })
})
