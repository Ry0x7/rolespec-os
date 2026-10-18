import { describe, it, expect } from "vitest"

import { extractJobTerms } from "../job-terms"

describe("extractJobTerms", () => {
  it("extracts lowercased significant terms in order of first appearance", () => {
    expect(
      extractJobTerms("Strong experience with Kubernetes and TypeScript required.")
    ).toEqual(["kubernetes", "typescript"])
  })

  it("dedupes repeated terms", () => {
    expect(extractJobTerms("Kafka pipelines. Kafka streaming. KAFKA.")).toEqual([
      "kafka",
      "pipelines",
      "streaming",
    ])
  })

  it("keeps tech names that punctuation would otherwise mangle", () => {
    const terms = extractJobTerms("C# or C++ plus Node.js APIs")
    expect(terms).toContain("c#")
    expect(terms).toContain("c++")
    expect(terms).toContain("node.js")
  })

  it("drops bare numbers, short noise tokens and common posting prose", () => {
    expect(extractJobTerms("5 years in a team, we offer 401k on day 1")).toEqual([
      "offer",
      "401k",
    ])
  })

  it("caps the term list so a pathological posting stays bounded", () => {
    const text = Array.from({ length: 500 }, (_, i) => `term${i}`).join(" ")
    expect(extractJobTerms(text)).toHaveLength(200)
  })

  it("returns an empty list for empty input", () => {
    expect(extractJobTerms("")).toEqual([])
  })
})
