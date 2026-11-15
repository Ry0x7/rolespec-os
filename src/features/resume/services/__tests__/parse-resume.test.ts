import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

vi.mock("@/shared/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/shared/lib/ai-generate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/ai-generate")>()),
  generateObjectTracked: vi.fn(),
}))
vi.mock("pdf-parse", () => ({
  PDFParse: class {
    async getText() {
      return { text: "Ada Lovelace\nSenior Engineer" }
    }
  },
}))

import { generateObjectTracked } from "@/shared/lib/ai-generate"
import { parseResumeFile } from "../parse-resume"

const mockedGenerateObject = vi.mocked(generateObjectTracked)

const USER_ID = "user-1"

const PDF = "application/pdf"
const buffer = new Uint8Array([1, 2, 3])

/** A response where the model found nothing but the title. */
const allNulls = {
  title: "Untitled Resume",
  contact: {
    fullName: null,
    jobTitle: null,
    email: null,
    phone: null,
    location: null,
    linkedin: null,
    github: null,
    website: null,
  },
  summary: { text: null },
  experience: [
    {
      company: null,
      role: null,
      location: null,
      startDate: null,
      endDate: null,
      current: null,
      bullets: null,
    },
  ],
  education: [{ school: null, degree: null, field: null, gpa: null, startDate: null, endDate: null }],
  skills: [{ category: null, skills: null }],
  projects: [{ name: null, bullets: null, technologies: null, url: null, startDate: null, endDate: null }],
  certifications: [
    { name: null, organization: null, dateObtained: null, expirationDate: null, credentialId: null },
  ],
}

const fullyPopulated = {
  title: "Senior Backend Engineer Resume",
  contact: {
    fullName: "Ada Lovelace",
    jobTitle: "Senior Backend Engineer",
    email: "ada@example.com",
    phone: "+1 555 0100",
    location: "London, UK",
    linkedin: "https://linkedin.com/in/ada",
    github: "https://github.com/ada",
    website: "https://ada.dev",
  },
  summary: { text: "Backend engineer with 10 years of experience." },
  experience: [
    {
      company: "Analytical Engines Ltd",
      role: "Senior Backend Engineer",
      location: "London, UK",
      startDate: "Jan 2022",
      endDate: "Present",
      current: true,
      bullets: ["Built the note engine", "Cut latency in half"],
    },
  ],
  education: [
    {
      school: "University of London",
      degree: "BSc",
      field: "Mathematics",
      gpa: "3.9",
      startDate: "2010",
      endDate: "2014",
    },
  ],
  skills: [{ category: "Languages", skills: ["TypeScript", "Go"] }],
  projects: [
    {
      name: "RoleSpec",
      bullets: ["Shipped an AI career OS"],
      technologies: ["Next.js", "Prisma"],
      url: "https://github.com/ada/rolespec",
      startDate: "Jan 2025",
      endDate: "Mar 2026",
    },
  ],
  certifications: [
    {
      name: "AWS Solutions Architect",
      organization: "Amazon",
      dateObtained: "2023",
      expirationDate: "2026",
      credentialId: "ABC-123",
    },
  ],
}

function capturedCall(index = 0) {
  return mockedGenerateObject.mock.calls[index][0] as unknown as {
    schema: z.ZodTypeAny
    system: string
    prompt: string
  }
}

/** Collects the paths of every ZodOptional node reachable from `schema`. */
function findOptionalPaths(schema: unknown, path = "$", found: string[] = []): string[] {
  if (schema instanceof z.ZodOptional) found.push(path)

  const def = (schema as { _zod?: { def?: Record<string, unknown> } })?._zod?.def
  if (!def) return found

  switch (def.type) {
    case "object": {
      const shape = def.shape as Record<string, unknown>
      for (const [key, child] of Object.entries(shape)) {
        findOptionalPaths(child, `${path}.${key}`, found)
      }
      break
    }
    case "array":
      findOptionalPaths(def.element, `${path}[]`, found)
      break
    case "optional":
    case "nullable":
    case "nullish":
    case "default":
      findOptionalPaths(def.innerType, path, found)
      break
  }

  return found
}

/** Recursively collects the paths of every null value. */
function findNullPaths(value: unknown, path = "$", found: string[] = []): string[] {
  if (value === null) {
    found.push(path)
    return found
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => findNullPaths(entry, `${path}[${i}]`, found))
    return found
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      findNullPaths(entry, `${path}.${key}`, found)
    }
  }
  return found
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("parseResumeFile schema strictness", () => {
  it("passes a schema with no optional fields anywhere (OpenAI strict mode)", async () => {
    mockedGenerateObject.mockResolvedValue({ object: allNulls } as never)

    await parseResumeFile(buffer, PDF, USER_ID, { useAi: true })

    const { schema } = capturedCall()
    // Sanity check that the walker actually reaches nested array items: an
    // optional planted in a comparable shape is found.
    expect(
      findOptionalPaths(z.object({ a: z.array(z.object({ b: z.string().optional() })) }))
    ).toEqual(["$.a[].b"])
    // OpenAI strict structured output requires every property to be listed in
    // `required`, so optionality must be expressed as nullable instead.
    expect(findOptionalPaths(schema)).toEqual([])
  })

  it("accepts a fully-null payload and requires a non-null title", async () => {
    mockedGenerateObject.mockResolvedValue({ object: allNulls } as never)

    await parseResumeFile(buffer, PDF, USER_ID, { useAi: true })

    const { schema } = capturedCall()
    expect(schema.safeParse(allNulls).success).toBe(true)
    expect(schema.safeParse({ ...allNulls, title: null }).success).toBe(false)
    // Keys may not be omitted under strict mode either — the schema still
    // rejects a missing contact object.
    const withoutContact = { ...allNulls, contact: undefined }
    expect(schema.safeParse(withoutContact).success).toBe(false)
  })

  it("tells the model to emit null instead of omitting keys", async () => {
    mockedGenerateObject.mockResolvedValue({ object: allNulls } as never)

    await parseResumeFile(buffer, PDF, USER_ID, { useAi: true })

    const { system } = capturedCall()
    expect(system).toContain("set that field to null")
    expect(system).toContain("Every key shown above MUST be present")
    expect(system).not.toContain("omit optional fields if not present")
    expect(system).toContain('"fullName": "string or null"')
  })
})

describe("parseResumeFile null stripping", () => {
  it("returns no null values when the model answers with nulls everywhere", async () => {
    mockedGenerateObject.mockResolvedValue({ object: allNulls } as never)

    const result = await parseResumeFile(buffer, PDF, USER_ID, { useAi: true })

    expect(findNullPaths(result)).toEqual([])
    expect(result).toEqual({
      title: "Untitled Resume",
      contact: {},
      summary: {},
      experience: [{}],
      education: [{}],
      skills: [{}],
      projects: [{}],
      certifications: [{}],
    })
    // No bullets survived, so no optimization pass was made.
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1)
  })

  it("keeps keys absent rather than present-and-null", async () => {
    mockedGenerateObject.mockResolvedValue({ object: allNulls } as never)

    const result = await parseResumeFile(buffer, PDF, USER_ID, { useAi: true })

    expect("fullName" in result.contact).toBe(false)
    expect(Object.keys(result.contact)).toEqual([])
  })
})

describe("parseResumeFile happy path", () => {
  it("round-trips a fully-populated response and optimizes every other bullet", async () => {
    mockedGenerateObject
      .mockResolvedValueOnce({ object: fullyPopulated } as never)
      .mockResolvedValueOnce({ object: { bullets: ["Built the note engine, faster"] } } as never)

    const result = await parseResumeFile(buffer, PDF, USER_ID, { useAi: true })

    expect(findNullPaths(result)).toEqual([])
    expect(result).toEqual({
      ...fullyPopulated,
      experience: [
        {
          ...fullyPopulated.experience[0],
          // index 0 optimized, index 1 untouched
          bullets: ["Built the note engine, faster", "Cut latency in half"],
        },
      ],
    })
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2)
    expect(capturedCall().prompt).toContain("Ada Lovelace\nSenior Engineer")
  })

  it("asks the bullet optimizer for Action–Result–Reason bullets without inventing numbers", async () => {
    mockedGenerateObject
      .mockResolvedValueOnce({ object: fullyPopulated } as never)
      .mockResolvedValueOnce({ object: { bullets: ["Built the note engine, faster"] } } as never)

    await parseResumeFile(buffer, PDF, USER_ID, { useAi: true })

    const { system } = capturedCall(1)
    expect(system).toContain("Action–Result–Reason")
    expect(system).toContain(
      "state the Result qualitatively when the bullet gives no figure and never invent numbers"
    )
    expect(system).toContain("Keep the same meaning and facts")
    expect(system).toContain("Return the same number of bullets in the same order")
  })

  it("runs the bullet pass on the cheap tier", async () => {
    mockedGenerateObject
      .mockResolvedValueOnce({ object: fullyPopulated } as never)
      .mockResolvedValueOnce({ object: { bullets: ["Built the note engine, faster"] } } as never)

    await parseResumeFile(buffer, PDF, USER_ID, { useAi: true })

    const optimizeCall = mockedGenerateObject.mock.calls[1][0] as { tier?: string }
    const parseCall = mockedGenerateObject.mock.calls[0][0] as { tier?: string }
    expect(optimizeCall.tier).toBe("light")
    // The extraction pass stays on the caller's normal model.
    expect(parseCall.tier).toBeUndefined()
  })

  it("skips the second AI call when bullet polish is turned off", async () => {
    mockedGenerateObject.mockResolvedValueOnce({ object: fullyPopulated } as never)

    const result = await parseResumeFile(buffer, PDF, USER_ID, {
      useAi: true, optimizeBullets: false,
    })

    expect(mockedGenerateObject).toHaveBeenCalledTimes(1)
    expect(result.experience[0].bullets).toEqual([
      "Built the note engine",
      "Cut latency in half",
    ])
  })
})
