import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { DEFAULT_PREFERENCES } from "../../schemas/preferences.schema"
import { DEFAULT_OPPORTUNITY_SETTINGS } from "@/features/opportunity/types"

const updatePreferences = vi.fn(async (input: unknown) => {
  void input
  return { success: true as const }
})
const refresh = vi.fn()

vi.mock("../../actions/preferences.actions", () => ({
  updatePreferences: (input: unknown) => updatePreferences(input),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { PreferencesForm } = await import("../preferences-form")

beforeEach(() => {
  updatePreferences.mockClear()
  refresh.mockClear()
})
afterEach(cleanup)

describe("PreferencesForm — Opportunity Value payload", () => {
  it("submits the stored block on a plain save", async () => {
    render(<PreferencesForm preferences={DEFAULT_PREFERENCES} />)

    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }))

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1))
    const payload = updatePreferences.mock.calls[0]![0] as {
      opportunityValue: typeof DEFAULT_OPPORTUNITY_SETTINGS
    }
    expect(payload.opportunityValue).toEqual(DEFAULT_PREFERENCES.opportunityValue)
  })

  it("submits edits made in the Opportunity Value section", async () => {
    render(<PreferencesForm preferences={DEFAULT_PREFERENCES} />)

    fireEvent.change(screen.getByLabelText("Minimum annual pay"), {
      target: { value: "1200000.00" },
    })
    fireEvent.change(screen.getByLabelText("Minimum pay currency"), {
      target: { value: "PHP" },
    })
    fireEvent.click(screen.getByLabelText("Strict — reject postings below this"))
    fireEvent.change(screen.getByLabelText("Workload preference"), {
      target: { value: "LIGHTER" },
    })
    fireEvent.change(screen.getByLabelText("Postings that do not state pay"), {
      target: { value: "REJECT" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }))

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1))
    const payload = updatePreferences.mock.calls[0]![0] as {
      opportunityValue: typeof DEFAULT_OPPORTUNITY_SETTINGS
    }
    expect(payload.opportunityValue).toMatchObject({
      minimumAnnualPay: "1200000.00",
      minimumPayCurrency: "PHP",
      minimumPayStrict: true,
      workloadPreference: "LIGHTER",
      unknownPay: "REJECT",
      preset: "BALANCED",
      weights: null,
    })
  })
})
