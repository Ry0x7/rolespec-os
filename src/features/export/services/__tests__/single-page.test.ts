// @vitest-environment node
import { describe, expect, it } from "vitest"

import { DEFAULT_CUSTOMIZATION } from "@/features/resume/types/customization"
import {
  SINGLE_PAGE_WARNING,
  countPdfPages,
  singlePageCustomizations,
} from "../single-page"

describe("singlePageCustomizations", () => {
  it("tightens only presentation settings, most readable first", () => {
    const candidates = singlePageCustomizations({
      ...DEFAULT_CUSTOMIZATION,
      fontFamily: "serif",
      accent: "#0f766e",
    })

    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({
      density: "compact",
      margins: "compact",
      fontScale: 0.9,
      lineHeight: "snug",
      fontFamily: "serif",
      accent: "#0f766e",
      textAlign: "left",
    })
    expect(candidates[1]).toMatchObject({ margins: "normal" })
    expect(candidates[1]).not.toEqual(candidates[0])
  })

  it("adds a left-aligned last resort only when the user chose another alignment", () => {
    const candidates = singlePageCustomizations({
      ...DEFAULT_CUSTOMIZATION,
      textAlign: "justify",
    })

    expect(candidates).toHaveLength(3)
    expect(candidates[2]).toMatchObject({ textAlign: "left", margins: "compact" })
  })

  it("never returns duplicates or more than three candidates", () => {
    const candidates = singlePageCustomizations()
    const keys = candidates.map((candidate) => JSON.stringify(candidate))

    expect(new Set(keys).size).toBe(keys.length)
    expect(candidates.length).toBeLessThanOrEqual(3)
  })
})

describe("countPdfPages", () => {
  it("returns null instead of throwing when the bytes are not a PDF", async () => {
    await expect(countPdfPages(new Uint8Array([0, 1, 2, 3]))).resolves.toBeNull()
  })

  it("exposes a warning constant for an unfittable resume", () => {
    expect(SINGLE_PAGE_WARNING).toContain("more than one page")
  })
})
