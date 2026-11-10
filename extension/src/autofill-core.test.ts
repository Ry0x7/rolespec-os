import { describe, expect, it } from "vitest"

import {
  answerKey,
  autofillHostFor,
  buildFillPlan,
  classifyField,
  isAutofillSupportedUrl,
  splitFullName,
  type FieldDescriptor,
  type ProfileFacts,
} from "./autofill-core"

function field(overrides: Partial<FieldDescriptor>): FieldDescriptor {
  return {
    id: "af-0",
    label: "Field",
    tagName: "input",
    type: "text",
    ...overrides,
  }
}

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
  requiresSponsorship: true,
  salaryMin: 45000,
  salaryMax: 55000,
  salaryCurrency: "PHP",
}

describe("classifyField", () => {
  it.each([
    ["First name", "identity", "fullName"],
    ["Last name", "identity", "fullName"],
    ["Full name", "identity", "fullName"],
    ["Email address", "contact", "email"],
    ["Mobile phone", "contact", "phone"],
    ["Current city", "contact", "location"],
    ["LinkedIn profile", "link", "linkedinUrl"],
    ["GitHub", "link", "githubUrl"],
    ["Portfolio", "link", "websiteUrl"],
  ])("treats %s as a safe %s field", (label, category, profileKey) => {
    const result = classifyField(field({ label }))
    expect(result.sensitivity).toBe("safe")
    expect(result.category).toBe(category)
    expect(result.profileKey).toBe(profileKey)
  })

  it("keeps a typeahead field in review instead of writing free text it will discard", () => {
    const location = field({ label: "Current location", requiresSelection: true })
    const plan = buildFillPlan(PROFILE, [location])

    expect(plan.fills).toEqual([])
    expect(plan.review).toHaveLength(1)
    expect(plan.review[0]).toMatchObject({
      label: "Current location",
      suggestedValue: "Manila, Philippines",
    })
    expect(plan.review[0].reason).toContain("picked from its suggestions")

    const approved = buildFillPlan(PROFILE, [location], {
      [answerKey("Current location")]: "Cebu, Philippines",
    })
    expect(approved.fills).toEqual([])
    expect(approved.review[0].suggestedValue).toBe("Cebu, Philippines")
  })

  it("does not mistake Company name for a person's name", () => {
    const result = classifyField(field({ label: "Company name" }))
    expect(result.category).toBe("work")
    expect(result.sensitivity).toBe("unknown")
  })

  it.each([
    ["Are you authorized to work in the US?", "authorization"],
    ["Will you require visa sponsorship?", "sponsorship"],
    ["Desired salary", "compensation"],
    ["Gender", "demographic"],
    ["Do you have a criminal conviction?", "legal"],
  ])("keeps %s in the review queue", (label, category) => {
    const result = classifyField(field({ label }))
    expect(result.category).toBe(category)
    expect(result.sensitivity).toBe("sensitive")
  })

  it("treats a textarea as a sensitive free-text answer", () => {
    expect(classifyField(field({ label: "Notes", tagName: "textarea" }))).toMatchObject({
      category: "essay",
      sensitivity: "sensitive",
    })
  })

  it("treats a file input as a document that is never automated", () => {
    expect(classifyField(field({ label: "Resume", type: "file" }))).toMatchObject({
      category: "document",
      sensitivity: "sensitive",
    })
  })

  it("never guesses a select option", () => {
    expect(
      classifyField(field({ label: "Country", tagName: "select" })),
    ).toMatchObject({ category: "unknown", sensitivity: "unknown" })
  })

  it("does not let a choice control borrow a safe contact meaning", () => {
    const radio = field({
      label: "Are you able to work onsite in the location listed on this job?",
      type: "radio",
    })
    const select = field({ label: "Current location", tagName: "select" })

    for (const choice of [radio, select]) {
      expect(classifyField(choice)).toMatchObject({
        category: "unknown",
        sensitivity: "unknown",
      })
      expect(buildFillPlan(PROFILE, [choice]).fills).toHaveLength(0)
    }
  })
})

describe("buildFillPlan", () => {
  it("fills only safe fields that have a profile value", () => {
    const plan = buildFillPlan(PROFILE, [
      field({ id: "af-0", label: "First name" }),
      field({ id: "af-1", label: "Email" }),
      field({ id: "af-2", label: "Are you authorized to work?" }),
      field({ id: "af-3", label: "Portfolio" }),
    ])

    expect(plan.fills).toEqual([
      expect.objectContaining({ fieldId: "af-0", value: "Marisol", approved: false }),
      expect.objectContaining({ fieldId: "af-1", value: "marisol@example.com" }),
      expect.objectContaining({ fieldId: "af-3", value: "https://marisol.dev" }),
    ])
    expect(plan.fills.map((fill) => fill.fieldId)).not.toContain("af-2")
    expect(plan.review).toEqual([
      expect.objectContaining({ fieldId: "af-2", category: "authorization" }),
    ])
  })

  it("splits the last name off the full name for the specific field", () => {
    const plan = buildFillPlan(PROFILE, [field({ label: "Surname" })])
    expect(plan.fills[0].value).toBe("Reyes")
  })

  it("fills an approved answer for a sensitive question and keeps it marked", () => {
    const plan = buildFillPlan(
      PROFILE,
      [field({ id: "af-9", label: "Will you require visa sponsorship?" })],
      { [answerKey("Will you require visa sponsorship?")]: "Yes" },
    )

    expect(plan.review).toHaveLength(0)
    expect(plan.fills[0]).toMatchObject({
      fieldId: "af-9",
      value: "Yes",
      approved: true,
      category: "sponsorship",
    })
  })

  it("puts a safe field with no matching profile fact in review", () => {
    const plan = buildFillPlan({ ...PROFILE, websiteUrl: null }, [
      field({ label: "Portfolio" }),
    ])
    expect(plan.fills).toHaveLength(0)
    expect(plan.review[0].reason).toMatch(/No matching value/)
  })

  it("does not auto-fill a radio choice even with an approved answer", () => {
    const label = "Are you authorized to work?"
    const plan = buildFillPlan(
      PROFILE,
      [field({ id: "af-4", label, type: "radio", tagName: "input" })],
      { [answerKey(label)]: "Yes" },
    )
    expect(plan.fills).toHaveLength(0)
    expect(plan.review[0].reason).toMatch(/cannot safely set/)
    expect(plan.skipped).toBe(1)
  })

  it("marks resume upload fields in review with isResumeUpload: true", () => {
    const plan = buildFillPlan(PROFILE, [
      field({ id: "af-file", label: "Upload Resume / CV", type: "file" }),
    ])
    expect(plan.fills).toHaveLength(0)
    expect(plan.review[0]).toMatchObject({
      fieldId: "af-file",
      category: "document",
      isResumeUpload: true,
    })
  })
})

describe("splitFullName", () => {
  it("keeps a single name as the first name", () => {
    expect(splitFullName("Prince")).toEqual({ first: "Prince", last: "" })
  })

  it("returns empty strings when there is no name", () => {
    expect(splitFullName(null)).toEqual({ first: "", last: "" })
  })
})

describe("ATS host matching", () => {
  it.each([
    "https://boards.greenhouse.io/acme/jobs/1",
    "https://jobs.lever.co/acme/123",
    "https://jobs.ashbyhq.com/acme/123",
    "https://apply.workable.com/acme/j/ABC",
    "https://acme.bamboohr.com/careers/1",
    "https://jobs.smartrecruiters.com/Acme/123",
    "https://acme.wd3.myworkdayjobs.com/External/job/1",
  ])("accepts %s", (url) => {
    expect(isAutofillSupportedUrl(url)).toBe(true)
    expect(autofillHostFor(url)).toBeTruthy()
  })

  it.each([
    "https://example.com/careers",
    "https://greenhouse.io.evil.example/jobs/1",
    "chrome://extensions",
    "",
    null,
  ])("rejects %s", (url) => {
    expect(isAutofillSupportedUrl(url)).toBe(false)
  })
})
