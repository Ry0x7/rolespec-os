import { describe, expect, it } from "vitest"

import {
  buildAtsFieldPlan,
  classifyAtsField,
  type AtsApprovedAnswer,
  type AtsFieldInput,
} from "../lib/field-classifier"

function field(overrides: Partial<AtsFieldInput> = {}): AtsFieldInput {
  return {
    fieldId: "af-0",
    label: "First name",
    tagName: "input",
    type: "text",
    ...overrides,
  }
}

const PROFILE = {
  fullName: "Marisol Reyes",
  email: "marisol@example.com",
  phone: "+63 917 555 0100",
  location: "Manila, Philippines",
  linkedinUrl: "https://linkedin.com/in/marisol",
  githubUrl: "https://github.com/marisol",
  websiteUrl: "https://marisol.dev",
  currentRole: "Registered Nurse",
}

function answer(overrides: Partial<AtsApprovedAnswer> = {}): AtsApprovedAnswer {
  return {
    id: "answer-1",
    questionKey: "will you require visa sponsorship",
    value: "No",
    scope: "APPLICATION",
    category: "sponsorship",
    ...overrides,
  }
}

describe("classifyAtsField", () => {
  it("classifies by meaning, not HTML type alone", () => {
    expect(classifyAtsField(field({ label: "Email address" }))).toMatchObject({
      category: "contact",
      sensitivity: "safe",
      profileKey: "email",
    })
    expect(classifyAtsField(field({ label: "Company name" }))).toMatchObject({
      category: "work",
      sensitivity: "unknown",
    })
    expect(
      classifyAtsField(
        field({
          label: "Are you authorized to work in the United States?",
          type: "text",
        })
      )
    ).toMatchObject({ category: "authorization", sensitivity: "sensitive" })
    expect(classifyAtsField(field({ label: "Gender", tagName: "select" }))).toMatchObject({
      category: "demographic",
      sensitivity: "sensitive",
    })
    expect(classifyAtsField(field({ label: "Resume", type: "file" }))).toMatchObject({
      category: "document",
      sensitivity: "sensitive",
    })
    expect(
      classifyAtsField(field({ label: "Why do you want this role?", tagName: "textarea" }))
    ).toMatchObject({ category: "essay", sensitivity: "sensitive" })
  })

  it("keeps a plain choice control unknown even when its label looks safe", () => {
    expect(
      classifyAtsField(
        field({
          label: "Current location",
          tagName: "select",
        })
      )
    ).toMatchObject({ category: "unknown", sensitivity: "unknown" })
  })
})

describe("buildAtsFieldPlan", () => {
  it("fills only safe factual fields and puts everything else in review", () => {
    const plan = buildAtsFieldPlan({
      profile: PROFILE,
      answers: [],
      fields: [
        field({ fieldId: "a", label: "First name" }),
        field({ fieldId: "b", label: "Email" }),
        field({ fieldId: "c", label: "Are you authorized to work?" }),
        field({ fieldId: "d", label: "Resume", type: "file" }),
        field({ fieldId: "e", label: "Why this company?", tagName: "textarea" }),
        field({ fieldId: "f", label: "Gender", tagName: "select" }),
      ],
    })

    expect(plan.fields.filter((entry) => entry.decision === "FILL")).toHaveLength(2)
    expect(plan.fields.find((entry) => entry.fieldId === "a")?.decision).toBe("FILL")
    expect(plan.fields.find((entry) => entry.fieldId === "b")?.decision).toBe("FILL")
    expect(plan.fields.find((entry) => entry.fieldId === "c")?.decision).toBe("REVIEW")
    expect(plan.fields.find((entry) => entry.fieldId === "d")?.decision).toBe("ATTACH_RESUME")
    expect(plan.fields.find((entry) => entry.fieldId === "e")?.decision).toBe("REVIEW")
    expect(plan.fields.find((entry) => entry.fieldId === "f")?.decision).toBe("REVIEW")
  })

  it("never puts a value in the stored plan", () => {
    const plan = buildAtsFieldPlan({
      profile: PROFILE,
      answers: [answer()],
      fields: [field({ label: "Email" })],
    })
    const serialized = JSON.stringify(plan)
    expect(serialized).not.toContain("marisol@example.com")
    expect(serialized).not.toContain('"value"')
  })

  it("fills an application-approved sensitive answer", () => {
    const plan = buildAtsFieldPlan({
      profile: PROFILE,
      answers: [
        answer({
          questionKey: "will you require visa sponsorship",
          scope: "APPLICATION",
        }),
      ],
      fields: [field({ label: "Will you require visa sponsorship?" })],
    })

    expect(plan.fields[0]).toMatchObject({
      decision: "FILL",
      answerId: "answer-1",
      category: "sponsorship",
    })
  })

  it("does not auto-fill a browser-wide sensitive answer on a new application", () => {
    const plan = buildAtsFieldPlan({
      profile: PROFILE,
      answers: [
        answer({
          questionKey: "will you require visa sponsorship",
          scope: "GLOBAL",
        }),
      ],
      fields: [field({ label: "Will you require visa sponsorship?" })],
    })

    expect(plan.fields[0]).toMatchObject({
      decision: "REVIEW",
      answerId: "answer-1",
      category: "sponsorship",
    })
    expect(plan.fields[0].reason).toContain("needs approval for this application")
    expect(plan.fillCount).toBe(0)
  })

  it("never writes a select, radio or checkbox even with an application answer", () => {
    const plan = buildAtsFieldPlan({
      profile: PROFILE,
      answers: [answer({ questionKey: "current location", value: "Manila" })],
      fields: [
        field({ fieldId: "select", label: "Current location", tagName: "select" }),
        field({ fieldId: "radio", label: "Will you require visa sponsorship?", type: "radio" }),
      ],
    })

    expect(plan.fields.filter((entry) => entry.decision === "FILL")).toHaveLength(0)
  })
})
