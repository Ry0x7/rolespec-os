// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  contactPatchDataSchema,
  correctIntakePatchSchema,
  createIntakeRunSchema,
  intakeSourceRequestSchema,
} from "../schemas/intake.schema"

const ALL_REQUESTS = [
  { source: "RESUME", input: { text: "x".repeat(40), fileName: "resume.pdf" } },
  { source: "GITHUB", input: { url: "https://github.com/ada", consent: true } },
  { source: "LINKEDIN", input: { text: "x".repeat(40), fileName: "linkedin.pdf" } },
  { source: "WEB", input: { url: "https://ada.dev", consent: true } },
  {
    source: "CHAT",
    input: { transcript: [{ role: "user", content: "I use TypeScript." }] },
  },
  { source: "VOICE", input: { transcript: "I worked at Acme." } },
] as const

describe("intake source requests", () => {
  it("accepts exactly one request for each of the six sources", () => {
    const parsed = createIntakeRunSchema.parse({ requests: ALL_REQUESTS })
    expect(parsed.requests.map((request) => request.source)).toEqual([
      "RESUME",
      "GITHUB",
      "LINKEDIN",
      "WEB",
      "CHAT",
      "VOICE",
    ])
    expect(parsed.requests[5].input).toMatchObject({ inputMode: "PASTED" })
  })

  it("rejects two attempts at the same source in one run", () => {
    const parsed = createIntakeRunSchema.safeParse({
      requests: [
        { source: "GITHUB", input: { url: "https://github.com/a", consent: true } },
        { source: "GITHUB", input: { url: "https://github.com/b", consent: true } },
      ],
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/Only one GITHUB/)
    }
  })

  it("requires explicit consent before a public web source is accepted", () => {
    const parsed = intakeSourceRequestSchema.safeParse({
      source: "WEB",
      input: { url: "https://ada.dev" },
    })
    expect(parsed.success).toBe(false)
  })

  it("requires a resume id or real text", () => {
    const parsed = intakeSourceRequestSchema.safeParse({
      source: "RESUME",
      input: { text: "too short" },
    })
    expect(parsed.success).toBe(false)
  })
})

describe("canonical contact patch", () => {
  it("accepts a valid email", () => {
    expect(
      contactPatchDataSchema.safeParse({
        field: "contactEmail",
        value: "ada@example.com",
      }).success
    ).toBe(true)
  })

  it("rejects a malformed email", () => {
    expect(
      contactPatchDataSchema.safeParse({
        field: "contactEmail",
        value: "not-an-email",
      }).success
    ).toBe(false)
  })

  it("rejects a non-http profile URL", () => {
    expect(
      contactPatchDataSchema.safeParse({
        field: "linkedinUrl",
        value: "javascript:alert(1)",
      }).success
    ).toBe(false)
  })
})

describe("corrections", () => {
  it("accepts a discriminated correction with no confidence or provenance", () => {
    const parsed = correctIntakePatchSchema.parse({
      correction: {
        kind: "SKILL",
        data: { name: "TypeScript", category: "Language" },
      },
      note: "The extractor missed the category.",
    })
    expect(parsed.correction.kind).toBe("SKILL")
  })

  it("rejects a correction whose data belongs to another kind", () => {
    expect(
      correctIntakePatchSchema.safeParse({
        correction: { kind: "SKILL", data: { field: "contactEmail", value: "a@b.co" } },
      }).success
    ).toBe(false)
  })
})

describe("idempotency key", () => {
  it("requires a bounded, non-trivial replay key", () => {
    expect(
      createIntakeRunSchema.safeParse({
        requests: [ALL_REQUESTS[1]],
        idempotencyKey: "short",
      }).success
    ).toBe(false)
    expect(
      createIntakeRunSchema.safeParse({
        requests: [ALL_REQUESTS[1]],
        idempotencyKey: "x".repeat(101),
      }).success
    ).toBe(false)
    expect(
      createIntakeRunSchema.safeParse({
        requests: [ALL_REQUESTS[1]],
        idempotencyKey: "intake-run-1234",
      }).success
    ).toBe(true)
  })
})
