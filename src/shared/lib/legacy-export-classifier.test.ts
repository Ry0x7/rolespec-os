import { describe, expect, it } from "vitest"

import {
  classifyBlob,
  collectReferencedPathnames,
  matchesCurrentPathnameShape,
  pathnameFromAbsoluteUrl,
  pathnameFromSameOriginUrl,
} from "./legacy-export-classifier"

describe("pathnameFromSameOriginUrl", () => {
  it("maps a same-origin export URL to its blob pathname", () => {
    expect(pathnameFromSameOriginUrl("/api/exports/res1/batch1/minimal-abc123XYZ_-9.pdf")).toBe(
      "exports/res1/batch1/minimal-abc123XYZ_-9.pdf"
    )
  })

  it("returns null for a non-matching prefix", () => {
    expect(pathnameFromSameOriginUrl("https://example.com/foo.pdf")).toBeNull()
    expect(pathnameFromSameOriginUrl("/other/path")).toBeNull()
  })
})

describe("pathnameFromAbsoluteUrl", () => {
  it("extracts the pathname from an absolute blob CDN URL", () => {
    expect(
      pathnameFromAbsoluteUrl(
        "https://abc123.public.blob.vercel-storage.com/exports/res1/batch1/minimal.pdf"
      )
    ).toBe("exports/res1/batch1/minimal.pdf")
  })

  it("returns null for an unparseable value", () => {
    expect(pathnameFromAbsoluteUrl("not-a-url")).toBeNull()
  })
})

describe("matchesCurrentPathnameShape", () => {
  it("matches the exact shape the current writer produces", () => {
    expect(matchesCurrentPathnameShape("exports/res1/batch1/minimal-abcDEF012_-9.pdf")).toBe(true)
  })

  it("rejects a legacy no-suffix pathname", () => {
    expect(matchesCurrentPathnameShape("exports/res1/batch1/minimal.pdf")).toBe(false)
  })

  it("rejects a suffix of the wrong length", () => {
    expect(matchesCurrentPathnameShape("exports/res1/batch1/minimal-short.pdf")).toBe(false)
  })
})

describe("collectReferencedPathnames", () => {
  it("splits legacy absolute URLs from current same-origin URLs", () => {
    const rows: unknown[] = [
      {
        MINIMAL: {
          pdfUrl: "https://store.public.blob.vercel-storage.com/exports/res1/b1/minimal.pdf",
          docxUrl: "https://store.public.blob.vercel-storage.com/exports/res1/b1/minimal.docx",
        },
      },
      {
        MODERN: { pdfUrl: "/api/exports/res2/b2/modern-abcDEF012_-9.pdf" },
      },
    ]

    const result = collectReferencedPathnames(rows)

    expect(result.legacy).toEqual(
      new Set(["exports/res1/b1/minimal.pdf", "exports/res1/b1/minimal.docx"])
    )
    expect(result.current).toEqual(new Set(["exports/res2/b2/modern-abcDEF012_-9.pdf"]))
  })

  it("skips malformed/unknown shapes without throwing", () => {
    const rows: unknown[] = [null, "a string", 42, { MINIMAL: null }, { MINIMAL: { pdfUrl: 7 } }]
    const result = collectReferencedPathnames(rows)
    expect(result.legacy.size).toBe(0)
    expect(result.current.size).toBe(0)
  })
})

describe("classifyBlob", () => {
  const emptyRefs = { legacy: new Set<string>(), current: new Set<string>() }

  it("classifies as current when a live row references it", () => {
    const referenced = { legacy: new Set<string>(), current: new Set(["exports/r/b/f.pdf"]) }
    const result = classifyBlob(
      { pathname: "exports/r/b/f.pdf", uploadedAt: new Date("2020-01-01") },
      referenced,
      new Date("2099-01-01")
    )
    expect(result).toBe("current")
  })

  it("classifies as current by pathname shape even with no DB reference", () => {
    const result = classifyBlob(
      { pathname: "exports/r/b/minimal-abcDEF012_-9.pdf", uploadedAt: new Date("2020-01-01") },
      emptyRefs,
      new Date("2099-01-01")
    )
    expect(result).toBe("current")
  })

  it("classifies as legacy when a live row references it via an absolute URL", () => {
    const referenced = { legacy: new Set(["exports/r/b/minimal.pdf"]), current: new Set<string>() }
    const result = classifyBlob(
      { pathname: "exports/r/b/minimal.pdf", uploadedAt: new Date("2026-01-01") },
      referenced
    )
    expect(result).toBe("legacy")
  })

  it("classifies as legacy by cutoff when there is no DB reference either way", () => {
    const result = classifyBlob(
      { pathname: "exports/r/b/minimal.pdf", uploadedAt: new Date("2020-01-01") },
      emptyRefs,
      new Date("2025-01-01")
    )
    expect(result).toBe("legacy")
  })

  it("classifies as unknown when nothing matches and there is no cutoff", () => {
    const result = classifyBlob(
      { pathname: "exports/r/b/minimal.pdf", uploadedAt: new Date("2020-01-01") },
      emptyRefs
    )
    expect(result).toBe("unknown")
  })

  it("classifies as unknown when the cutoff doesn't reach it", () => {
    const result = classifyBlob(
      { pathname: "exports/r/b/minimal.pdf", uploadedAt: new Date("2026-06-01") },
      emptyRefs,
      new Date("2025-01-01")
    )
    expect(result).toBe("unknown")
  })
})
