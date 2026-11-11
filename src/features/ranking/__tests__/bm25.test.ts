import { describe, expect, it } from "vitest"

import { bm25Score, buildBm25Index, rankDocuments, tokenize } from "../bm25"

describe("tokenize", () => {
  it("folds case, diacritics and sentence punctuation", () => {
    expect(tokenize("Développeur. TypeScript, React!")).toEqual([
      "developpeur",
      "typescript",
      "react",
    ])
  })

  it("keeps technology punctuation that changes the name", () => {
    expect(tokenize("C++ C# Node.js")).toEqual(["c++", "c#", "node.js"])
  })

  it("returns nothing for empty or punctuation-only text", () => {
    expect(tokenize("")).toEqual([])
    expect(tokenize(" — / ... ")).toEqual([])
  })
})

describe("buildBm25Index", () => {
  it("reports an empty corpus without dividing by zero", () => {
    const index = buildBm25Index([])
    expect(index.documentCount).toBe(0)
    expect(index.averageDocumentLength).toBe(0)
    expect(rankDocuments(index, ["react"])).toEqual([])
  })

  it("does not index a posting with no text", () => {
    const index = buildBm25Index([
      { id: "empty", text: null },
      { id: "blank", text: "   " },
      { id: "real", text: "React" },
    ])
    expect(index.documentCount).toBe(1)
    expect(index.documents.has("empty")).toBe(false)
    expect(index.documents.has("blank")).toBe(false)
  })
})

describe("bm25Score", () => {
  const index = buildBm25Index([
    { id: "d1", text: "react react node" },
    { id: "d2", text: "react python" },
  ])

  it("matches the Okapi BM25 formula with k1 = 1.2 and b = 0.75", () => {
    // N=2, df(react)=2 → idf=ln(1.2)=0.1823215568
    // avgdl=2.5; d1: dl=3, tf=2 → 0.2373; d2: dl=2, tf=1 → 0.1986
    expect(bm25Score(index, "d1", ["react"])).toBeCloseTo(0.2373, 4)
    expect(bm25Score(index, "d2", ["react"])).toBeCloseTo(0.1986, 4)
  })

  it("saturates repeated terms instead of scoring them linearly", () => {
    const repeated = buildBm25Index([
      { id: "many", text: "react react react" },
      { id: "once", text: "react" },
    ])
    const many = bm25Score(repeated, "many", ["react"])!
    const once = bm25Score(repeated, "once", ["react"])!
    expect(many).toBeGreaterThan(once)
    expect(many).toBeLessThan(once * 3)
  })

  it("normalizes for document length", () => {
    const lengths = buildBm25Index([
      { id: "short", text: "react" },
      { id: "long", text: "react node python sql aws docker" },
    ])
    expect(bm25Score(lengths, "short", ["react"])!).toBeGreaterThan(
      bm25Score(lengths, "long", ["react"])!
    )
  })

  it("returns null for a document that was not indexed", () => {
    expect(bm25Score(index, "missing", ["react"])).toBeNull()
    const withEmpty = buildBm25Index([{ id: "empty", text: "" }])
    expect(bm25Score(withEmpty, "empty", ["react"])).toBeNull()
  })

  it("returns zero for an empty query, not null", () => {
    expect(bm25Score(index, "d1", [])).toBe(0)
  })

  it("only counts a query term once when it is repeated", () => {
    expect(bm25Score(index, "d1", ["react", "react"])).toBeCloseTo(
      bm25Score(index, "d1", ["react"])!,
      10
    )
  })
})

describe("rankDocuments", () => {
  it("orders highest score first with a stable id tie-break", () => {
    const index = buildBm25Index([
      { id: "a", text: "react" },
      { id: "b", text: "react" },
      { id: "c", text: "python" },
    ])
    expect(rankDocuments(index, ["react"]).map((entry) => entry.id)).toEqual(["a", "b", "c"])
  })

  it("returns an empty ranking when no document mentions the query", () => {
    const index = buildBm25Index([{ id: "a", text: "python" }])
    expect(rankDocuments(index, ["react"]).every((entry) => entry.score === 0)).toBe(true)
  })
})
