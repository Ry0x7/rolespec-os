import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"

import {
  DEFAULT_OPPORTUNITY_SETTINGS,
  PRESET_WEIGHTS,
  type OpportunitySettings,
} from "@/features/opportunity/types"
import { DEFAULT_PREFERENCES, opportunitySettingsSchema } from "../../schemas/preferences.schema"
import { OpportunityValueSettings } from "../opportunity-value-settings"

afterEach(cleanup)

function renderSection(overrides: Partial<OpportunitySettings> = {}) {
  const onChange = vi.fn<(next: OpportunitySettings) => void>()

  // The section is controlled, like every other field in the form. The harness
  // feeds each change back so typing behaves the way it does for a real user.
  function Harness() {
    const [value, setValue] = useState<OpportunitySettings>({
      ...DEFAULT_OPPORTUNITY_SETTINGS,
      ...overrides,
    })
    return (
      <OpportunityValueSettings
        value={value}
        onChange={(next) => {
          onChange(next)
          setValue(next)
        }}
      />
    )
  }

  render(<Harness />)
  return { onChange }
}

function weightInput(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement
}

describe("OpportunityValueSettings", () => {
  it("renders the stored defaults", () => {
    renderSection()

    expect((screen.getByLabelText("Preset") as HTMLSelectElement).value).toBe("BALANCED")
    expect((screen.getByLabelText("Workload preference") as HTMLSelectElement).value).toBe(
      "BALANCED"
    )
    expect((screen.getByLabelText("Postings that do not state pay") as HTMLSelectElement).value).toBe(
      "FLAG"
    )
    expect((screen.getByLabelText("Minimum annual pay") as HTMLInputElement).value).toBe("")
    expect((screen.getByLabelText("Strict — reject postings below this") as HTMLInputElement).checked).toBe(
      false
    )
    // Custom weights are off until asked for.
    expect(screen.queryByLabelText("Verified compensation")).toBeNull()
  })

  it("starts custom weights from the selected preset and normalises nothing on screen", () => {
    renderSection()

    fireEvent.click(screen.getByLabelText("Use custom weights"))

    expect(weightInput("Verified compensation").value).toBe(
      String(PRESET_WEIGHTS.BALANCED.compensation)
    )
    expect(weightInput("Profile fit").value).toBe(String(PRESET_WEIGHTS.BALANCED.fit))
    expect(screen.getByText(/Weights are normalised/)).toBeTruthy()
  })

  it("resets the weights when the preset changes", () => {
    const { onChange } = renderSection({ preset: "BALANCED", weights: null })

    fireEvent.click(screen.getByLabelText("Use custom weights"))
    fireEvent.change(weightInput("Verified compensation"), { target: { value: "5" } })
    expect(weightInput("Verified compensation").value).toBe("5")

    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "PAY_OVER_LOAD" } })

    expect(weightInput("Verified compensation").value).toBe(
      String(PRESET_WEIGHTS.PAY_OVER_LOAD.compensation)
    )
    expect(weightInput("Workload").value).toBe(String(PRESET_WEIGHTS.PAY_OVER_LOAD.workload))

    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0]
    expect(last.preset).toBe("PAY_OVER_LOAD")
    expect(last.weights).toEqual(PRESET_WEIGHTS.PAY_OVER_LOAD)
  })

  it("sends null weights when custom weights are turned off", () => {
    const { onChange } = renderSection({
      preset: "PAY_OVER_LOAD",
      weights: { ...PRESET_WEIGHTS.PAY_OVER_LOAD },
    })

    fireEvent.click(screen.getByLabelText("Use custom weights"))

    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0]
    expect(last.weights).toBeNull()
  })

  it("round-trips a decimal minimum pay with its currency and strictness", () => {
    const { onChange } = renderSection()

    fireEvent.change(screen.getByLabelText("Minimum annual pay"), {
      target: { value: "900000.50" },
    })
    fireEvent.change(screen.getByLabelText("Minimum pay currency"), {
      target: { value: "USD" },
    })
    fireEvent.click(screen.getByLabelText("Strict — reject postings below this"))

    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0]
    expect(last.minimumAnnualPay).toBe("900000.50")
    expect(last.minimumPayCurrency).toBe("USD")
    expect(last.minimumPayStrict).toBe(true)

    const parsed = opportunitySettingsSchema.safeParse(last)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.minimumAnnualPay).toBe("900000.50")
  })

  it("rejects an invalid amount inline and in the schema", () => {
    const { onChange } = renderSection()

    fireEvent.change(screen.getByLabelText("Minimum annual pay"), {
      target: { value: "12,34" },
    })

    expect(screen.getByRole("alert").textContent).toMatch(/yearly amount/i)

    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0]
    expect(opportunitySettingsSchema.safeParse(last).success).toBe(false)
  })

  it("warns when a floor has no currency so it cannot be applied", () => {
    renderSection({ minimumAnnualPay: "900000", minimumPayCurrency: null })
    expect(screen.getByRole("status").textContent).toMatch(/choose a currency/i)
  })

  it("changes the unknown-pay policy", () => {
    const { onChange } = renderSection()

    fireEvent.change(screen.getByLabelText("Postings that do not state pay"), {
      target: { value: "REJECT" },
    })

    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0]
    expect(last.unknownPay).toBe("REJECT")
    expect(opportunitySettingsSchema.safeParse(last).success).toBe(true)
  })

  it("keeps every weight inside 0-100 when a user types a large number", () => {
    const { onChange } = renderSection()

    fireEvent.click(screen.getByLabelText("Use custom weights"))
    fireEvent.change(weightInput("Workload"), { target: { value: "999" } })

    expect(weightInput("Workload").value).toBe("100")
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0]
    expect(last.weights?.workload).toBe(100)
  })
})

describe("preferences default block", () => {
  it("parses the default opportunity settings as valid", () => {
    const parsed = opportunitySettingsSchema.safeParse(DEFAULT_PREFERENCES.opportunityValue)
    expect(parsed.success).toBe(true)
  })

  it("keeps every preset weight within the schema's range", () => {
    for (const weights of Object.values(PRESET_WEIGHTS)) {
      expect(opportunitySettingsSchema.safeParse({ ...DEFAULT_OPPORTUNITY_SETTINGS, weights }).success).toBe(
        true
      )
    }
  })

  it("renders all eight weights when custom weights are enabled", () => {
    renderSection({ weights: { ...PRESET_WEIGHTS.BALANCED } })
    const group = screen.getByRole("group", { name: /dimension weights/i })
    const inputs = within(group).getAllByRole("spinbutton")
    expect(inputs).toHaveLength(8)
  })
})
