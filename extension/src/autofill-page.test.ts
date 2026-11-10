import { beforeEach, describe, expect, it, vi } from "vitest"

import { fillAutofillFields, scanAutofillFields } from "./autofill-page"

/**
 * jsdom reports no layout boxes, so every control would look hidden. The scanner
 * only needs to know the page is rendered; a non-empty box list is enough.
 */
beforeEach(() => {
  document.body.innerHTML = ""
  Element.prototype.getClientRects = function getClientRects() {
    return [{ width: 120, height: 28 }] as unknown as DOMRectList
  }
})

function buildForm() {
  document.body.innerHTML = `
    <form id="application">
      <button id="submit" type="submit">Submit application</button>
      <label for="first">First name</label><input id="first" name="first_name" autocomplete="given-name" />
      <label>Email <input id="email" name="email" type="email" /></label>
      <input id="phone" name="phone" type="tel" aria-label="Mobile phone" />
      <label for="auth">Are you authorized to work?</label>
      <select id="auth" name="authorized"><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select>
      <label for="why">Why do you want this role?</label><textarea id="why" name="why"></textarea>
      <input type="hidden" name="csrf" value="x" />
      <input id="disabled" name="disabled" disabled />
    </form>
  `
}

describe("scanAutofillFields", () => {
  it("reads visible labelled fields and skips hidden or disabled ones", () => {
    buildForm()
    const fields = scanAutofillFields()

    expect(fields.map((f) => f.label)).toEqual([
      "First name",
      "Email",
      "Mobile phone",
      "Are you authorized to work?",
      "Why do you want this role?",
    ])
    expect(fields.find((f) => f.label === "Are you authorized to work?")?.options).toEqual([
      "Select",
      "Yes",
      "No",
    ])
    expect(fields.find((f) => f.label === "Email")?.autocomplete).toBeUndefined()
    expect(fields.find((f) => f.label === "First name")?.autocomplete).toBe("given-name")
  })

  it("uses the group question for a radio set and keeps every option", () => {
    document.body.innerHTML = `
      <div class="application-field">
        <div class="application-label">Will you require visa sponsorship?</div>
        <ul>
          <li><label><input type="radio" name="sponsorship" value="Yes" required /><span>Yes</span></label></li>
          <li><label><input type="radio" name="sponsorship" value="No" required /><span>No</span></label></li>
        </ul>
      </div>
    `

    const fields = scanAutofillFields()

    expect(fields).toHaveLength(1)
    expect(fields[0].label).toBe("Will you require visa sponsorship?")
    expect(fields[0].options).toEqual(["Yes", "No"])
  })

  it("uses the question above a bare select instead of its name", () => {
    document.body.innerHTML = `
      <div class="application-question">
        <div class="application-label">Are you legally authorized to work in the United States?</div>
        <div class="application-field">
          <div><select name="cards[abc][field0]" required><option>Select...</option><option>Yes</option><option>No</option></select></div>
        </div>
      </div>
    `

    const fields = scanAutofillFields()

    expect(fields).toHaveLength(1)
    expect(fields[0].label).toBe("Are you legally authorized to work in the United States?")
    expect(fields[0].options).toEqual(["Select...", "Yes", "No"])
  })

  it("marks a location typeahead that needs a suggestion", () => {
    document.body.innerHTML = `
      <div class="application-field">
        <label for="location-input">Current location</label>
        <input id="location-input" name="location" type="text" />
        <input id="selected-location" type="hidden" name="selectedLocation" />
      </div>
      <label for="plain">Current city</label><input id="plain" name="city" />
    `

    const fields = scanAutofillFields()
    expect(fields.find((f) => f.label === "Current location")?.requiresSelection).toBe(true)
    expect(fields.find((f) => f.label === "Current city")?.requiresSelection).toBeUndefined()
  })

  it("never reads a value the page already contains", () => {
    buildForm()
    const email = document.getElementById("email") as HTMLInputElement
    email.value = "secret@example.com"

    const fields = scanAutofillFields()
    expect(JSON.stringify(fields)).not.toContain("secret@example.com")
  })

  it("scans a second time with stable ids", () => {
    buildForm()
    const first = scanAutofillFields()
    const second = scanAutofillFields()
    expect(second.map((f) => f.id)).toEqual(first.map((f) => f.id))
  })
})

describe("fillAutofillFields", () => {
  it("writes text fields, dispatches input/change and never submits", () => {
    buildForm()
    const fields = scanAutofillFields()
    const first = fields.find((f) => f.label === "First name")!
    const email = fields.find((f) => f.label === "Email")!
    const submit = document.getElementById("submit") as HTMLButtonElement
    const submitSpy = vi.fn()
    submit.addEventListener("click", submitSpy)
    const form = document.getElementById("application") as HTMLFormElement
    const formSubmit = vi.fn()
    form.addEventListener("submit", formSubmit)

    const inputEvents: string[] = []
    document.getElementById("first")!.addEventListener("input", () => inputEvents.push("input"))
    document.getElementById("first")!.addEventListener("change", () => inputEvents.push("change"))

    const result = fillAutofillFields([
      { id: first.id, value: "Marisol" },
      { id: email.id, value: "marisol@example.com" },
    ])

    expect(result).toEqual({ filled: 2, missed: 0 })
    expect((document.getElementById("first") as HTMLInputElement).value).toBe("Marisol")
    expect((document.getElementById("email") as HTMLInputElement).value).toBe(
      "marisol@example.com",
    )
    expect(inputEvents).toEqual(["input", "change"])
    expect(submitSpy).not.toHaveBeenCalled()
    expect(formSubmit).not.toHaveBeenCalled()
  })

  it("selects an option by its visible text", () => {
    buildForm()
    const fields = scanAutofillFields()
    const auth = fields.find((f) => f.label === "Are you authorized to work?")!
    const result = fillAutofillFields([{ id: auth.id, value: "Yes" }])
    expect(result.filled).toBe(1)
    expect((document.getElementById("auth") as HTMLSelectElement).value).toBe("yes")
  })

  it("reports a missing or non-fillable target instead of throwing", () => {
    buildForm()
    expect(fillAutofillFields([{ id: "af-999", value: "x" }])).toEqual({
      filled: 0,
      missed: 1,
    })
    expect(fillAutofillFields([{ id: "not-an-id", value: "x" }])).toEqual({
      filled: 0,
      missed: 1,
    })
  })
})
