import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/shared/lib/ai-generate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/ai-generate")>()),
  generateObjectTracked: vi.fn(),
}))

import { generateObjectTracked } from "@/shared/lib/ai-generate"
import {
  generateATSEnhanceSuggestions,
  atsEnhanceSuggestionsSchema,
  MAX_ENHANCE_SUGGESTIONS,
  MAX_SUMMARY_LENGTH,
  MAX_BULLET_LENGTH,
  MAX_SKILLS_LENGTH,
  type ATSEnhanceInput,
  type ATSFindingIssue,
  type ATSFindingSuggestion,
  type ATSEnhanceScores,
  ATS_TARGET_SCORE,
} from "../enhance-ats"
import { ATS_SCORE_WEIGHTS } from "../ats-analyze"

const mockedGenerateObject = vi.mocked(generateObjectTracked)

/** What the provider returns: every key present, nulls instead of omissions. */
type WireSuggestions = z.infer<typeof atsEnhanceSuggestionsSchema>

function mockObject(object: WireSuggestions) {
  mockedGenerateObject.mockResolvedValue({ object } as never)
}

function lastCallArgs() {
  return mockedGenerateObject.mock.calls[0][0] as unknown as {
    prompt: string
    system: string
    schema: unknown
    tracking: { feature: string; surface: string; userId: string }
  }
}

function input(overrides: Partial<ATSEnhanceInput> = {}): ATSEnhanceInput {
  return {
    userId: "user-1",
    targets: [{ targetId: "t1", field: "bullet", text: "Worked on checkout" }],
    issues: [],
    suggestions: [],
    ...overrides,
  }
}

const issue = (overrides: Partial<ATSFindingIssue> = {}): ATSFindingIssue => ({
  severity: "critical",
  category: "keywords",
  message: "Missing core keywords",
  ...overrides,
})

const suggestion = (overrides: Partial<ATSFindingSuggestion> = {}): ATSFindingSuggestion => ({
  category: "impact",
  title: "Quantify results",
  description: "Add measurable outcomes to bullets.",
  priority: "high",
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockObject({ suggestions: [] })
})

describe("atsEnhanceSuggestionsSchema", () => {
  const entry = {
    targetId: "t1",
    action: "rewrite" as const,
    suggested: "Rebuilt checkout",
    reason: "Adds keyword",
  }

  it("accepts up to the maximum number of complete suggestions", () => {
    expect(atsEnhanceSuggestionsSchema.safeParse({ suggestions: [] }).success).toBe(true)
    expect(
      atsEnhanceSuggestionsSchema.safeParse({
        suggestions: Array.from({ length: MAX_ENHANCE_SUGGESTIONS }, () => entry),
      }).success
    ).toBe(true)
  })

  it("rejects more than the maximum and rejects empty strings", () => {
    expect(
      atsEnhanceSuggestionsSchema.safeParse({
        suggestions: Array.from({ length: MAX_ENHANCE_SUGGESTIONS + 1 }, () => entry),
      }).success
    ).toBe(false)
    expect(
      atsEnhanceSuggestionsSchema.safeParse({
        suggestions: [{ ...entry, targetId: "" }],
      }).success
    ).toBe(false)
    expect(
      atsEnhanceSuggestionsSchema.safeParse({
        suggestions: [{ ...entry, reason: "" }],
      }).success
    ).toBe(false)
  })

  it("emits a JSON Schema whose `required` lists every suggestion key", () => {
    // OpenAI's strict structured outputs reject a schema that leaves any
    // property out of `required` — which is exactly what `.optional()` and
    // `.default()` do. Every field must therefore be nullable, not optional.
    const jsonSchema = z.toJSONSchema(atsEnhanceSuggestionsSchema) as unknown as {
      properties: {
        suggestions: {
          items: { properties: Record<string, unknown>; required: string[] }
        }
      }
    }
    const item = jsonSchema.properties.suggestions.items

    expect(item.required.slice().sort()).toEqual(Object.keys(item.properties).sort())
    expect(item.required.slice().sort()).toEqual([
      "action",
      "reason",
      "suggested",
      "targetId",
    ])
  })

  it("accepts a null action and a null suggested", () => {
    const parsed = atsEnhanceSuggestionsSchema.safeParse({
      suggestions: [
        {
          targetId: "sec-1::item-1::b0",
          action: null,
          suggested: null,
          reason: "Unrelated to the target role",
        },
      ],
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.suggestions[0].action).toBeNull()
    expect(parsed.data.suggestions[0].suggested).toBeNull()
  })

  it("accepts a removal with a null suggested", () => {
    const parsed = atsEnhanceSuggestionsSchema.safeParse({
      suggestions: [
        {
          targetId: "sec-1::item-1::b0",
          action: "remove",
          suggested: null,
          reason: "Unrelated to the target role",
        },
      ],
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.suggestions[0].action).toBe("remove")
    expect(parsed.data.suggestions[0].suggested).toBeNull()
  })

  it("rejects an action outside the enum", () => {
    expect(
      atsEnhanceSuggestionsSchema.safeParse({
        suggestions: [{ ...entry, action: "delete-section" }],
      }).success
    ).toBe(false)
  })

  it("tolerates an empty suggested string — the action enforces rewrite text, not the schema", () => {
    expect(
      atsEnhanceSuggestionsSchema.safeParse({
        suggestions: [{ ...entry, suggested: "" }],
      }).success
    ).toBe(true)
  })
})

describe("generateATSEnhanceSuggestions prompt assembly", () => {
  it("passes the output schema and tracks the call against the user", async () => {
    await generateATSEnhanceSuggestions(input())

    const args = lastCallArgs()
    expect(args.schema).toBe(atsEnhanceSuggestionsSchema)
    expect(args.tracking).toEqual({
      feature: "resume.enhance",
      surface: "app",
      userId: "user-1",
    })
  })

  it("includes every target id, field, label and text", async () => {
    await generateATSEnhanceSuggestions(
      input({
        targets: [
          {
            targetId: "exp-0-bullet-1",
            field: "bullet",
            text: "Worked on checkout",
            label: "Experience — Acme / Senior Engineer",
          },
          { targetId: "summary", field: "summary", text: "Engineer with experience." },
        ],
      })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain(
      'Enhanceable resume text. Each entry is "<targetId> | <field> | <label>" followed by its current text:'
    )
    expect(prompt).toContain(
      "exp-0-bullet-1 | bullet | Experience — Acme / Senior Engineer\nWorked on checkout"
    )
    expect(prompt).toContain("summary | summary | —\nEngineer with experience.")
  })

  it("includes the target role and company when supplied", async () => {
    await generateATSEnhanceSuggestions(
      input({ targetRole: "Backend Engineer", targetCompany: "Acme" })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("Target role: Backend Engineer")
    expect(prompt).toContain("Target company: Acme")
  })

  it("omits the role and company lines when absent", async () => {
    await generateATSEnhanceSuggestions(input())

    const { prompt } = lastCallArgs()
    expect(prompt).not.toContain("Target role:")
    expect(prompt).not.toContain("Target company:")
  })

  it("includes the job description under its tailoring header", async () => {
    await generateATSEnhanceSuggestions(
      input({ jobDescription: "  We need Kubernetes and Terraform depth.  " })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("Target job description")
    expect(prompt).toContain("tailor the wording toward the requirements")
    expect(prompt).toContain("We need Kubernetes and Terraform depth.")
  })

  it("trims then caps the job description at 1500 characters", async () => {
    await generateATSEnhanceSuggestions(input({ jobDescription: `  ${"z".repeat(2000)}  ` }))

    const { prompt } = lastCallArgs()
    expect((prompt.match(/z/g) ?? []).length).toBe(1500)
  })

  it("omits the job description block when blank", async () => {
    await generateATSEnhanceSuggestions(input({ jobDescription: "   " }))

    expect(lastCallArgs().prompt).not.toContain("Target job description")
  })

  it("renders ATS issues with severity, category, section, message and fix", async () => {
    await generateATSEnhanceSuggestions(
      input({
        issues: [
          issue({
            severity: "warning",
            category: "impact",
            section: "experience",
            message: "Bullets lack measurable outcomes",
            suggestion: "Add metrics",
          }),
          issue({ severity: "info", category: "format", message: "Dates are inconsistent" }),
        ],
      })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("ATS issues found on this resume:")
    expect(prompt).toContain(
      "- [warning/impact @ experience] Bullets lack measurable outcomes (fix: Add metrics)"
    )
    expect(prompt).toContain("- [info/format] Dates are inconsistent")
  })

  it("caps ATS issues at 12 entries", async () => {
    await generateATSEnhanceSuggestions(
      input({
        issues: Array.from({ length: 15 }, (_, i) => issue({ message: `issue-${i}` })),
      })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("issue-11")
    expect(prompt).not.toContain("issue-12")
  })

  it("renders ATS improvement suggestions with priority, category, title and description", async () => {
    await generateATSEnhanceSuggestions(
      input({
        suggestions: [
          suggestion({
            priority: "medium",
            category: "readability",
            title: "Shorten bullets",
            description: "Keep bullets to one line.",
          }),
        ],
      })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("ATS improvement suggestions:")
    expect(prompt).toContain(
      "- [medium/readability] Shorten bullets: Keep bullets to one line."
    )
  })

  it("caps ATS improvement suggestions at 12 entries", async () => {
    await generateATSEnhanceSuggestions(
      input({
        suggestions: Array.from({ length: 15 }, (_, i) =>
          suggestion({ title: `sugg-${i}` })
        ),
      })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("sugg-11")
    expect(prompt).not.toContain("sugg-12")
  })

  it("splits grounded keywords into supported, needs-confirmation and do-not-claim", async () => {
    await generateATSEnhanceSuggestions(
      input({
        groundedKeywords: {
          supported: ["Kubernetes", "  Terraform  ", "", "   "],
          ambiguous: ["Java EE"],
          unsupported: ["JPQL", "JMS"],
          details: [],
        },
      })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("SUPPORTED")
    expect(prompt).toContain("- Kubernetes")
    expect(prompt).toContain("- Terraform")
    expect(prompt).toContain("NEEDS CONFIRMATION")
    expect(prompt).toContain("- Java EE")
    expect(prompt).toContain("DO NOT CLAIM")
    expect(prompt).toContain("- JPQL")
    expect(prompt).toContain("- JMS")
  })

  it("never presents an unsupported keyword as something to work in", async () => {
    await generateATSEnhanceSuggestions(
      input({
        groundedKeywords: {
          supported: [],
          ambiguous: [],
          unsupported: ["JPQL"],
          details: [],
        },
      })
    )

    const { prompt } = lastCallArgs()
    const doNotClaim = prompt.slice(prompt.indexOf("DO NOT CLAIM"))
    expect(doNotClaim).toContain("- JPQL")
    expect(prompt).not.toContain("SUPPORTED (")
  })

  it("caps each grounded list at 20 entries and 60 characters per keyword", async () => {
    await generateATSEnhanceSuggestions(
      input({
        groundedKeywords: {
          supported: [
            ...Array.from({ length: 21 }, (_, i) => `kw${i}`),
            "y".repeat(100),
          ],
          ambiguous: [],
          unsupported: [],
          details: [],
        },
      })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("- kw19")
    expect(prompt).not.toContain("- kw20")
    expect(prompt).not.toContain("y".repeat(61))
  })

  it("caps a long keyword at 60 characters when it survives the entry cap", async () => {
    await generateATSEnhanceSuggestions(
      input({
        groundedKeywords: {
          supported: ["y".repeat(100)],
          ambiguous: [],
          unsupported: [],
          details: [],
        },
      })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain(`- ${"y".repeat(60)}`)
    expect(prompt).not.toContain("y".repeat(61))
  })

  it("omits the keyword block when every list is empty or only blanks", async () => {
    await generateATSEnhanceSuggestions(
      input({
        groundedKeywords: {
          supported: ["", "  "],
          ambiguous: [],
          unsupported: [],
          details: [],
        },
      })
    )

    expect(lastCallArgs().prompt).not.toContain("DO NOT CLAIM")
    expect(lastCallArgs().prompt).not.toContain("SUPPORTED")
  })
})

describe("generateATSEnhanceSuggestions score awareness", () => {
  const scores: ATSEnhanceScores = {
    formatting: 80,
    keywords: 42,
    impact: 55,
    completeness: 90,
    readability: 70,
  }

  it("states the overall score, every category score and the real weights", async () => {
    await generateATSEnhanceSuggestions(input({ overallScore: 63, scores }))

    const { prompt } = lastCallArgs()
    expect(prompt).toContain(
      "Current ATS score for this resume — the rewrites are graded against it:"
    )
    expect(prompt).toContain("- Overall: 63/100")
    expect(prompt).toContain("- keywords: 42/100 (weight 30%)")
    expect(prompt).toContain("- impact: 55/100 (weight 30%)")
    expect(prompt).toContain("- formatting: 80/100 (weight 20%)")
    expect(prompt).toContain("- completeness: 90/100 (weight 10%)")
    expect(prompt).toContain("- readability: 70/100 (weight 10%)")
  })

  it("keeps the rendered weights in step with ATS_SCORE_WEIGHTS", async () => {
    await generateATSEnhanceSuggestions(input({ overallScore: 63, scores }))

    const { prompt } = lastCallArgs()
    for (const [category, weight] of Object.entries(ATS_SCORE_WEIGHTS)) {
      const value = scores[category as keyof ATSEnhanceScores]
      expect(prompt).toContain(
        `- ${category}: ${value}/100 (weight ${Math.round(weight * 100)}%)`
      )
    }
  })

  it("tells the model to prioritise weak heavy categories without breaking grounding", async () => {
    await generateATSEnhanceSuggestions(input({ overallScore: 63, scores }))

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("weakest categories that carry the heaviest weights")
    expect(prompt).toContain(`overall score to ${ATS_TARGET_SCORE}+`)
    expect(prompt).toContain("never invent numbers, metrics or facts")
    expect(prompt).toContain("Grounding outranks the score")
  })

  it("renders the category lines without an overall line when only scores are given", async () => {
    await generateATSEnhanceSuggestions(input({ scores }))

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("- keywords: 42/100 (weight 30%)")
    expect(prompt).not.toContain("- Overall:")
  })

  it("omits the whole score section when no scores are supplied", async () => {
    await generateATSEnhanceSuggestions(input({ overallScore: 63 }))

    const { prompt } = lastCallArgs()
    expect(prompt).not.toContain("Current ATS score for this resume")
    expect(prompt).not.toContain("weight 30%")
    expect(prompt).not.toContain("- Overall:")
  })
})

describe("generateATSEnhanceSuggestions system prompt", () => {
  it("states the grounding rules and the length limits", async () => {
    await generateATSEnhanceSuggestions(input())

    const { system } = lastCallArgs()
    expect(system).toContain("GROUNDING — THIS IS THE MOST IMPORTANT RULE")
    expect(system).toContain("NEVER invent specific numbers")
    expect(system).toContain(`Return AT MOST ${MAX_ENHANCE_SUGGESTIONS} suggestions`)
    expect(system).toContain("Do NOT invent target ids")
    expect(system).toContain(`at most ${MAX_SUMMARY_LENGTH} characters`)
    expect(system).toContain(`at most ${MAX_BULLET_LENGTH} characters`)
    expect(system).toContain('"targetId"')
  })

  it("asks for Action–Result–Reason bullets without loosening the grounding rule", async () => {
    await generateATSEnhanceSuggestions(input())

    const { system } = lastCallArgs()
    expect(system).toContain("Action–Result–Reason")
    expect(system).toContain(
      "state the Result qualitatively when the source gives no figure; never invent numbers for it"
    )
    expect(system).toContain("drop the Reason (why-it-mattered) clause")
    expect(system).toContain(
      "SUMMARY AND SKILLS TARGETS are NOT bullets: do not apply the Action–Result–Reason framework to them."
    )
  })

  it("allows bullet removals and fences them with guardrails", async () => {
    await generateATSEnhanceSuggestions(input())

    const { system } = lastCallArgs()
    expect(system).toContain('"action": "rewrite" | "remove"')
    expect(system).toContain("the rewritten text, or null when action is remove")
    expect(system).toContain("Set `suggested` to null for a removal")
    expect(system).toContain("ONLY for bullet targets")
    expect(system).toContain("REMOVAL GUARDRAILS:")
    expect(system).toContain(
      "never propose removing a bullet that carries a keyword from the job description"
    )
    expect(system).toContain("fewer than 2 bullets")
    expect(system).toContain("must not regress ATS completeness")
    expect(system).toContain("Prefer a rewrite over a removal")
    expect(system).toContain("removal applies to bullets only")
  })

  it("tells the model how to rewrite a skills list", async () => {
    await generateATSEnhanceSuggestions(input())

    const { system } = lastCallArgs()
    expect(system).toContain("SKILLS TARGETS:")
    expect(system).toContain("SAME comma-separated list")
    expect(system).toContain("with relevant keywords from the SUPPORTED list appended")
    expect(system).toContain("NEVER remove or rename an existing skill")
    expect(system).toContain(`at most ${MAX_SKILLS_LENGTH} characters`)
  })
})

describe("generateATSEnhanceSuggestions skills targets", () => {
  it("renders a skills target in the targets block with its field and label", async () => {
    await generateATSEnhanceSuggestions(
      input({
        targets: [
          {
            targetId: "sec-2::item-2::skills",
            field: "skills",
            text: "TypeScript, Go",
            label: "Skills — Languages",
          },
        ],
      })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain(
      "sec-2::item-2::skills | skills | Skills — Languages\nTypeScript, Go"
    )
  })
})

describe("generateATSEnhanceSuggestions result handling", () => {
  it("returns the validated object unchanged, including no-op suggestions", async () => {
    const object: WireSuggestions = {
      suggestions: [
        {
          targetId: "t1",
          action: "rewrite",
          suggested: "  Rebuilt the checkout service  ",
          reason: "Adds keyword",
        },
        {
          targetId: "unknown-id",
          action: "rewrite",
          suggested: "Worked on checkout",
          reason: "Identical text",
        },
      ],
    }
    mockObject(object)

    const result = await generateATSEnhanceSuggestions(input())

    expect(result).toEqual(object)
    expect(result.suggestions).toHaveLength(2)
  })

  it("normalises the wire nulls: a null action is a rewrite, a null suggested is absent", async () => {
    mockObject({
      suggestions: [
        {
          targetId: "t1",
          action: null,
          suggested: "Rebuilt the checkout service",
          reason: "Adds keyword",
        },
        {
          targetId: "sec-1::item-1::b0",
          action: "remove",
          suggested: null,
          reason: "Unrelated to the target role",
        },
      ],
    })

    const result = await generateATSEnhanceSuggestions(input())

    expect(result.suggestions[0]).toEqual({
      targetId: "t1",
      action: "rewrite",
      suggested: "Rebuilt the checkout service",
      reason: "Adds keyword",
    })
    expect(result.suggestions[1]).toEqual({
      targetId: "sec-1::item-1::b0",
      action: "remove",
      reason: "Unrelated to the target role",
    })
    expect("suggested" in result.suggestions[1]).toBe(false)
  })

  it("returns an empty suggestion list untouched", async () => {
    mockObject({ suggestions: [] })

    const result = await generateATSEnhanceSuggestions(input())

    expect(result.suggestions).toEqual([])
  })

  it("propagates a generateObject rejection", async () => {
    mockedGenerateObject.mockRejectedValue(new Error("model exploded"))

    await expect(generateATSEnhanceSuggestions(input())).rejects.toThrow("model exploded")
  })
})

describe("generateATSEnhanceSuggestions edge cases", () => {
  it("still calls the model with only the targets block when the ATS payload is empty", async () => {
    await generateATSEnhanceSuggestions(input())

    const { prompt } = lastCallArgs()
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1)
    expect(prompt).not.toContain("ATS issues found on this resume")
    expect(prompt).not.toContain("ATS improvement suggestions")
    expect(prompt).not.toContain("ATS keywords missing from this resume")
    expect(prompt.startsWith("Enhanceable resume text.")).toBe(true)
  })

  it("still calls the model with an empty targets list", async () => {
    const result = await generateATSEnhanceSuggestions(
      input({ targets: [], issues: [issue()] })
    )

    const { prompt } = lastCallArgs()
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1)
    expect(prompt).toContain("ATS issues found on this resume:")
    // With no targets the section is still present, as an empty fence.
    expect(prompt).toContain("followed by its current text:")
    expect(prompt.trimEnd().endsWith("<<<END_EXTERNAL_DATA RESUME_TARGETS>>>")).toBe(
      true
    )
    expect(result.suggestions).toEqual([])
  })
})

describe("generateATSEnhanceSuggestions focus", () => {
  const sections = [
    { id: "sum", title: "Summary", type: "SUMMARY" as const },
    { id: "exp", title: "Work Experience", type: "EXPERIENCE" as const },
    { id: "edu", title: "Education", type: "EDUCATION" as const },
  ]
  const targets: ATSEnhanceInput["targets"] = [
    { targetId: "sum::i0::summary", field: "summary", text: "Summary text here" },
    { targetId: "exp::i1::b0", field: "bullet", text: "Experience bullet here" },
  ]

  beforeEach(() => {
    mockObject({ suggestions: [] })
  })

  it("keeps only the focused section's targets and issues in the prompt", async () => {
    await generateATSEnhanceSuggestions(
      input({
        targets,
        sections,
        focus: { sectionId: "exp" },
        issues: [
          issue({ message: "Summary is vague", section: "Summary" }),
          issue({ message: "Bullets lack outcomes", section: "Work Experience" }),
        ],
      })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("exp::i1::b0")
    expect(prompt).not.toContain("sum::i0::summary")
    expect(prompt).toContain("Bullets lack outcomes")
    expect(prompt).not.toContain("Summary is vague")
  })

  it("falls back to every issue when none match the focused section", async () => {
    await generateATSEnhanceSuggestions(
      input({
        targets,
        sections,
        focus: { sectionId: "sum" },
        issues: [
          issue({ message: "Bullets lack outcomes", section: "Work Experience" }),
          issue({ message: "Overall too long" }),
        ],
      })
    )

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("sum::i0::summary")
    expect(prompt).not.toContain("exp::i1::b0")
    expect(prompt).toContain("Bullets lack outcomes")
    expect(prompt).toContain("Overall too long")
  })

  it("rejects a section id that is blank or not in the resume, without calling the model", async () => {
    await expect(
      generateATSEnhanceSuggestions(input({ targets, sections, focus: { sectionId: "nope" } }))
    ).rejects.toThrow()
    await expect(
      generateATSEnhanceSuggestions(input({ targets, sections, focus: { sectionId: "  " } }))
    ).rejects.toThrow()
    await expect(
      generateATSEnhanceSuggestions(input({ targets, focus: { sectionId: "exp" } }))
    ).rejects.toThrow()
    expect(mockedGenerateObject).not.toHaveBeenCalled()
  })

  it("matches the focus by section id, not by title", async () => {
    // A section titled like another section's id must not be mistaken for it.
    await expect(
      generateATSEnhanceSuggestions(
        input({ targets, sections, focus: { sectionId: "Work Experience" } })
      )
    ).rejects.toThrow()
  })
})
