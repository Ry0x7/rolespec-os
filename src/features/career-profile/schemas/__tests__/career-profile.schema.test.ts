// @vitest-environment node
import { describe, it, expect } from "vitest"

import {
  createCapabilitySchema,
  createEvidenceSchema,
  createTargetRoleSchema,
  linkEvidenceCapabilitySchema,
  updateCareerPreferencesSchema,
  updateContactInfoSchema,
} from "../career-profile.schema"

describe("updateContactInfoSchema", () => {
  it("accepts a fully filled contact block", () => {
    const parsed = updateContactInfoSchema.safeParse({
      contactFullName: "  Ada Lovelace  ",
      contactEmail: "ada@example.com",
      contactPhone: "+234 800 000 0000",
      contactLocation: "Lagos, Nigeria",
      linkedinUrl: "https://linkedin.com/in/ada",
      githubUrl: "https://github.com/ada",
      websiteUrl: "https://ada.example.com",
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.contactFullName).toBe("Ada Lovelace")
  })

  it("accepts an entirely empty submission", () => {
    const parsed = updateContactInfoSchema.safeParse({
      contactFullName: "",
      contactEmail: "",
      contactPhone: "",
      contactLocation: "",
      linkedinUrl: "",
      githubUrl: "",
      websiteUrl: "",
    })

    expect(parsed.success).toBe(true)
  })

  it("treats a whitespace-only field as blank rather than malformed", () => {
    const parsed = updateContactInfoSchema.safeParse({
      contactEmail: "   ",
      linkedinUrl: "  ",
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.contactEmail).toBe("")
  })

  it("rejects an email that is not an email", () => {
    expect(updateContactInfoSchema.safeParse({ contactEmail: "ada@" }).success).toBe(false)
    expect(
      updateContactInfoSchema.safeParse({ contactEmail: "not an email" }).success
    ).toBe(false)
  })

  it("rejects a URL field that is not a URL", () => {
    for (const field of ["linkedinUrl", "githubUrl", "websiteUrl"]) {
      const parsed = updateContactInfoSchema.safeParse({ [field]: "linkedin.com/in/ada" })
      expect(parsed.success, field).toBe(false)
    }
  })

  it("offers no way to reassign the row from the request", () => {
    const parsed = updateContactInfoSchema.safeParse({
      contactEmail: "ada@example.com",
      userId: "someone-else",
      id: "someone-elses-profile",
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).not.toHaveProperty("userId")
    expect(parsed.success && parsed.data).not.toHaveProperty("id")
  })
})

describe("createEvidenceSchema", () => {
  it("accepts every required evidence category", () => {
    for (const kind of [
      "EXPERIENCE",
      "ACHIEVEMENT",
      "PROJECT",
      "EDUCATION",
      "CERTIFICATION",
    ]) {
      const parsed = createEvidenceSchema.safeParse({ kind, title: "Thing" })
      expect(parsed.success, kind).toBe(true)
    }
  })

  it("rejects an unknown kind", () => {
    expect(createEvidenceSchema.safeParse({ kind: "SKILL", title: "Thing" }).success).toBe(
      false
    )
  })

  it("requires a title", () => {
    expect(
      createEvidenceSchema.safeParse({ kind: "PROJECT", title: "   " }).success
    ).toBe(false)
  })

  it("offers no way to set provenance from the request", () => {
    const parsed = createEvidenceSchema.safeParse({
      kind: "PROJECT",
      title: "Thing",
      source: "USER_ENTERED",
      status: "CONFIRMED",
      confirmedAt: new Date().toISOString(),
      careerProfileId: "someone-else",
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).not.toHaveProperty("source")
    expect(parsed.success && parsed.data).not.toHaveProperty("status")
    expect(parsed.success && parsed.data).not.toHaveProperty("confirmedAt")
    expect(parsed.success && parsed.data).not.toHaveProperty("careerProfileId")
  })
})

describe("date validation", () => {
  const IMPOSSIBLE = [
    "2026-02-31", // February never has 31 days
    "2026-02-30",
    "2025-02-29", // 2025 is not a leap year
    "2026-04-31",
    "2026-13-01", // month out of range
    "2026-00-10",
    "2026-01-32",
    "2026-01-00",
  ]

  const MALFORMED = [
    "31-02-2026",
    "2026/02/28",
    "2026-2-8",
    "2026-02-28T00:00:00Z",
    "not a date",
    "0",
  ]

  it.each(IMPOSSIBLE)("rejects the impossible date %s on startDate", (value) => {
    const parsed = createEvidenceSchema.safeParse({
      kind: "EXPERIENCE",
      title: "Thing",
      startDate: value,
    })

    expect(parsed.success).toBe(false)
  })

  it.each(IMPOSSIBLE)("rejects the impossible date %s on endDate", (value) => {
    expect(
      createEvidenceSchema.safeParse({
        kind: "EXPERIENCE",
        title: "Thing",
        endDate: value,
      }).success
    ).toBe(false)
  })

  it.each(IMPOSSIBLE)("rejects the impossible date %s on lastUsedAt", (value) => {
    expect(
      linkEvidenceCapabilitySchema.safeParse({
        evidenceId: "e1",
        capabilityId: "c1",
        lastUsedAt: value,
      }).success
    ).toBe(false)
  })

  it.each(MALFORMED)("rejects the malformed date %o", (value) => {
    expect(
      createEvidenceSchema.safeParse({ kind: "PROJECT", title: "T", startDate: value })
        .success
    ).toBe(false)
    expect(
      linkEvidenceCapabilitySchema.safeParse({
        evidenceId: "e1",
        capabilityId: "c1",
        lastUsedAt: value,
      }).success
    ).toBe(false)
  })

  it("never silently normalizes a rolled-over date", () => {
    const parsed = createEvidenceSchema.safeParse({
      kind: "PROJECT",
      title: "T",
      startDate: "2026-02-31",
    })

    expect(parsed.success).toBe(false)
    // The failure has to name the date field, not some unrelated one.
    expect(parsed.success === false && parsed.error.issues[0].path).toEqual(["startDate"])
    expect(parsed.success === false && parsed.error.issues[0].message).toBe(
      "That date does not exist"
    )
  })

  it.each(["2026-02-28", "2024-02-29", "1999-12-31", "2026-01-01"])(
    "accepts the real date %s",
    (value) => {
      expect(
        createEvidenceSchema.safeParse({ kind: "PROJECT", title: "T", startDate: value })
          .success
      ).toBe(true)
      expect(
        linkEvidenceCapabilitySchema.safeParse({
          evidenceId: "e1",
          capabilityId: "c1",
          lastUsedAt: value,
        }).success
      ).toBe(true)
    }
  )

  it("treats a cleared date field as absent", () => {
    const evidence = createEvidenceSchema.safeParse({
      kind: "PROJECT",
      title: "T",
      startDate: "",
      endDate: "",
    })
    expect(evidence.success && evidence.data.startDate).toBe("")

    const link = linkEvidenceCapabilitySchema.safeParse({
      evidenceId: "e1",
      capabilityId: "c1",
      lastUsedAt: "",
    })
    expect(link.success && link.data.lastUsedAt).toBe("")
  })
})

describe("createCapabilitySchema", () => {
  it("treats self-assessment as optional and clearable", () => {
    const blank = createCapabilitySchema.safeParse({ name: "React", selfAssessment: "" })
    expect(blank.success && blank.data.selfAssessment).toBe("")

    const set = createCapabilitySchema.safeParse({ name: "React", selfAssessment: "STRONG" })
    expect(set.success && set.data.selfAssessment).toBe("STRONG")
  })

  it("rejects an invented self-assessment level", () => {
    expect(
      createCapabilitySchema.safeParse({ name: "React", selfAssessment: "GODLIKE" }).success
    ).toBe(false)
  })

  it("exposes no confirmation or score field", () => {
    const parsed = createCapabilitySchema.safeParse({
      name: "React",
      confirmed: "true",
      strengthScore: 99,
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).not.toHaveProperty("confirmed")
    expect(parsed.success && parsed.data).not.toHaveProperty("strengthScore")
  })
})

describe("linkEvidenceCapabilitySchema", () => {
  it("defaults depth to WORKING and coerces the outcome checkbox", () => {
    const parsed = linkEvidenceCapabilitySchema.safeParse({
      evidenceId: "e1",
      capabilityId: "c1",
    })

    expect(parsed.success && parsed.data.depth).toBe("WORKING")
    // Absent means "not stated"; the action is what turns that into `false`.
    expect(parsed.success && parsed.data.hasMeasuredOutcome).toBeUndefined()

    const checked = linkEvidenceCapabilitySchema.safeParse({
      evidenceId: "e1",
      capabilityId: "c1",
      hasMeasuredOutcome: "on",
    })
    expect(checked.success && checked.data.hasMeasuredOutcome).toBe(true)
  })

  it("requires both sides of the relationship", () => {
    expect(
      linkEvidenceCapabilitySchema.safeParse({ evidenceId: "", capabilityId: "c1" }).success
    ).toBe(false)
    expect(
      linkEvidenceCapabilitySchema.safeParse({ evidenceId: "e1", capabilityId: "" }).success
    ).toBe(false)
  })
})

describe("createTargetRoleSchema", () => {
  it("trims the title and defaults an absent priority", () => {
    const parsed = createTargetRoleSchema.safeParse({ title: "  Senior FE  ", priority: "" })
    expect(parsed.success && parsed.data.title).toBe("Senior FE")
    expect(parsed.success && parsed.data.priority).toBeUndefined()
  })
})

describe("updateCareerPreferencesSchema", () => {
  it("keeps sponsorship tri-state", () => {
    for (const [input, expected] of [
      ["", ""],
      ["yes", "yes"],
      ["no", "no"],
    ] as const) {
      const parsed = updateCareerPreferencesSchema.safeParse({
        requiresSponsorship: input,
      })
      expect(parsed.success && parsed.data.requiresSponsorship).toBe(expected)
    }

    expect(
      updateCareerPreferencesSchema.safeParse({ requiresSponsorship: "maybe" }).success
    ).toBe(false)
  })

  it("rejects a work mode outside the shared WorkType enum", () => {
    expect(
      updateCareerPreferencesSchema.safeParse({ workModes: ["REMOTE", "MOON"] }).success
    ).toBe(false)
  })

  it("accepts no evidence or capability fields", () => {
    const parsed = updateCareerPreferencesSchema.safeParse({
      careerGoals: "Staff engineer",
      evidence: "[]",
      capabilities: "[]",
      jobDescription: "We need 10 years of React",
    })

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).not.toHaveProperty("evidence")
    expect(parsed.success && parsed.data).not.toHaveProperty("capabilities")
    expect(parsed.success && parsed.data).not.toHaveProperty("jobDescription")
  })
})
