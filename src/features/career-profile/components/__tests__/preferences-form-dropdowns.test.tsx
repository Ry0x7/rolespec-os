import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { PreferencesForm } from "../preferences-form"
import type { CareerPreferencesValues } from "../../types"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("../../actions/enhance", () => ({ enhanceCareerGoals: vi.fn() }))
vi.mock("../../actions/career-profile.actions", () => ({
  updateCareerPreferences: vi.fn(),
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
  careerGoals: null,
}

afterEach(cleanup)

describe("PreferencesForm dropdowns", () => {
  it("keeps a legacy free-text work authorization selected", () => {
    render(
      <PreferencesForm
        values={{ ...preferences, workAuthorization: "PH citizen; needs sponsorship elsewhere" }}
      />
    )

    const select = screen.getByLabelText("Work authorization") as HTMLSelectElement
    expect(select.value).toBe("PH citizen; needs sponsorship elsewhere")
    expect(screen.getByRole("option", { name: "Citizen" })).toBeTruthy()
  })

  it("submits stored locations, legacy ones included, one per line", () => {
    const { container } = render(
      <PreferencesForm values={{ ...preferences, locations: ["Berlin, Germany", "Japan"] }} />
    )

    const hidden = container.querySelector(
      'input[type="hidden"][name="locations"]'
    ) as HTMLInputElement
    expect(hidden.value).toBe("Berlin, Germany\nJapan")
    expect(screen.getByRole("button", { name: "Remove Berlin, Germany" })).toBeTruthy()
  })
})
