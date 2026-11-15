/**
 * Pure page-packing for the resume preview.
 *
 * The preview measures every section (and every item inside multi-item
 * sections) in a hidden mirror render, then feeds those measurements here.
 * Keeping the algorithm pure makes it unit-testable and keeps the component
 * free of layout math.
 *
 * All gaps are passed in explicitly and must match the gaps actually rendered
 * (the preview renders flex columns with numeric `rowGap`), so packed heights
 * and painted heights agree.
 */

export interface MeasuredItem {
  id: string
  /** Measured height in px, excluding any surrounding gap. */
  height: number
}

/**
 * Slack allowed when deciding whether one more row fits a page.
 *
 * react-pdf keeps its own safety threshold before wrapping a block, so a strict
 * comparison here evicted the last row of a page over sub-pixel and font-metric
 * noise — the preview showed a page the export never produced.
 */
export const FILL_TOLERANCE_PX = 2

export interface MeasuredSection {
  id: string
  /** When true the section's items may be split across pages. */
  splittable: boolean
  /** Height of the section heading, 0 when the section has no heading. */
  headingHeight: number
  /** Gap between the heading and the first item. */
  headingGapPx: number
  /** Gap between consecutive items. */
  itemGapPx: number
  items: MeasuredItem[]
}

export interface PageMetrics {
  pageHeightPx: number
  /** Vertical padding applied on both the top and bottom of a page. */
  paddingPx: number
  /** Gap between two sections on the same page. */
  sectionGapPx: number
}

export interface PageSlice {
  sectionId: string
  itemIds: string[]
  /** True when this slice continues a section started on an earlier page. */
  continued: boolean
}

export type PageLayout = PageSlice[][]

function headingBlockHeight(section: MeasuredSection): number {
  return section.headingHeight > 0 ? section.headingHeight + section.headingGapPx : 0
}

function stackedHeight(items: MeasuredItem[], gapPx: number): number {
  if (items.length === 0) return 0
  return items.reduce((sum, item) => sum + item.height, 0) + (items.length - 1) * gapPx
}

/** Total height a section occupies when rendered as one uninterrupted block. */
export function measuredSectionHeight(section: MeasuredSection): number {
  const items = section.items.filter((item) => item.height > 0)
  if (items.length === 0) return 0
  return headingBlockHeight(section) + stackedHeight(items, section.itemGapPx)
}

/**
 * Greedily packs sections onto fixed-height pages. Splittable sections break at
 * item boundaries so a page is filled before content spills onto the next one.
 *
 * A heading is charged to the first slice of a section only: react-pdf's
 * `splitNodes` never clones a heading onto the continuation page, and the
 * preview no longer repeats it either.
 */
export function paginateSections(
  sections: MeasuredSection[],
  metrics: PageMetrics
): PageLayout {
  const usable = Math.max(0, metrics.pageHeightPx - 2 * metrics.paddingPx)

  const pages: PageLayout = []
  let current: PageSlice[] = []
  let usedH = 0

  function flushPage() {
    if (current.length === 0) return
    pages.push(current)
    current = []
    usedH = 0
  }

  function place(sectionId: string, itemIds: string[], continued: boolean, height: number) {
    const gap = current.length > 0 ? metrics.sectionGapPx : 0
    current.push({ sectionId, itemIds, continued })
    usedH += gap + height
  }

  for (const section of sections) {
    const items = section.items.filter((item) => item.height > 0)
    if (items.length === 0) continue

    const headH = headingBlockHeight(section)

    if (!section.splittable) {
      const height = headH + stackedHeight(items, section.itemGapPx)
      if (
        current.length > 0 &&
        usedH + metrics.sectionGapPx + height > usable + FILL_TOLERANCE_PX
      ) {
        flushPage()
      }
      place(
        section.id,
        items.map((item) => item.id),
        false,
        height
      )
      continue
    }

    let index = 0
    let continued = false

    while (index < items.length) {
      const gap = current.length > 0 ? metrics.sectionGapPx : 0
      let available = usable - usedH - gap
      // Only the first slice of a section carries the heading, like the export.
      const sliceHeadH = continued ? 0 : headH

      // A slice must fit its heading plus at least one item; otherwise start a
      // fresh page rather than emitting an orphaned heading.
      if (
        current.length > 0 &&
        sliceHeadH + items[index].height > available + FILL_TOLERANCE_PX
      ) {
        flushPage()
        available = usable
      }

      const chosen: string[] = []
      let height = sliceHeadH
      while (index < items.length) {
        const cost = (chosen.length === 0 ? 0 : section.itemGapPx) + items[index].height
        // The first item is always placed, even if it overflows an empty page,
        // so a single oversized item can never stall the loop.
        if (chosen.length > 0 && height + cost > available + FILL_TOLERANCE_PX) break
        height += cost
        chosen.push(items[index].id)
        index++
      }

      place(section.id, chosen, continued, height)
      continued = true

      if (index < items.length) flushPage()
    }
  }

  flushPage()

  return pages.length > 0 ? pages : [[]]
}
