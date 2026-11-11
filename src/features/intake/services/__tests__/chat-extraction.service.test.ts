// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generateObjectTracked: vi.fn(),
}))

vi.mock("@/shared/lib/ai-generate", async () => {
  const actual = await vi.importActual<typeof import("@/shared/lib/ai-generate")>(
    "@/shared/lib/ai-generate"
  )
  return { ...actual, generateObjectTracked: mocks.generateObjectTracked }
})

import { extractChatFacts } from "../chat-extraction.service"
import type { ContactPatchData, EvidencePatchData, IntakePatchDraft } from "../../types"

const USER_ID = "user-1"

function contact(drafts: IntakePatchDraft[], field: string): string | undefined {
  const match = drafts.find(
    (draft) =>
      draft.kind === "CONTACT" &&
      (draft.data as ContactPatchData).field === field
  )
  return match ? (match.data as ContactPatchData).value : undefined
}

function experience(drafts: IntakePatchDraft[]): EvidencePatchData[] {
  return drafts
    .filter((draft) => draft.kind === "EVIDENCE")
    .map((draft) => draft.data as EvidencePatchData)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.generateObjectTracked.mockRejectedValue(new Error("AI should not be called"))
})

describe("deterministic chat extraction", () => {
  it("reads only explicit first-person facts", async () => {
    const result = await extractChatFacts({
      userId: USER_ID,
      useAi: false,
      source: "CHAT",
      transcript: [
        {
          role: "user",
          content:
            "My name is Ada Lovelace. I'm based in London. My email is ada@example.com. I worked at Acme as a Backend Engineer from 2021 to 2023. I use TypeScript and PostgreSQL daily. I'm looking for platform engineering roles.",
        },
        { role: "assistant", content: "I can help with that." },
      ],
    })

    expect(mocks.generateObjectTracked).not.toHaveBeenCalled()
    expect(result.mode).toBe("deterministic")
    expect(contact(result.patches, "contactFullName")).toBe("Ada Lovelace")
    expect(contact(result.patches, "contactEmail")).toBe("ada@example.com")
    expect(contact(result.patches, "contactLocation")).toBe("London")

    const roles = experience(result.patches)
    expect(roles).toHaveLength(1)
    expect(roles[0]).toMatchObject({
      evidenceKind: "EXPERIENCE",
      title: "Backend Engineer",
      organization: "Acme",
      startDate: "2021-01-01",
      endDate: "2023-01-01",
    })

    const skills = result.patches
      .filter((draft) => draft.kind === "SKILL")
      .map((draft) => (draft.data as { name: string }).name)
    expect(skills).toContain("TypeScript")
    expect(skills).toContain("PostgreSQL")

    const target = result.patches.find((draft) => draft.kind === "TARGET_ROLE")
    expect(target && (target.data as { title: string }).title).toBe(
      "platform engineering"
    )
  })

  it("never turns an assistant statement into a candidate fact", async () => {
    const result = await extractChatFacts({
      userId: USER_ID,
      useAi: false,
      source: "CHAT",
      transcript: [
        {
          role: "assistant",
          content:
            "You worked at Google as a Staff Engineer and you know Kubernetes.",
        },
      ],
    })

    expect(result.patches).toEqual([])
    expect(result.warnings.join(" ")).toMatch(/no user statements/i)
  })

  it("does not invent an employer, email or dates", async () => {
    const result = await extractChatFacts({
      userId: USER_ID,
      useAi: false,
      source: "CHAT",
      transcript: [
        { role: "user", content: "I am a backend engineer who likes small teams." },
      ],
    })

    expect(contact(result.patches, "contactEmail")).toBeUndefined()
    expect(experience(result.patches)).toEqual([])
  })

  it("asks the next unanswered question instead of repeating a stated fact", async () => {
    const result = await extractChatFacts({
      userId: USER_ID,
      useAi: false,
      source: "CHAT",
      transcript: [
        {
          role: "user",
          content: "My name is Ada Lovelace and my email is ada@example.com.",
        },
      ],
    })

    expect(result.nextQuestion).toMatch(/Where are you based/)
  })

  it("prioritizes a profile gap named by the caller", async () => {
    const result = await extractChatFacts({
      userId: USER_ID,
      useAi: false,
      source: "CHAT",
      missingFields: ["targetRole"],
      transcript: [
        {
          role: "user",
          content: "My name is Ada Lovelace and my email is ada@example.com.",
        },
      ],
    })

    expect(result.nextQuestion).toMatch(/What role are you targeting/)
  })

  it("marks voice provenance by input mode without changing extraction", async () => {
    const result = await extractChatFacts({
      userId: USER_ID,
      useAi: false,
      source: "VOICE",
      inputMode: "MICROPHONE",
      transcript: [
        {
          role: "user",
          content: "I worked at Acme as a Data Analyst from 2019 to 2020.",
        },
      ],
    })

    const evidence = result.patches.find((draft) => draft.kind === "EVIDENCE")
    expect(evidence?.provenance.adapter).toBe("voice-microphone")
    expect(experience(result.patches)[0]?.organization).toBe("Acme")
  })
})
