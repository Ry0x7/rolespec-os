import { describe, it, expect } from "vitest"
import { stripInternalRefs } from "../enhance-reason"

const SECTION = "cmu2icewf0001l4dw3k0oen36"
const ITEM = "cmu2icf0d0005l4dw0zj1a2qk"
const BULLET_ID = `${SECTION}::${ITEM}::b0`
const SUMMARY_ID = `${SECTION}::cmu2icf9z0009l4dwsum00001::summary`
const IDS = [BULLET_ID, SUMMARY_ID]

describe("stripInternalRefs", () => {
  it("removes the realistic leaked sentence down to readable text", () => {
    expect(
      stripInternalRefs(`Bullet b0 (${BULLET_ID}) lacks a quantified result`, IDS)
    ).toBe("Bullet lacks a quantified result")
  })

  it("removes a full target id", () => {
    expect(stripInternalRefs(`Rewrites ${SUMMARY_ID} to add Kubernetes.`, IDS)).toBe(
      "Rewrites to add Kubernetes."
    )
  })

  it("removes section and item id components that appear on their own", () => {
    expect(stripInternalRefs(`The item ${ITEM} in section ${SECTION} is vague.`, IDS)).toBe(
      "The item in section is vague."
    )
  })

  it("does not treat short or digit-free components as ids", () => {
    // "summary" is a component of SUMMARY_ID but is ordinary English.
    expect(stripInternalRefs("The summary is too long.", IDS)).toBe("The summary is too long.")
  })

  it("removes bare and wrapped bullet refs", () => {
    expect(stripInternalRefs("b0 lacks a measurable outcome", IDS)).toBe(
      "lacks a measurable outcome"
    )
    expect(stripInternalRefs("Lacks a measurable outcome [b0].", IDS)).toBe(
      "Lacks a measurable outcome."
    )
    expect(stripInternalRefs("Lacks a measurable outcome (b12).", IDS)).toBe(
      "Lacks a measurable outcome."
    )
    expect(stripInternalRefs("Lacks a measurable outcome `b3`.", IDS)).toBe(
      "Lacks a measurable outcome."
    )
  })

  it("keeps the noun in connector forms", () => {
    expect(stripInternalRefs("The bullet b0 lacks a result.", IDS)).toBe(
      "The bullet lacks a result."
    )
    expect(stripInternalRefs("Bullet [b2] repeats bullet #1.", IDS)).toBe(
      "Bullet repeats bullet."
    )
    expect(stripInternalRefs("target b0 lacks a result.", IDS)).toBe(
      "this bullet lacks a result."
    )
    expect(stripInternalRefs("Target b0 lacks a result.", IDS)).toBe(
      "This bullet lacks a result."
    )
  })

  it("leaves ordinary words that resemble refs untouched", () => {
    const text = "Adds B2B and b2b SaaS, web3 tooling, and a Plan B for rollout."
    expect(stripInternalRefs(text, IDS)).toBe(text)
  })

  it("cleans up leftover :: separators", () => {
    expect(stripInternalRefs("See ::b0:: for the weak verb.", IDS)).toBe(
      "See for the weak verb."
    )
  })

  it("tidies whitespace and punctuation artefacts", () => {
    expect(stripInternalRefs(`  Weak verb ${BULLET_ID} , missing   outcome b1 .  `, IDS)).toBe(
      "Weak verb, missing outcome."
    )
  })

  it("returns an empty string when only refs remain", () => {
    expect(stripInternalRefs(`${BULLET_ID} (b0)`, IDS)).toBe("")
    expect(stripInternalRefs("   ", IDS)).toBe("")
  })

  it("never throws on odd input", () => {
    expect(stripInternalRefs(undefined as never, IDS)).toBe("")
    expect(stripInternalRefs("Fine reason.", [])).toBe("Fine reason.")
    expect(stripInternalRefs("Odd (regex) chars [x].", ["a.*(b"])).toBe(
      "Odd (regex) chars [x]."
    )
  })

  it("fails closed with an empty reason when stripping throws", () => {
    const throwingIds = Object.assign([], {
      filter() {
        throw new Error("boom")
      },
    }) as unknown as readonly string[]
    expect(stripInternalRefs(`Bullet b0 (${BULLET_ID}) lacks a result`, throwingIds)).toBe("")
  })
})
