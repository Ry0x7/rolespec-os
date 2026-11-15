import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ANSWER_CACHE_KEY,
  clearApprovedAnswers,
  deleteApprovedAnswer,
  loadApprovedAnswers,
  saveApprovedAnswer,
} from "./approved-answers"

let store: Record<string, unknown>

beforeEach(() => {
  store = {}
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(store, value)
        }),
        remove: vi.fn(async (key: string) => {
          delete store[key]
        }),
      },
    },
  })
})

describe("approved answer cache", () => {
  it("starts empty, then saves under the normalized label", async () => {
    expect(await loadApprovedAnswers()).toEqual({})

    const next = await saveApprovedAnswer("Will you require sponsorship?", "Yes")
    expect(next).toEqual({ "will you require sponsorship": "Yes" })
    expect(store[ANSWER_CACHE_KEY]).toEqual({ "will you require sponsorship": "Yes" })
  })

  it("does not save an empty value or an empty key", async () => {
    await saveApprovedAnswer("Salary expectation", "   ")
    await saveApprovedAnswer("   ", "100")
    expect(await loadApprovedAnswers()).toEqual({})
  })

  it("drops malformed stored entries instead of showing them", async () => {
    store[ANSWER_CACHE_KEY] = {
      "salary expectation": " 90000 ",
      "bad": 42,
      "": "nope",
    }
    expect(await loadApprovedAnswers()).toEqual({ "salary expectation": "90000" })
  })

  it("replaces an answer for the same normalized question", async () => {
    await saveApprovedAnswer("Desired salary", "50000")
    await saveApprovedAnswer("desired   salary", "60000")
    expect(await loadApprovedAnswers()).toEqual({ "desired salary": "60000" })
  })

  it("deletes one answer and clears the rest", async () => {
    await saveApprovedAnswer("Gender", "Prefer not to say")
    await saveApprovedAnswer("Veteran status", "No")
    expect(await deleteApprovedAnswer("gender")).toEqual({ "veteran status": "No" })

    await clearApprovedAnswers()
    expect(store[ANSWER_CACHE_KEY]).toBeUndefined()
    expect(await loadApprovedAnswers()).toEqual({})
  })
})
