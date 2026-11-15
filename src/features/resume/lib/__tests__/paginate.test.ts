import { describe, it, expect } from "vitest"
import {
  FILL_TOLERANCE_PX,
  measuredSectionHeight,
  paginateSections,
  type MeasuredSection,
  type PageMetrics,
} from "../paginate"

const metrics: PageMetrics = {
  pageHeightPx: 400,
  paddingPx: 20,
  sectionGapPx: 10,
}
// usable height = 400 - 2*20 = 360

function atomic(id: string, height: number): MeasuredSection {
  return {
    id,
    splittable: false,
    headingHeight: 0,
    headingGapPx: 0,
    itemGapPx: 0,
    items: [{ id: `${id}-block`, height }],
  }
}

function splittable(
  id: string,
  itemHeights: number[],
  opts: { headingHeight?: number; headingGapPx?: number; itemGapPx?: number } = {}
): MeasuredSection {
  return {
    id,
    splittable: true,
    headingHeight: opts.headingHeight ?? 20,
    headingGapPx: opts.headingGapPx ?? 0,
    itemGapPx: opts.itemGapPx ?? 0,
    items: itemHeights.map((height, i) => ({ id: `${id}-i${i}`, height })),
  }
}

describe("measuredSectionHeight", () => {
  it("sums items plus item gaps plus the heading block", () => {
    const section = splittable("exp", [50, 50, 50], {
      headingHeight: 20,
      headingGapPx: 8,
      itemGapPx: 10,
    })
    // 20 + 8 heading block, 150 items, 2 gaps * 10
    expect(measuredSectionHeight(section)).toBe(198)
  })

  it("returns 0 when every item measures 0", () => {
    expect(measuredSectionHeight(splittable("empty", [0, 0]))).toBe(0)
  })

  it("ignores the heading gap when there is no heading", () => {
    const section = splittable("s", [30], { headingHeight: 0, headingGapPx: 8 })
    expect(measuredSectionHeight(section)).toBe(30)
  })
})

describe("paginateSections", () => {
  it("returns a single empty page for no sections", () => {
    expect(paginateSections([], metrics)).toEqual([[]])
  })

  it("skips zero-height sections entirely", () => {
    const layout = paginateSections([atomic("a", 100), atomic("b", 0)], metrics)
    expect(layout).toHaveLength(1)
    expect(layout[0].map((s) => s.sectionId)).toEqual(["a"])
  })

  it("keeps atomic sections whole and moves them to the next page when they do not fit", () => {
    // 200 + gap 10 + 200 = 410 > 360
    const layout = paginateSections([atomic("a", 200), atomic("b", 200)], metrics)
    expect(layout.map((page) => page.map((s) => s.sectionId))).toEqual([["a"], ["b"]])
    expect(layout[0][0].itemIds).toEqual(["a-block"])
  })

  it("fills page 1 by splitting a long section at an item boundary", () => {
    // contact 100, then experience: heading 20 + 6 items of 60
    const layout = paginateSections(
      [atomic("contact", 100), splittable("exp", [60, 60, 60, 60, 60, 60])],
      metrics
    )

    expect(layout).toHaveLength(2)
    // page 1: 100 + gap 10 + heading 20 = 130, leaves 230 -> 3 items (180), a 4th
    // would be 240 and overflow.
    expect(layout[0].map((s) => s.sectionId)).toEqual(["contact", "exp"])
    expect(layout[0][1].itemIds).toEqual(["exp-i0", "exp-i1", "exp-i2"])
    expect(layout[0][1].continued).toBe(false)

    // page 2 repeats the heading and takes the remainder
    expect(layout[1][0].sectionId).toBe("exp")
    expect(layout[1][0].itemIds).toEqual(["exp-i3", "exp-i4", "exp-i5"])
    expect(layout[1][0].continued).toBe(true)
  })

  it("charges the heading to the first slice only, never to continuations", () => {
    // usable 360, heading 60: page 1 fits the heading plus 5 items of 60, and
    // the continuation page — which renders no heading, exactly like the PDF —
    // fits 6.
    const layout = paginateSections(
      [splittable("exp", new Array(12).fill(60), { headingHeight: 60 })],
      metrics
    )

    expect(layout.map((page) => page[0].itemIds.length)).toEqual([5, 6, 1])
    expect(layout[0][0].continued).toBe(false)
    expect(layout.slice(1).every((page) => page[0].continued)).toBe(true)
  })

  it("never emits a heading without at least one item", () => {
    // page 1 filled to 350 by the atomic block; heading (20) + first item (60)
    // cannot fit in the remaining 10 - 10 gap, so the whole slice moves on.
    const layout = paginateSections(
      [atomic("a", 350), splittable("exp", [60, 60])],
      metrics
    )
    expect(layout.map((page) => page.map((s) => s.sectionId))).toEqual([["a"], ["exp"]])
    expect(layout[1][0].itemIds).toEqual(["exp-i0", "exp-i1"])
    expect(layout[1][0].continued).toBe(false)
  })

  it("places an oversized single item alone rather than looping forever", () => {
    const layout = paginateSections([splittable("exp", [900, 50])], metrics)
    expect(layout).toHaveLength(2)
    expect(layout[0][0].itemIds).toEqual(["exp-i0"])
    expect(layout[1][0].itemIds).toEqual(["exp-i1"])
    expect(layout[1][0].continued).toBe(true)
  })

  it("counts item gaps when packing", () => {
    // heading 20, items 100 each, itemGap 50: 20 + 100 + 50 + 100 = 270 fits,
    // adding a third (+50+100 = 420) does not.
    const layout = paginateSections(
      [splittable("exp", [100, 100, 100], { itemGapPx: 50 })],
      metrics
    )
    expect(layout[0][0].itemIds).toEqual(["exp-i0", "exp-i1"])
    expect(layout[1][0].itemIds).toEqual(["exp-i2"])
  })

  it("counts the section gap when packing consecutive sections", () => {
    // 180 + gap 10 + 180 = 370 > 360
    const layout = paginateSections([atomic("a", 180), atomic("b", 180)], metrics)
    expect(layout).toHaveLength(2)

    const noGap = paginateSections([atomic("a", 180), atomic("b", 180)], {
      ...metrics,
      sectionGapPx: 0,
    })
    expect(noGap).toHaveLength(1)
  })

  it("fits more content per page with compact metrics than with normal metrics", () => {
    const normal: PageMetrics = { pageHeightPx: 400, paddingPx: 32, sectionGapPx: 20 }
    const compact: PageMetrics = { pageHeightPx: 400, paddingPx: 24, sectionGapPx: 12 }

    const build = (itemGapPx: number, headingGapPx: number) => [
      atomic("contact", 60),
      splittable("exp", new Array(20).fill(50), { headingHeight: 18, headingGapPx, itemGapPx }),
    ]

    const normalLayout = paginateSections(build(12, 8), normal)
    const compactLayout = paginateSections(build(6, 6), compact)

    // Normal: 336 usable -> 3 experience items on page 1.
    // Compact: 352 usable, tighter gaps -> 4 experience items on page 1.
    expect(normalLayout[0][1].itemIds).toHaveLength(3)
    expect(compactLayout[0][1].itemIds).toHaveLength(4)
    expect(compactLayout.length).toBeLessThanOrEqual(normalLayout.length)
  })

  // react-pdf keeps its own slack before wrapping a block; without the same
  // slack here a row that overflows by a fraction of a pixel is evicted to a
  // page the export never creates.
  describe("fill tolerance", () => {
    it("keeps an item that overflows by at most the tolerance on the page", () => {
      // 200 + 162 = 362 = usable 360 + tolerance 2.
      const layout = paginateSections(
        [splittable("exp", [200, 162], { headingHeight: 0 })],
        metrics
      )
      expect(layout).toHaveLength(1)
      expect(layout[0][0].itemIds).toEqual(["exp-i0", "exp-i1"])
    })

    it("moves an item that overflows by more than the tolerance", () => {
      // 200 + 163 = 363, one pixel past the tolerance.
      const layout = paginateSections(
        [splittable("exp", [200, 163], { headingHeight: 0 })],
        metrics
      )
      expect(layout).toHaveLength(2)
      expect(layout[0][0].itemIds).toEqual(["exp-i0"])
      expect(layout[1][0].itemIds).toEqual(["exp-i1"])
    })

    it("applies the same tolerance between whole sections", () => {
      // 180 + gap 10 + 172 = 362, exactly the tolerance.
      expect(paginateSections([atomic("a", 180), atomic("b", 172)], metrics)).toHaveLength(1)
      expect(paginateSections([atomic("a", 180), atomic("b", 173)], metrics)).toHaveLength(2)
    })

    it("pins the tolerance so a change is deliberate", () => {
      expect(FILL_TOLERANCE_PX).toBe(2)
    })
  })

  it("splits a section across three pages when needed", () => {
    const layout = paginateSections([splittable("exp", new Array(15).fill(80), { headingHeight: 40 })], metrics)
    // usable 360, heading 40 -> 4 items (320) per page
    expect(layout).toHaveLength(4)
    expect(layout[0][0].continued).toBe(false)
    expect(layout.slice(1).every((page) => page[0].continued)).toBe(true)
    expect(layout.flatMap((page) => page.flatMap((s) => s.itemIds))).toHaveLength(15)
  })

  it("does not lose or duplicate items across pages", () => {
    const layout = paginateSections(
      [
        atomic("contact", 90),
        splittable("exp", [70, 70, 70, 70], { headingHeight: 20, itemGapPx: 6 }),
        splittable("edu", [40, 40], { headingHeight: 20, itemGapPx: 6 }),
        splittable("skills", [30, 30, 30], { headingHeight: 20, itemGapPx: 4 }),
      ],
      metrics
    )
    const ids = layout.flatMap((page) => page.flatMap((slice) => slice.itemIds))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(1 + 4 + 2 + 3)
  })

  it("never overflows the usable page height for normally sized items", () => {
    const sections = [
      atomic("contact", 90),
      splittable("exp", new Array(7).fill(55), { headingHeight: 20, headingGapPx: 8, itemGapPx: 12 }),
      splittable("proj", new Array(5).fill(65), { headingHeight: 20, headingGapPx: 8, itemGapPx: 12 }),
    ]
    const layout = paginateSections(sections, metrics)
    const byId = new Map(sections.map((s) => [s.id, s]))

    for (const page of layout) {
      let total = 0
      page.forEach((slice, i) => {
        const section = byId.get(slice.sectionId)!
        const heights = slice.itemIds.map(
          (id) => section.items.find((item) => item.id === id)!.height
        )
        // Continuation slices paint no heading, so they are not charged one.
        const head =
          !slice.continued && section.headingHeight > 0
            ? section.headingHeight + section.headingGapPx
            : 0
        total +=
          (i > 0 ? metrics.sectionGapPx : 0) +
          head +
          heights.reduce((a, b) => a + b, 0) +
          (heights.length - 1) * section.itemGapPx
      })
      expect(total).toBeLessThanOrEqual(360 + FILL_TOLERANCE_PX)
    }
  })
})
