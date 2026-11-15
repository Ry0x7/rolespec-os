// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/shared/lib/ai-generate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/ai-generate")>()),
  generateObjectTracked: vi.fn(),
}))

import { generateObjectTracked } from "@/shared/lib/ai-generate"
import { AiDailyLimitError, AiKeyRequiredError } from "@/shared/lib/ai-provider"
import {
  optimizeResume,
  optimizedContentSchema,
  optimizedSectionsSchema,
} from "../optimize-resume"
import type { Section } from "../../types"

const mockedGenerateObject = vi.mocked(generateObjectTracked)

const USER_ID = "user-1"

/**
 * The wire shape: every content key present, `null` where the model left the
 * original value alone. Strict structured outputs never omit a key.
 */
function nullContent(
  overrides: Partial<z.infer<typeof optimizedContentSchema>> = {}
): z.infer<typeof optimizedContentSchema> {
  const base = Object.fromEntries(
    Object.keys(optimizedContentSchema.shape).map((key) => [key, null])
  ) as z.infer<typeof optimizedContentSchema>
  return { ...base, ...overrides }
}

function lastCallArgs() {
  return mockedGenerateObject.mock.calls[0][0] as unknown as {
    prompt: string
    system: string
    schema: unknown
    providerOptions?: Record<string, Record<string, unknown>>
    tracking: { feature: string; surface: string; userId: string }
  }
}

const sections: Section[] = [
  {
    id: "sec-1",
    type: "SUMMARY",
    title: "Summary",
    order: 0,
    visible: true,
    items: [{ id: "item-1", content: { text: "Engineer.", customFlag: true }, order: 0 }],
  },
  {
    id: "sec-2",
    type: "EXPERIENCE",
    title: "Experience",
    order: 1,
    visible: true,
    items: [
      {
        id: "item-2",
        content: { company: "Acme", role: "Engineer", bullets: ["Worked on checkout"] },
        order: 0,
      },
    ],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockedGenerateObject.mockResolvedValue({ object: { sections: [] } } as never)
})

describe("optimizeResume success path", () => {
  it("passes the output schema and tracks the call against the user", async () => {
    await optimizeResume(sections, { userId: USER_ID })

    const args = lastCallArgs()
    expect(args.schema).toBe(optimizedSectionsSchema)
    expect(args.tracking).toEqual({
      feature: "export.optimize",
      surface: "app",
      userId: USER_ID,
    })
  })

  it("merges validated content while preserving ids, order, type and visibility", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: {
        sections: [
          { id: "sec-1", items: [{ id: "item-1", content: { text: "Backend engineer." } }] },
          {
            id: "sec-2",
            items: [{ id: "item-2", content: { bullets: ["Rebuilt checkout on Kubernetes"] } }],
          },
        ],
      },
    } as never)

    const { sections: result } = await optimizeResume(sections, { userId: USER_ID })

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: "sec-1", type: "SUMMARY", order: 0, visible: true })
    expect(result[0].items[0]).toMatchObject({ id: "item-1", order: 0 })
    expect(result[0].items[0].content.text).toBe("Backend engineer.")
    // Keys the schema does not model survive the merge.
    expect(result[0].items[0].content.customFlag).toBe(true)
    // Keys the model omitted keep their original value.
    expect(result[1].items[0].content).toEqual({
      company: "Acme",
      role: "Engineer",
      bullets: ["Rebuilt checkout on Kubernetes"],
    })
  })

  it("leaves sections and items the model did not return untouched", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: { sections: [{ id: "sec-1", items: [] }] },
    } as never)

    const { sections: result } = await optimizeResume(sections, { userId: USER_ID })

    expect(result[0].items[0].content).toEqual({ text: "Engineer.", customFlag: true })
    expect(result[1]).toEqual(sections[1])
  })
})

describe("optimizeResume strict-mode nulls", () => {
  it("disables OpenAI strict JSON schema so the optional content keys are legal", async () => {
    await optimizeResume(sections, { userId: USER_ID })

    expect(lastCallArgs().providerOptions).toEqual({ openai: { strictJsonSchema: false } })
  })


  it("emits a JSON Schema whose `required` lists every property at every level", () => {
    // OpenAI's strict structured outputs reject a schema that leaves any
    // property out of `required` — which is exactly what `.optional()`,
    // `.default()` and `.nullish()` do. Every field must therefore be
    // nullable, not optional.
    type ObjectNode = { properties?: Record<string, unknown>; required?: string[] }

    const jsonSchema = z.toJSONSchema(optimizedSectionsSchema) as unknown as ObjectNode
    const objectNodes: ObjectNode[] = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (!node || typeof node !== "object") return
      const candidate = node as ObjectNode
      if (candidate.properties) objectNodes.push(candidate)
      Object.values(node as Record<string, unknown>).forEach(walk)
    }
    walk(jsonSchema)

    // sections wrapper, each section, each item, each item's content.
    expect(objectNodes.length).toBe(4)
    for (const node of objectNodes) {
      expect((node.required ?? []).slice().sort()).toEqual(
        Object.keys(node.properties ?? {}).sort()
      )
    }

    const contentNode = objectNodes.find(
      (node) => node.properties && "credentialId" in node.properties
    )
    expect(contentNode?.required?.slice().sort()).toEqual(
      Object.keys(optimizedContentSchema.shape).sort()
    )
  })

  it("accepts explicit nulls at the schema level", () => {
    // OpenAI strict structured output renders every content key as
    // nullable-required, so all of them must tolerate an explicit null.
    const parsed = optimizedSectionsSchema.safeParse({
      sections: [{ id: "sec-2", items: [{ id: "item-2", content: nullContent() }] }],
    })

    expect(parsed.success).toBe(true)
  })

  it("treats null like an omitted key and never leaks null into merged content", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: {
        sections: [
          { id: "sec-1", items: [{ id: "item-1", content: { text: null, jobTitle: null } }] },
          {
            id: "sec-2",
            items: [
              {
                id: "item-2",
                content: {
                  company: null,
                  role: null,
                  bullets: ["Rebuilt checkout on Kubernetes"],
                  startDate: null,
                  skills: null,
                },
              },
            ],
          },
        ],
      },
    } as never)

    const { sections: result } = await optimizeResume(sections, { userId: USER_ID })

    // Originals preserved where the model returned null.
    expect(result[0].items[0].content).toEqual({ text: "Engineer.", customFlag: true })
    // Optimization still applied for the non-null key.
    expect(result[1].items[0].content).toEqual({
      company: "Acme",
      role: "Engineer",
      bullets: ["Rebuilt checkout on Kubernetes"],
    })
    // No null anywhere in the merged output.
    for (const section of result) {
      for (const item of section.items) {
        for (const [key, value] of Object.entries(item.content)) {
          expect(value, `content.${key} should not be null`).not.toBeNull()
        }
      }
    }
  })
})

describe("optimizeResume fail-soft", () => {
  it("returns the original sections when the model call rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockedGenerateObject.mockRejectedValue(new Error("model exploded"))

    const outcome = await optimizeResume(sections, { userId: USER_ID })
    const result = outcome.sections

    expect(result).toEqual(sections)
    // The caller has to be able to tell a real optimization from a fallback.
    expect(outcome.optimized).toBe(false)
    expect(outcome.reason).toBe("failed")
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[optimize-resume] Optimization failed, exporting original content")
    )
    expect(spy.mock.calls[0][0]).toContain("model exploded")
  })

  it("returns the original sections when the model output fails validation", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    // generateObject throws on schema violations; simulate that contract.
    mockedGenerateObject.mockRejectedValue(new Error("response did not match schema"))

    const { sections: result } = await optimizeResume(sections, { userId: USER_ID })

    expect(result).toEqual(sections)
    expect(spy).toHaveBeenCalled()
  })

  it("reports a missing AI key as its own fallback reason", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockedGenerateObject.mockRejectedValue(new AiKeyRequiredError("Add an AI key"))

    const outcome = await optimizeResume(sections, { userId: USER_ID })

    expect(outcome.sections).toEqual(sections)
    expect(outcome.optimized).toBe(false)
    expect(outcome.reason).toBe("ai_key_required")
    expect(spy).toHaveBeenCalled()
  })

  it("reports a spent daily cap as its own fallback reason", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockedGenerateObject.mockRejectedValue(new AiDailyLimitError("Daily limit reached"))

    const outcome = await optimizeResume(sections, { userId: USER_ID })

    expect(outcome.optimized).toBe(false)
    expect(outcome.reason).toBe("ai_daily_limit")
    expect(spy).toHaveBeenCalled()
  })

  it("rejects malformed payloads at the schema level", () => {
    expect(
      optimizedSectionsSchema.safeParse({
        sections: [{ id: "", items: [{ id: "item-1", content: nullContent() }] }],
      }).success
    ).toBe(false)
    expect(
      optimizedSectionsSchema.safeParse({
        sections: [
          {
            id: "sec-1",
            items: [
              { id: "item-1", content: nullContent({ bullets: [1] as unknown as string[] }) },
            ],
          },
        ],
      }).success
    ).toBe(false)
    expect(
      optimizedSectionsSchema.safeParse({
        sections: [
          { id: "sec-1", items: [{ id: "item-1", content: nullContent({ text: "ok" }) }] },
        ],
      }).success
    ).toBe(true)
  })
})

describe("optimizeResume prompt", () => {
  it("states the grounding and keyword-preservation rules and drops the metric mandate", async () => {
    await optimizeResume(sections, { userId: USER_ID })

    const { system } = lastCallArgs()
    expect(system).toContain("GROUNDING — THIS IS THE MOST IMPORTANT RULE")
    expect(system).toContain("NEVER invent specific numbers")
    expect(system).toContain("KEYWORD PRESERVATION")
    expect(system).toContain("PRESERVE existing strong keyword phrasing")
    expect(system).not.toContain("include quantified metrics")
  })

  it("asks for Action–Result–Reason bullets grounded in the original facts", async () => {
    await optimizeResume(sections, { userId: USER_ID })

    const { system } = lastCallArgs()
    expect(system).toContain("Action–Result–Reason")
    expect(system).toContain("ONLY with facts the original bullet already contains")
    expect(system).toContain(
      "state the Result qualitatively when the source gives no figure, never invent numbers for it"
    )
  })

  it("includes the target role and company when supplied", async () => {
    await optimizeResume(sections, {
      userId: USER_ID,
      targetRole: "Backend Engineer", targetCompany: "Acme" })

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("Target role: Backend Engineer")
    expect(prompt).toContain("Target company: Acme")
  })

  it("classifies missing keywords against the resume before prompting", async () => {
    await optimizeResume(sections, {
      userId: USER_ID,
      // "checkout" is in a bullet; the other two appear nowhere in `sections`.
      missingKeywords: ["checkout", "Kubernetes", "  Terraform  ", "", "   "],
    })

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("SUPPORTED")
    expect(prompt).toContain("- checkout")
    expect(prompt).toContain("DO NOT CLAIM")
    expect(prompt).toContain("- Kubernetes")
    expect(prompt).toContain("- Terraform")
  })

  it("REGRESSION: reverts an item that claimed a requirement the resume cannot back", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: {
        sections: [
          {
            id: "sec-2",
            items: [
              {
                id: "item-2",
                content: {
                  bullets: ["Worked on checkout, integrating JMS messaging."],
                },
              },
            ],
          },
        ],
      },
    } as never)

    const result = await optimizeResume(sections, {
      userId: USER_ID,
      missingKeywords: ["JMS"],
    })

    const experience = result.sections.find((section) => section.id === "sec-2")
    expect(experience?.items[0].content).toEqual({
      company: "Acme",
      role: "Engineer",
      bullets: ["Worked on checkout"],
    })
  })

  it("keeps an optimized item that introduces nothing ungrounded", async () => {
    mockedGenerateObject.mockResolvedValue({
      object: {
        sections: [
          {
            id: "sec-2",
            items: [
              {
                id: "item-2",
                content: { bullets: ["Rebuilt checkout, cutting cart abandonment."] },
              },
            ],
          },
        ],
      },
    } as never)

    const result = await optimizeResume(sections, {
      userId: USER_ID,
      missingKeywords: ["JMS"],
    })

    const experience = result.sections.find((section) => section.id === "sec-2")
    expect(experience?.items[0].content.bullets).toEqual([
      "Rebuilt checkout, cutting cart abandonment.",
    ])
  })

  it("caps missing keywords at 20 entries and 60 characters each", async () => {
    await optimizeResume(sections, {
      userId: USER_ID,
      missingKeywords: [...Array.from({ length: 21 }, (_, i) => `kw${i}`), "y".repeat(100)],
    })

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("- kw19")
    expect(prompt).not.toContain("- kw20")
    expect(prompt).not.toContain("y".repeat(61))
  })

  it("renders ATS issues and caps them at 12", async () => {
    await optimizeResume(sections, {
      userId: USER_ID,
      atsIssues: [
        {
          severity: "warning",
          category: "impact",
          section: "experience",
          message: "Bullets lack measurable outcomes",
          suggestion: "Add metrics",
        },
        ...Array.from({ length: 14 }, (_, i) => ({
          severity: "info" as const,
          category: "format",
          message: `issue-${i}`,
        })),
      ],
    })

    const { prompt } = lastCallArgs()
    expect(prompt).toContain("ATS issues found on this resume:")
    expect(prompt).toContain(
      "- [warning/impact @ experience] Bullets lack measurable outcomes (fix: Add metrics)"
    )
    expect(prompt).toContain("issue-10")
    expect(prompt).not.toContain("issue-11")
  })

  it("omits the ATS blocks when no analysis context is supplied", async () => {
    await optimizeResume(sections, { userId: USER_ID })

    const { prompt } = lastCallArgs()
    expect(prompt).not.toContain("ATS issues found on this resume")
    expect(prompt).not.toContain("ATS keywords missing from this resume")
  })
})
