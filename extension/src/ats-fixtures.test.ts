import { beforeEach, describe, expect, it } from "vitest"

import {
  buildFillPlan,
  formSignature,
  type ProfileFacts,
} from "./autofill-core"
import { scanAutofillFields } from "./autofill-page"

/**
 * Maintained fixtures shaped like the real vendors' public application markup.
 * Live submission is never exercised; these pin the discovery and safety rules
 * that a live page would exercise.
 */

const PROFILE: ProfileFacts = {
  fullName: "Marisol Reyes",
  email: "marisol@example.com",
  phone: "+63 917 555 0100",
  location: "Manila, Philippines",
  linkedinUrl: "https://linkedin.com/in/marisol",
  githubUrl: "https://github.com/marisol",
  websiteUrl: "https://marisol.dev",
  currentRole: "Registered Nurse",
  targetRole: "Nurse Manager",
  workAuthorization: "PH citizen",
  requiresSponsorship: false,
  salaryMin: 45000,
  salaryMax: 55000,
  salaryCurrency: "PHP",
}

const GREENHOUSE = `
  <form id="application_form">
    <div class="field">
      <label for="first_name">First Name</label>
      <input id="first_name" name="first_name" autocomplete="given-name" required />
    </div>
    <div class="field">
      <label for="last_name">Last Name</label>
      <input id="last_name" name="last_name" autocomplete="family-name" required />
    </div>
    <div class="field">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required />
    </div>
    <div class="field">
      <label for="phone">Phone</label>
      <input id="phone" name="phone" type="tel" />
    </div>
    <div class="field">
      <label for="resume">Resume/CV</label>
      <input id="resume" name="resume" type="file" />
    </div>
    <fieldset>
      <legend>Are you legally authorized to work in the United States?</legend>
      <label><input type="radio" name="authorized" value="Yes" /> Yes</label>
      <label><input type="radio" name="authorized" value="No" /> No</label>
    </fieldset>
    <label for="why">Why do you want to work here?</label>
    <textarea id="why" name="why"></textarea>
    <button type="submit">Submit application</button>
  </form>
`

const LEVER = `
  <form>
    <div class="application-question">
      <label for="name">Full name</label>
      <input id="name" name="name" autocomplete="name" />
    </div>
    <div class="application-question">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" />
    </div>
    <div class="application-question">
      <label for="location-input">Current location</label>
      <input id="location-input" name="location" type="text" />
      <input id="selected-location" type="hidden" name="selectedLocation" />
    </div>
    <fieldset>
      <legend>Will you require visa sponsorship?</legend>
      <label><input type="radio" name="sponsorship" value="Yes" /> Yes</label>
      <label><input type="radio" name="sponsorship" value="No" /> No</label>
    </fieldset>
    <div class="application-question">
      <div class="application-label">What are your salary expectations?</div>
      <input name="cards[salary]" />
    </div>
    <button type="submit">Submit application</button>
  </form>
`

const ASHBY = `
  <form>
    <label for="ashby-name">Name</label>
    <input id="ashby-name" name="name" />
    <label for="ashby-email">Email</label>
    <input id="ashby-email" name="email" type="email" />
    <label for="ashby-portfolio">Portfolio URL</label>
    <input id="ashby-portfolio" name="portfolio" type="url" />
    <label for="ashby-github">GitHub</label>
    <input id="ashby-github" name="github" />
    <div role="group" aria-labelledby="ashby-gender-label">
      <div id="ashby-gender-label">Gender</div>
      <select id="ashby-gender" name="gender"><option>Choose</option><option>Woman</option><option>Man</option></select>
    </div>
    <label for="ashby-note">Anything else we should know?</label>
    <textarea id="ashby-note" name="note"></textarea>
    <button type="submit">Submit</button>
  </form>
`

beforeEach(() => {
  document.body.innerHTML = ""
  Element.prototype.getClientRects = function getClientRects() {
    return [{ width: 120, height: 28 }] as unknown as DOMRectList
  }
})

describe("Greenhouse fixture", () => {
  it("fills only the safe contact fields and sends everything else to review", () => {
    document.body.innerHTML = GREENHOUSE
    const fields = scanAutofillFields()
    const plan = buildFillPlan(PROFILE, fields)

    expect(plan.fills.map((fill) => fill.label)).toEqual([
      "First Name",
      "Last Name",
      "Email",
      "Phone",
    ])
    expect(plan.fills.find((fill) => fill.label === "First Name")?.value).toBe("Marisol")
    expect(plan.fills.find((fill) => fill.label === "Last Name")?.value).toBe("Reyes")

    const review = plan.review.map((item) => item.label)
    expect(review).toContain("Resume/CV")
    expect(review).toContain("Are you legally authorized to work in the United States?")
    expect(review).toContain("Why do you want to work here?")
    expect(plan.review.find((item) => item.label === "Resume/CV")?.isResumeUpload).toBe(true)
  })
})

describe("Lever fixture", () => {
  it("never guesses a sponsorship radio group, a typeahead or pay", () => {
    document.body.innerHTML = LEVER
    const fields = scanAutofillFields()
    const plan = buildFillPlan(PROFILE, fields)

    expect(plan.fills.map((fill) => fill.label)).toEqual(["Full name", "Email"])
    const review = plan.review.map((item) => item.label)
    expect(review).toContain("Current location")
    expect(review).toContain("Will you require visa sponsorship?")
    expect(review).toContain("What are your salary expectations?")

    const sponsorship = plan.review.find(
      (item) => item.label === "Will you require visa sponsorship?"
    )
    expect(sponsorship?.category).toBe("sponsorship")
    expect(sponsorship?.options).toEqual(["Yes", "No"])
    expect(plan.fills.some((fill) => fill.category === "sponsorship")).toBe(false)
  })

  it("does not write a select answer even when the user approved one", () => {
    document.body.innerHTML = LEVER
    const fields = scanAutofillFields()
    const approved = {
      "will you require visa sponsorship": "No",
      "current location": "Manila, Philippines",
    }
    const plan = buildFillPlan(PROFILE, fields, approved)
    expect(plan.fills.some((fill) => fill.category === "sponsorship")).toBe(false)
  })
})

describe("Ashby fixture", () => {
  it("treats a choice control as review and keeps a saved essay out of auto-fill", () => {
    document.body.innerHTML = ASHBY
    const fields = scanAutofillFields()
    const plan = buildFillPlan(PROFILE, fields, {
      "anything else we should know": "A saved essay the user approved earlier.",
    })

    expect(plan.fills.map((fill) => fill.label)).toEqual(["Name", "Email", "Portfolio URL", "GitHub"])
    expect(plan.review.map((item) => item.label)).toContain("Gender")
    expect(plan.review.map((item) => item.label)).toContain("Anything else we should know?")
    expect(plan.fills.some((fill) => fill.value.includes("saved essay"))).toBe(false)
  })
})

describe("dynamic forms", () => {
  it("changes the plan signature when a field appears, so a stale plan is refused", () => {
    document.body.innerHTML = GREENHOUSE
    const before = scanAutofillFields()
    const firstSignature = formSignature(before)

    const extra = document.createElement("input")
    extra.name = "pronouns"
    extra.setAttribute("aria-label", "Pronouns")
    document.getElementById("application_form")?.appendChild(extra)

    const after = scanAutofillFields()
    expect(after).toHaveLength(before.length + 1)
    expect(formSignature(after)).not.toBe(firstSignature)
  })

  it("keeps the signature stable across a re-render with the same fields", () => {
    document.body.innerHTML = GREENHOUSE
    const first = formSignature(scanAutofillFields())
    const second = formSignature(scanAutofillFields())
    expect(second).toBe(first)
  })
})
