"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react"
import { ChevronLeft, ChevronRight, FileText, Layers, Settings2, SlidersHorizontal } from "lucide-react"
import { updateResume } from "../actions"
import { useResumeStore, type Section } from "../hooks/use-resume-store"
import { paginateSections, type MeasuredSection, type PageLayout } from "../lib/paginate"
import { getTemplateStyles, type TemplateStyles } from "../lib/template-styles"
import { parseInlineLinks } from "@/shared/lib/parse-inline-links"
import { parseLinkValue } from "@/shared/lib/url"
import { cn } from "@/shared/lib/utils"
import { normalizeDateString } from "@/shared/lib/normalize-date"
import {
  formatCertificationDateText,
  formatCertificationNames,
  groupCertificationsByOrg,
} from "../services/group-certifications"
import { CustomizerPanel } from "./customizer-panel"

const TEMPLATES = [
  { value: "MINIMAL", label: "Minimal" },
  { value: "MODERN", label: "Modern" },
  { value: "HARVARD", label: "Harvard" },
  { value: "CORPORATE", label: "Corporate" },
] as const

/**
 * Layout, measurement and pagination always run at this fixed A4 box so the
 * page count never depends on the viewport. Narrow containers scale the painted
 * stack down visually instead.
 *
 * These are react-pdf's own A4 points (595.28 × 841.89), used verbatim on both
 * axes. Rounding the width to 595 gave the mirror a 0.28px narrower measure
 * than the export's text column, and rounding the height lost 0.39pt per page —
 * either one is enough to break a line (and then a page) differently from the
 * PDF. The painted page carries its outline outside this box (`ring-1`), so the
 * mirror and every page share the exact same content width.
 */
const PAGE_WIDTH_PX = 595.28
const PAGE_HEIGHT_PX = 841.89
/** Matches the `gap-4` between painted pages; needed for the scaled height math. */
const PAGE_GAP_PX = 16

/**
 * Zoom bounds for the PAINTED stack only — the measurement mirror and
 * `paginateSections` always run at the fixed A4 box above, so nothing here can
 * change where a line or a page breaks. The ceiling stops a very wide pane
 * from rendering a page larger than the screen can usefully show; the floor
 * stops a narrow one from painting an unreadable thumbnail.
 */
const MIN_PREVIEW_SCALE = 0.35
const MAX_PREVIEW_SCALE = 1.6

/**
 * Fit the page width to the pane, fit a whole page, or paint at a fixed
 * multiple of the A4 box. 100% is A4 at 72dpi (595.28px), which is only ~75%
 * of physical A4 on a typical display, so the fixed presets go above 1 —
 * that is what makes the document comfortable to actually read.
 */
type PreviewZoom = "width" | "page" | "actual" | "x125" | "x150"

/**
 * Fixed presets are deliberately NOT clamped by MIN/MAX_PREVIEW_SCALE: the
 * user asked for a literal size, and the scroll container below reaches the
 * whole page at any of them.
 */
const FIXED_ZOOM_SCALES: Partial<Record<PreviewZoom, number>> = {
  actual: 1,
  x125: 1.25,
  x150: 1.5,
}

const ZOOM_OPTIONS: { value: PreviewZoom; label: string; title: string }[] = [
  { value: "width", label: "Fit", title: "Fit page width to the pane" },
  { value: "page", label: "Page", title: "Fit a whole page" },
  { value: "actual", label: "100%", title: "Actual size" },
  { value: "x125", label: "125%", title: "Zoom to 125%" },
  { value: "x150", label: "150%", title: "Zoom to 150%" },
]

const TOOLBAR_BUTTON =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"

// useLayoutEffect is a no-op (and warns) during SSR; fall back to useEffect there.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

function sameMeasured(a: MeasuredSection[], b: MeasuredSection[]): boolean {
  if (a.length !== b.length) return false
  return a.every((section, i) => {
    const other = b[i]
    return (
      section.id === other.id &&
      section.splittable === other.splittable &&
      section.headingHeight === other.headingHeight &&
      section.headingGapPx === other.headingGapPx &&
      section.itemGapPx === other.itemGapPx &&
      section.items.length === other.items.length &&
      section.items.every(
        (item, j) => item.id === other.items[j].id && item.height === other.items[j].height
      )
    )
  })
}

export function ResumePreview() {
  const resume = useResumeStore((s) => s.resume)
  const updateTemplate = useResumeStore((s) => s.updateTemplate)
  const groupAdditional = useResumeStore((s) => s.groupAdditional)
  const groupAdditionalTitle = useResumeStore((s) => s.groupAdditionalTitle)
  const setGroupAdditional = useResumeStore((s) => s.setGroupAdditional)
  const customization = useResumeStore((s) => s.customization)
  const setCustomization = useResumeStore((s) => s.setCustomization)
  const [customizerOpen, setCustomizerOpen] = useState(false)
  const [, startTransition] = useTransition()

  const lastCycleRef = useRef(0)
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null)
  const measureWrapperRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(PAGE_WIDTH_PX)
  /** Drives fit-page only; 0 until measured, which falls back to fit-width. */
  const [paneHeight, setPaneHeight] = useState(0)
  const [zoom, setZoom] = useState<PreviewZoom>("width")
  const [measured, setMeasured] = useState<MeasuredSection[]>([])

  const dense = customization.density === "compact"
  const pageHeightPx = PAGE_HEIGHT_PX
  const styles = useMemo(
    () => getTemplateStyles(resume?.template ?? "MINIMAL", customization),
    [resume?.template, customization]
  )

  // The page shell and the hidden measurement mirror must receive identical
  // typography, otherwise measured heights would not match the painted pages.
  const shellStyle = useMemo(
    () => ({ ...styles.cssVars }) as React.CSSProperties,
    [styles.cssVars]
  )
  const innerStyle = useMemo<React.CSSProperties>(
    () => ({
      padding: styles.paddingPx,
      rowGap: styles.gapPx,
      fontSize: styles.fontSizePx,
      lineHeight: styles.lineHeight,
    }),
    [styles.paddingPx, styles.gapPx, styles.fontSizePx, styles.lineHeight]
  )

  // A section that renders per-item nodes can be split across pages; one that
  // does not (contact header, summary, the combined extras block) is atomic and
  // is measured as a single block.
  const measureLayout = useCallback(() => {
    // The outer container width only drives the visual scale — never pagination.
    if (containerEl) {
      setAvailableWidth(containerEl.offsetWidth)
      // Fit-page needs the height of the scrolling pane, not of the stack
      // inside it, so read the nearest scroll container rather than the
      // container itself (whose height IS the stack).
      const pane = containerEl.closest<HTMLElement>("[data-preview-pane]")
      setPaneHeight(pane ? pane.clientHeight : 0)
    }
    const root = measureWrapperRef.current
    if (!root) return

    const next: MeasuredSection[] = []
    root.querySelectorAll<HTMLElement>("[data-section-id]").forEach((node) => {
      const id = node.dataset.sectionId!
      const itemNodes = Array.from(node.querySelectorAll<HTMLElement>("[data-item-id]"))

      if (itemNodes.length === 0) {
        next.push({
          id,
          splittable: false,
          headingHeight: 0,
          headingGapPx: 0,
          itemGapPx: 0,
          items: [{ id: `${id}::block`, height: node.getBoundingClientRect().height }],
        })
        return
      }

      const headingNode = node.querySelector<HTMLElement>("[data-section-heading]")
      const gapNode = node.querySelector<HTMLElement>("[data-item-gap]")
      next.push({
        id,
        splittable: true,
        headingHeight: headingNode ? headingNode.getBoundingClientRect().height : 0,
        headingGapPx: headingNode ? styles.headingGapPx : 0,
        itemGapPx: gapNode ? Number(gapNode.dataset.itemGap) || 0 : 0,
        items: itemNodes.map((el) => ({
          id: el.dataset.itemId!,
          height: el.getBoundingClientRect().height,
        })),
      })
    })

    setMeasured((prev) => (sameMeasured(prev, next) ? prev : next))
  }, [containerEl, styles.headingGapPx])

  useEffect(() => {
    if (!contentEl && !containerEl) return
    const ro = new ResizeObserver(() => measureLayout())
    if (contentEl) ro.observe(contentEl)
    if (containerEl) ro.observe(containerEl)
    return () => ro.disconnect()
  }, [contentEl, containerEl, measureLayout])

  // Certifications only fold into another section when a visible Skills section
  // exists to host the combined block — otherwise they'd disappear.
  const hasVisibleSkills = resume?.sections.some((s) => s.type === "SKILLS" && s.visible !== false) ?? false

  const layoutSections = useMemo(() => {
    if (!resume) return [] as Section[]
    return resume.sections
      .filter((s) => {
        if (s.visible === false) return false
        if (groupAdditional && hasVisibleSkills && s.type === "CERTIFICATIONS") return false
        return true
      })
      .sort((a, b) => a.order - b.order)
  }, [resume, groupAdditional, hasVisibleSkills])

  // Re-measure synchronously whenever the rendered density/content changes so
  // heights can never lag behind what the measure wrapper is actually showing.
  useIsomorphicLayoutEffect(() => {
    measureLayout()
  }, [measureLayout, dense, styles, groupAdditional, groupAdditionalTitle, layoutSections])

  const isMeasured = measured.length > 0

  const pageLayout = useMemo<PageLayout>(() => {
    if (!isMeasured) {
      return [layoutSections.map((s) => ({ sectionId: s.id, itemIds: [], continued: false }))]
    }
    return paginateSections(measured, {
      pageHeightPx,
      paddingPx: styles.paddingPx,
      sectionGapPx: styles.gapPx,
    })
  }, [isMeasured, measured, layoutSections, pageHeightPx, styles.paddingPx, styles.gapPx])

  // Pages are always laid out at PAGE_WIDTH_PX; a narrower container shrinks them
  // visually. `transform: scale` leaves the layout box unscaled, so the wrapper
  // gets the scaled height explicitly to avoid trailing whitespace.
  // Zoom is a VIEWING preference and deliberately does NOT live in
  // `customization`: that object is fed to the PDF export, so a zoom value
  // there would change the produced file. Local state only.
  //
  // The old rule was `Math.min(1, …)`, which could shrink the page but never
  // grow it — so once the workspace went full-bleed the document still painted
  // at 595px inside an 840px pane and simply wasted the rest. Fit-width may now
  // exceed 1. The cap keeps a very wide pane from blowing the type up past the
  // point where a page still reads as a page.
  const fitWidthScale = availableWidth > 0 ? availableWidth / PAGE_WIDTH_PX : 1
  const fitPageScale =
    paneHeight > 0 ? Math.min(fitWidthScale, paneHeight / PAGE_HEIGHT_PX) : fitWidthScale
  const previewScale =
    FIXED_ZOOM_SCALES[zoom] ??
    (zoom === "page"
      ? Math.max(MIN_PREVIEW_SCALE, Math.min(MAX_PREVIEW_SCALE, fitPageScale))
      : Math.max(MIN_PREVIEW_SCALE, Math.min(MAX_PREVIEW_SCALE, fitWidthScale)))
  const stackHeightPx =
    pageLayout.length * PAGE_HEIGHT_PX + Math.max(0, pageLayout.length - 1) * PAGE_GAP_PX
  /**
   * The scaled page's real horizontal extent. `transform: scale` never changes
   * a layout box, so this is what the sizing wrapper below must carry for the
   * scroll container to see the overflow at all.
   */
  const scaledStackWidthPx = PAGE_WIDTH_PX * previewScale
  /**
   * `justify-center` cannot be used while the page is wider than the pane:
   * flexbox centring pushes the item's start edge to a negative offset that no
   * scroll position can reach, which is exactly how the left half of the page
   * became unreachable in the mobile sheet at 100%.
   */
  const pageOverflowsPane = availableWidth > 0 && scaledStackWidthPx > availableWidth
  /**
   * Rounded UP only while the page overflows: `scrollWidth` is an integer, so a
   * fractional extent (595.28 at 100%) leaves its last fraction of a pixel
   * unreachable. Rounding unconditionally could instead invent a 1px overflow
   * in the fitting modes, where the width is already exactly the pane's.
   */
  const wrapperWidthPx = pageOverflowsPane ? Math.ceil(scaledStackWidthPx) : scaledStackWidthPx

  const cycleTemplate = useCallback(
    (direction: -1 | 1) => {
      if (!resume) return

      const currentIndex = TEMPLATES.findIndex(
        (template) => template.value === resume.template
      )
      const safeIndex = currentIndex === -1 ? 0 : currentIndex
      const nextIndex =
        (safeIndex + direction + TEMPLATES.length) % TEMPLATES.length
      const template = TEMPLATES[nextIndex].value

      updateTemplate(template)
      startTransition(async () => {
        await updateResume(resume.id, { template })
      })
    },
    [resume, updateTemplate]
  )

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        event.repeat ||
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return

      const now = Date.now()
      if (now - lastCycleRef.current < 250) return
      lastCycleRef.current = now
      event.preventDefault()
      cycleTemplate(event.key === "ArrowLeft" ? -1 : 1)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [cycleTemplate])

  if (!resume) return null

  const currentIndex = TEMPLATES.findIndex(
    (template) => template.value === resume.template
  )
  const currentTemplate = TEMPLATES[currentIndex === -1 ? 0 : currentIndex]

  const certSection = groupAdditional
    ? resume.sections.find((s) => s.type === "CERTIFICATIONS" && s.visible !== false)
    : undefined

  return (
    <div className="space-y-3">
      {/* Sticky inside the preview pane so template/zoom stay reachable while
          scrolling a multi-page document, instead of consuming editor height
          (spec section 3 + 11). `-top-4 xl:-top-6` cancels the pane's own
          padding so the bar parks flush against the top of the scroll area.

          `z-10`, deliberately NOT `--z-sticky`: this is subordinate chrome
          inside one pane, and it only has to outrank the painted pages (which
          are z-auto). Giving it the app-level sticky tier made it a PEER of the
          editor toolbar — both resolved to 30, so DOM order decided, and this
          bar (later in the tree) painted over the toolbar's open Export menu.
          A menu's own z-60 cannot rescue it there: it is scoped inside the
          toolbar's stacking context, so it can never outrank a sibling one. */}
      <div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border bg-muted/95 px-4 py-2 backdrop-blur-sm xl:-top-6 xl:-mx-6 xl:-mt-6 xl:px-6">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => cycleTemplate(-1)}
            className={TOOLBAR_BUTTON}
            title="Previous template (←)"
            aria-label="Show previous resume template"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="min-w-0 text-center leading-tight" aria-live="polite">
            <p className="truncate text-xs font-semibold text-foreground">
              {currentTemplate.label}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {currentIndex === -1 ? 1 : currentIndex + 1}/{TEMPLATES.length}
            </p>
          </div>

          <button
            type="button"
            onClick={() => cycleTemplate(1)}
            className={TOOLBAR_BUTTON}
            title="Next template (→)"
            aria-label="Show next resume template"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* `flex-wrap`: with five zoom presets this group no longer fits one
            line in the mobile sheet (335px of usable toolbar), and an
            unwrapped row pushed the page counter out of sight. */}
        <div className="relative flex flex-wrap items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setCustomization({ density: dense ? "normal" : "compact" })}
            title={dense ? "Switch to spacious spacing" : "Switch to compact spacing"}
            aria-label={dense ? "Switch to spacious spacing" : "Switch to compact spacing"}
            aria-pressed={dense}
            className={cn(TOOLBAR_BUTTON, dense && "bg-accent text-accent-foreground")}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCustomizerOpen((open) => !open)}
            data-customizer-trigger
            title="Customize appearance"
            aria-label="Customize appearance"
            aria-expanded={customizerOpen}
            className={cn(TOOLBAR_BUTTON, customizerOpen && "bg-accent text-accent-foreground")}
          >
            <Settings2 className="h-4 w-4" />
          </button>
          {customizerOpen && <CustomizerPanel onClose={() => setCustomizerOpen(false)} />}
          <button
            type="button"
            onClick={() => setGroupAdditional(!groupAdditional)}
            title={groupAdditional ? "Show separate sections" : "Combine Skills & Certifications"}
            aria-label={groupAdditional ? "Show separate sections" : "Combine Skills & Certifications"}
            aria-pressed={groupAdditional}
            className={cn(TOOLBAR_BUTTON, groupAdditional && "bg-accent text-accent-foreground")}
          >
            <Layers className="h-4 w-4" />
          </button>

          <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />

          {/* Zoom affects only the painted stack — never the mirror, so the
              page count below cannot move when it changes. */}
          <div className="flex items-center gap-0.5" role="group" aria-label="Preview zoom">
            {ZOOM_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setZoom(option.value)}
                title={option.title}
                aria-label={option.title}
                aria-pressed={zoom === option.value}
                className={cn(
                  TOOLBAR_BUTTON,
                  "w-auto px-1.5 text-[11px] font-medium",
                  zoom === option.value && "bg-accent text-accent-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <span className="ml-1 inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <FileText className="h-3 w-3" aria-hidden="true" />
            {pageLayout.length} {pageLayout.length === 1 ? "page" : "pages"}
          </span>
        </div>
      </div>

      {/* No width cap any more: the container measures the pane, and the pane
          is now half a full-bleed workspace rather than half of a 1152px
          column. Centred while the page fits, start-aligned once it does not
          (see `pageOverflowsPane`).

          This is also the horizontal scroll container. It has to live here
          rather than on the pane outside: below `xl` the preview's ancestor is
          the Drawer panel (`overflow-y-auto` only, and the sheet must keep
          owning vertical scroll), so at 100%+ zoom neither edge of the page
          could be reached. `overflow-x-auto` makes the y axis compute to
          `auto` too, but this box is content-height so it never gains a
          vertical scrollbar of its own — the pane/sheet still owns that
          axis. */}
      <div
        ref={setContainerEl}
        data-preview-scroll
        className={cn(
          "relative flex w-full overflow-x-auto",
          pageOverflowsPane ? "justify-start" : "justify-center"
        )}
      >
        {/* The mirror is pinned to the A4 width so measured heights always match
            the painted pages. Its 0-sized clipping host keeps the invisible
            595px block from creating overflow on narrow viewports; CSS vars still
            reach the shell below through shellStyle. */}
        <div
          className="pointer-events-none absolute top-0 left-0 h-0 w-0 overflow-hidden"
          aria-hidden="true"
        >
          <div
            ref={measureWrapperRef}
            className="invisible select-none"
            style={{ width: PAGE_WIDTH_PX }}
          >
            <div className={`resume-surface ${styles.wrapper}`} style={shellStyle}>
              <div ref={setContentEl} className="flex flex-col" style={innerStyle}>
                {layoutSections.map((section) => (
                  <div key={section.id} data-section-id={section.id}>
                    <PreviewSection
                      section={section}
                      styles={styles}
                      groupAdditional={groupAdditional}
                      groupAdditionalTitle={groupAdditionalTitle}
                      certSection={certSection}
                      hasVisibleSkills={hasVisibleSkills}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Sizing wrapper: `transform: scale` leaves the layout box at the
            unscaled A4 width/height, so the scroll container above would see
            no overflow to scroll (and a shrinkable flex item would be squashed
            instead). Carrying BOTH scaled dimensions here — plus `shrink-0` —
            is what gives the scroll container the page's true extent. */}
        <div
          className="shrink-0"
          style={{ width: wrapperWidthPx, height: stackHeightPx * previewScale }}
        >
          <div
            className="flex select-none flex-col gap-4"
            style={{
              width: PAGE_WIDTH_PX,
              // Applied at any scale now, not just below 1 — the transform
              // leaves the layout box at PAGE_WIDTH_PX, which is why the
              // wrapper above carries the scaled size explicitly.
              // `top left`, not `top center`: the wrapper is exactly the
              // scaled width, so any other origin would push the painted page
              // outside its own box (unreachably, once it overflows).
              ...(previewScale !== 1
                ? { transform: `scale(${previewScale})`, transformOrigin: "top left" }
                : null),
            }}
          >
            {pageLayout.map((slices, i) => (
              <div
                key={i}
                // `ring-1` instead of a border: a border sits *inside* the
                // border box and would shrink the painted content column 2px
                // below the mirror's, breaking lines the export does not.
                // `resume-surface` opts the document's h1/h2 out of the app's
                // display face so the preview matches the PDF export.
                className={`resume-surface overflow-hidden text-black rounded-sm shadow-lg ring-1 ring-gray-200 ${styles.wrapper}`}
                style={{ ...shellStyle, height: pageHeightPx }}
                {...(i > 0 ? { "aria-label": `Page ${i + 1}` } : {})}
              >
                <div className="flex flex-col" style={innerStyle}>
                  {slices.map((slice, j) => {
                    const section = resume.sections.find((s) => s.id === slice.sectionId)
                    if (!section) return null
                    return (
                      <PreviewSection
                        key={`${slice.sectionId}-${j}`}
                        section={section}
                        styles={styles}
                        itemIds={isMeasured ? slice.itemIds : undefined}
                        continued={slice.continued}
                        groupAdditional={groupAdditional}
                        groupAdditionalTitle={groupAdditionalTitle}
                        certSection={certSection}
                        hasVisibleSkills={hasVisibleSkills}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function PreviewSection({
  section,
  styles,
  itemIds,
  continued,
  groupAdditional,
  groupAdditionalTitle,
  certSection,
  hasVisibleSkills,
}: {
  section: Section
  styles: TemplateStyles
  itemIds?: string[]
  continued?: boolean
  groupAdditional?: boolean
  groupAdditionalTitle?: string
  certSection?: Section
  hasVisibleSkills?: boolean
}) {
  switch (section.type) {
    case "CONTACT":
      return <ContactPreview section={section} styles={styles} />
    case "SUMMARY":
      return <SummaryPreview section={section} styles={styles} />
    case "EXPERIENCE":
      return <ExperiencePreview section={section} styles={styles} itemIds={itemIds} continued={continued} />
    case "EDUCATION":
      return <EducationPreview section={section} styles={styles} itemIds={itemIds} continued={continued} />
    case "SKILLS":
      if (groupAdditional && certSection) {
        return (
          <CombinedAdditionalPreview
            skillsSection={section}
            certSection={certSection}
            styles={styles}
            title={groupAdditionalTitle ?? "Additional Information"}
          />
        )
      }
      return <SkillsPreview section={section} styles={styles} itemIds={itemIds} continued={continued} />
    case "CERTIFICATIONS":
      if (groupAdditional) {
        // No visible Skills section to host the combined block — render it here
        // so grouped certifications stay visible.
        if (hasVisibleSkills) return null
        return (
          <CombinedAdditionalPreview
            certSection={section}
            styles={styles}
            title={groupAdditionalTitle ?? "Additional Information"}
          />
        )
      }
      return <CertificationsPreview section={section} styles={styles} itemIds={itemIds} continued={continued} />
    case "PROJECTS":
      return <ProjectsPreview section={section} styles={styles} itemIds={itemIds} continued={continued} />
    case "CUSTOM":
      return <CustomPreview section={section} styles={styles} itemIds={itemIds} continued={continued} />
    default:
      return null
  }
}

interface PreviewProps {
  section: Section
  styles: TemplateStyles
  /** When present, only these item ids render (one page's slice of the section). */
  itemIds?: string[]
  /** True when the section started on an earlier page. */
  continued?: boolean
}

function filterItems<T extends { id: string }>(items: T[], itemIds?: string[]): T[] {
  if (!itemIds) return items
  const allowed = new Set(itemIds)
  return items.filter((item) => allowed.has(item.id))
}

/**
 * Heading + item stack for a splittable section. Gaps are explicit numbers so
 * the pagination math and the painted layout use the exact same values, and the
 * heading/item nodes carry the data attributes the measure pass reads.
 *
 * Continuation slices render *without* a heading: react-pdf never clones a
 * section heading when it splits a block across pages, so repeating it here
 * (and charging its height in `paginate.ts`) made the preview spend a heading
 * the export does not.
 */
function SectionBlock({
  styles,
  title,
  continued,
  itemGapPx,
  children,
}: {
  styles: TemplateStyles
  title: string
  continued?: boolean
  itemGapPx: number
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col" style={{ rowGap: styles.headingGapPx }}>
      {!continued && <PreviewHeading styles={styles} title={title} measured />}
      <div className="flex flex-col" style={{ rowGap: itemGapPx }} data-item-gap={itemGapPx}>
        {children}
      </div>
    </div>
  )
}

/**
 * Section heading for every template. MODERN trades the full-width rule for a
 * short accent bar; the other templates carry their rule/chip decoration on the
 * heading class itself. `measured` marks the node the measure pass reads a
 * height from — atomic sections (Summary, the combined block) omit it.
 */
function PreviewHeading({
  styles,
  title,
  measured,
}: {
  styles: TemplateStyles
  title: string
  measured?: boolean
}) {
  return (
    <h2
      className={styles.heading}
      style={{ fontSize: styles.headingSizePx }}
      {...(measured ? { "data-section-heading": "" } : {})}
    >
      {styles.layout.heading === "accent-bar" && (
        <span
          aria-hidden="true"
          data-accent-bar=""
          className="inline-block h-[2px] w-5 shrink-0 bg-[color:var(--resume-heading)]"
        />
      )}
      <span>{title}</span>
    </h2>
  )
}

/**
 * Meta text — dates, locations, technologies, credential IDs. The PDF derives
 * these as `body - 1` (`primitives.tsx`), so the preview does too; a hardcoded
 * `text-[10px]` only agreed at the default body size and drifted the moment a
 * density or font scale moved it.
 */
function metaText(styles: TemplateStyles): React.CSSProperties {
  return { fontSize: styles.fontSizePx - 1 }
}

/** Sub-labels inside the combined extras block — `body - 2` on both sides. */
function subLabelText(styles: TemplateStyles): React.CSSProperties {
  return { fontSize: styles.fontSizePx - 2 }
}

function BulletList({ bullets, styles }: { bullets: string[]; styles: TemplateStyles }) {
  const visible = bullets.filter((b) => b.trim())
  if (visible.length === 0) return null
  return (
    <ul className="list-disc pl-4" style={{ marginTop: styles.bulletTopPx }}>
      {visible.map((bullet, idx) => (
        <li
          key={idx}
          className="text-gray-700"
          style={{ textAlign: styles.textAlign, ...(idx > 0 ? { marginTop: styles.bulletGapPx } : null) }}
        >
          {parseInlineLinks(bullet)}
        </li>
      ))}
    </ul>
  )
}

interface ContactDetail {
  label: string
  /** Absolute href (mailto:/tel:/https:) or an empty string for plain text. */
  href: string
  /** Off-site links open in a new tab; mailto:/tel: do not. */
  external?: boolean
}

function ContactPreview({ section, styles }: PreviewProps) {
  const item = section.items[0]
  if (!item) return <div className="text-center text-gray-400 text-xs">Add your contact information</div>

  const c = item.content as Record<string, string>
  const hasContent = c.fullName || c.email || c.phone

  if (!hasContent) return <div className="text-center text-gray-400 text-xs">Add your contact information</div>

  const layout = styles.layout.header
  const centered = layout === "centered"

  // Same list, order and `·` separator the export's ContactHeader emits, so a
  // detail line reads identically in both render trees.
  const details: ContactDetail[] = [
    c.email ? { label: c.email, href: `mailto:${c.email}` } : null,
    c.phone ? { label: c.phone, href: `tel:${c.phone.replace(/[^\d+]/g, "")}` } : null,
    c.location ? { label: c.location, href: "" } : null,
    ...[c.linkedin, c.github, c.website].map((raw) => {
      if (!raw) return null
      const { label, href } = parseLinkValue(raw)
      return label ? { label, href, external: true } : null
    }),
  ].filter((detail): detail is ContactDetail => Boolean(detail))

  const block = (
    <>
      {c.fullName && (
        <h1 className={styles.name}>
          {c.fullName}
        </h1>
      )}
      {/* Size and line box come from the resolved tokens (body + 1, same
          unitless line height) so the export's job-title line matches;
          `text-xs` pinned it to a 12/16px box the PDF cannot reproduce. */}
      {c.jobTitle && (
        <p
          className={`font-medium mt-0.5 ${styles.accent}`}
          style={{ fontSize: styles.fontSizePx + 1, lineHeight: styles.lineHeight }}
        >
          {c.jobTitle}
        </p>
      )}
      {/* 4px between details plus the separator's own 4px margins reproduces
          the export's `gap: 4` + `marginHorizontal: 4`; `gap-y-1` is that same
          `gap: 4` on the cross axis, so a wrapped detail line measures what the
          PDF renders. The separator rides inside its detail's wrapper so
          wrapping can never orphan a `·` at the start of a line. */}
      <div
        className={cn(
          "mt-1 flex flex-wrap items-center gap-x-1 gap-y-1",
          centered && "justify-center",
          styles.accent
        )}
      >
        {details.map((detail, idx) => (
          <span key={idx} className="inline-flex items-center">
            {idx > 0 && (
              <span aria-hidden="true" className="mx-1">
                ·
              </span>
            )}
            {detail.href ? (
              <a
                href={detail.href}
                className="underline hover:opacity-75"
                {...(detail.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                {detail.label}
              </a>
            ) : (
              <span>{detail.label}</span>
            )}
          </span>
        ))}
      </div>
    </>
  )

  return (
    <div
      data-contact-layout={layout}
      className={cn(
        centered ? "text-center" : "text-left",
        layout === "accent-bar" && "flex items-stretch gap-3",
        layout === "banner"
          ? "border-b-2 border-[color:var(--resume-name)]"
          : layout !== "accent-bar" && "border-b border-gray-200"
      )}
      style={{ paddingBottom: styles.contactPadPx }}
    >
      {layout === "accent-bar" && (
        <span
          aria-hidden="true"
          data-accent-bar=""
          className="w-1 shrink-0 rounded-full bg-[color:var(--resume-name)]"
        />
      )}
      <div className={layout === "accent-bar" ? "min-w-0 flex-1" : undefined}>{block}</div>
    </div>
  )
}

function SummaryPreview({ section, styles }: PreviewProps) {
  const item = section.items[0]
  const text = (item?.content as { text?: string })?.text

  if (!text) return null

  return (
    <div className="flex flex-col" style={{ rowGap: styles.headingGapPx }}>
      <PreviewHeading styles={styles} title="Summary" />
      <p className="text-gray-700" style={{ textAlign: styles.textAlign }}>
        {parseInlineLinks(text)}
      </p>
    </div>
  )
}

function ExperiencePreview({ section, styles, itemIds, continued }: PreviewProps) {
  const items = filterItems(section.items, itemIds)
  if (items.length === 0) return null

  return (
    <SectionBlock styles={styles} title="Experience" continued={continued} itemGapPx={styles.itemGapPx}>
      {items.map((item) => {
        const c = item.content as {
          company?: string
          role?: string
          location?: string
          startDate?: string
          endDate?: string
          current?: boolean
          bullets?: string[]
        }
        return (
          <div key={item.id} data-item-id={item.id}>
            <ExperienceEntry content={c} styles={styles} />
            {c.bullets && <BulletList bullets={c.bullets} styles={styles} />}
          </div>
        )
      })}
    </SectionBlock>
  )
}

interface ExperienceContent {
  company?: string
  role?: string
  location?: string
  startDate?: string
  endDate?: string
  current?: boolean
}

/** Header lines of one Experience entry, arranged per template identity. */
function ExperienceEntry({
  content: c,
  styles,
}: {
  content: ExperienceContent
  styles: TemplateStyles
}) {
  const dates = (
    <span className="text-gray-500 shrink-0 ml-2" style={metaText(styles)}>
      {normalizeDateString(c.startDate)}
      {(c.startDate || c.endDate || c.current) && " – "}
      {c.current ? "Present" : normalizeDateString(c.endDate)}
    </span>
  )

  switch (styles.layout.entry) {
    // Classic academic block: organisation over an italic role, dates on the right.
    case "academic":
      return (
        <div data-entry-layout="academic">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold text-gray-900">{c.company || c.role || "Company"}</span>
            {c.location && <span className="text-gray-500 shrink-0 ml-2" style={metaText(styles)}>{c.location}</span>}
          </div>
          <div className="flex items-baseline justify-between">
            <span className="italic text-gray-700">{c.role || "Role"}</span>
            {dates}
          </div>
        </div>
      )
    case "accent-role":
      return (
        <div data-entry-layout="accent-role">
          <div className="flex items-baseline justify-between">
            <div>
              <span className="font-bold text-[color:var(--resume-heading)]">{c.role || "Role"}</span>
              {c.company && <span className="text-gray-700"> · {c.company}</span>}
            </div>
            {dates}
          </div>
          {c.location && <div className="text-gray-500" style={metaText(styles)}>{c.location}</div>}
        </div>
      )
    case "structured":
      return (
        <div data-entry-layout="structured">
          <div className="flex items-baseline justify-between">
            <span className="font-bold uppercase tracking-wide text-gray-900">{c.role || "Role"}</span>
            {dates}
          </div>
          {(c.company || c.location) && (
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-gray-600">{c.company}</span>
              {c.location && <span className="text-gray-500 shrink-0 ml-2" style={metaText(styles)}>{c.location}</span>}
            </div>
          )}
        </div>
      )
    default:
      return (
        <div data-entry-layout="single-line">
          <div className="flex items-baseline justify-between">
            <div>
              <span className="font-semibold text-gray-900">{c.role || "Role"}</span>
              {c.company && <span className="text-gray-600"> — {c.company}</span>}
            </div>
            {dates}
          </div>
          {c.location && <div className="text-gray-500" style={metaText(styles)}>{c.location}</div>}
        </div>
      )
  }
}

function EducationPreview({ section, styles, itemIds, continued }: PreviewProps) {
  const items = filterItems(section.items, itemIds)
  if (items.length === 0) return null

  return (
    <SectionBlock styles={styles} title="Education" continued={continued} itemGapPx={styles.listGapPx}>
      {items.map((item) => {
        const c = item.content as {
          school?: string
          degree?: string
          field?: string
          startDate?: string
          endDate?: string
          gpa?: string
        }
        return (
          <div key={item.id} data-item-id={item.id} className="flex items-baseline justify-between">
            <div>
              <span className="font-semibold text-gray-900">
                {c.degree && c.field ? `${c.degree} in ${c.field}` : c.degree || c.field || "Degree"}
              </span>
              {c.school && (
                <span className="text-gray-600"> — {c.school}</span>
              )}
              {c.gpa && (
                <span className="text-gray-500"> (GPA: {c.gpa})</span>
              )}
            </div>
            <span className="text-gray-500 shrink-0 ml-2" style={metaText(styles)}>
              {normalizeDateString(c.startDate)}
              {(c.startDate || c.endDate) && " – "}
              {normalizeDateString(c.endDate)}
            </span>
          </div>
        )
      })}
    </SectionBlock>
  )
}

function SkillsPreview({ section, styles, itemIds, continued }: PreviewProps) {
  const items = filterItems(section.items, itemIds).filter((item) => {
    const c = item.content as { skills?: string[] }
    return c.skills && c.skills.length > 0
  })

  if (items.length === 0) return null

  return (
    <SectionBlock styles={styles} title="Skills" continued={continued} itemGapPx={styles.skillGapPx}>
      {items.map((item) => {
        const c = item.content as { category?: string; skills?: string[] }
        return (
          <div key={item.id} data-item-id={item.id}>
            <SkillCategory category={c.category} skills={c.skills!} styles={styles} />
          </div>
        )
      })}
    </SectionBlock>
  )
}

/**
 * One skill category. The arrangement is the template's, but it always stays
 * inside a single measured item so pagination keeps working.
 */
function SkillCategory({
  category,
  skills,
  styles,
}: {
  category?: string
  skills: string[]
  styles: TemplateStyles
}) {
  switch (styles.layout.skills) {
    case "pills":
      return (
        <>
          {category && <span className="font-semibold text-gray-900">{category}</span>}
          <div className="mt-0.5 flex flex-wrap gap-1" data-skill-pills="">
            {skills.map((skill) => (
              <span
                key={skill}
                data-skill-pill=""
                className="rounded-full border border-[color:var(--resume-border)] bg-[color:var(--resume-heading-bg)] px-2 py-px leading-snug text-gray-700"
              >
                {skill}
              </span>
            ))}
          </div>
        </>
      )
    case "grid":
      return (
        <>
          {category && (
            <span className="font-semibold uppercase tracking-wide text-gray-900">{category}</span>
          )}
          <div className="mt-0.5 grid grid-cols-2 gap-x-4 gap-y-0.5" data-skill-grid="">
            {skills.map((skill) => (
              <span key={skill} className="text-gray-700">
                {skill}
              </span>
            ))}
          </div>
        </>
      )
    case "lines":
      return (
        <>
          {category && <div className="font-semibold text-gray-900">{category}</div>}
          <div className="text-gray-700">{skills.join(", ")}</div>
        </>
      )
    default:
      return (
        <>
          {category && <span className="font-semibold text-gray-900">{category}: </span>}
          <span className="text-gray-700">{skills.join(", ")}</span>
        </>
      )
  }
}

function ProjectsPreview({ section, styles, itemIds, continued }: PreviewProps) {
  const items = filterItems(section.items, itemIds).filter((item) => {
    const c = item.content as { name?: string; bullets?: string[] }
    return c.name || c.bullets?.some((b) => b.trim())
  })

  if (items.length === 0) return null

  return (
    <SectionBlock styles={styles} title="Projects" continued={continued} itemGapPx={styles.itemGapPx}>
      {items.map((item) => {
        const c = item.content as {
          name?: string
          bullets?: string[]
          technologies?: string[]
          url?: string
          urlLabel?: string
          startDate?: string
          endDate?: string
        }
        return (
          <div key={item.id} data-item-id={item.id}>
            <div className="flex items-baseline justify-between">
              <div>
                <span className="inline-flex items-baseline gap-1.5">
                  <span className="font-semibold text-gray-900">{c.name || "Project"}</span>
                  {c.url && c.urlLabel && (
                    <a
                      href={/^https?:\/\//i.test(c.url) ? c.url : `https://${c.url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 underline hover:text-gray-700 transition-colors"
                      style={metaText(styles)}
                    >
                      {c.urlLabel}
                    </a>
                  )}
                </span>
              </div>
              {(c.startDate || c.endDate) && (
                <span className="text-gray-500 shrink-0 ml-2" style={metaText(styles)}>
                  {normalizeDateString(c.startDate)}
                  {(c.startDate || c.endDate) && " – "}
                  {normalizeDateString(c.endDate)}
                </span>
              )}
            </div>
            {c.technologies && c.technologies.length > 0 && (
              <div className="text-gray-500" style={metaText(styles)}>
                {c.technologies.join(" · ")}
              </div>
            )}
            {c.bullets && <BulletList bullets={c.bullets} styles={styles} />}
          </div>
        )
      })}
    </SectionBlock>
  )
}

const normalizeCertDate = (value: string) => normalizeDateString(value) ?? value

function CertificationsPreview({ section, styles, itemIds, continued }: PreviewProps) {
  if (section.items.length === 0) return null

  // Grouping happens before slicing, so a group is keyed (and paginated) by its
  // first certification's id.
  const groups = groupCertificationsByOrg(section.items).filter((group) =>
    itemIds ? itemIds.includes(group.certs[0].id) : true
  )

  if (groups.length === 0) return null

  return (
    <SectionBlock styles={styles} title="Certifications" continued={continued} itemGapPx={styles.certGapPx}>
      {groups.map((group) => {
        if (group.certs.length === 1) {
          const { id, content: c } = group.certs[0]
          const dateText = formatCertificationDateText(c, normalizeCertDate)
          return (
            <div key={id} data-item-id={id} className="flex items-baseline justify-between">
              <div>
                <span className="font-semibold text-gray-900">
                  {c.name || "Certification"}
                </span>
                {c.organization && (
                  <span className="text-gray-600"> — {c.organization}</span>
                )}
                {c.credentialId && (
                  <span className="text-gray-500 ml-1" style={metaText(styles)}>
                    (ID: {c.credentialId})
                  </span>
                )}
              </div>
              {dateText && (
                <span className="text-gray-500 shrink-0 ml-2" style={metaText(styles)}>{dateText}</span>
              )}
            </div>
          )
        }
        // Compact grouped line: OrgName: Cert1, Cert2
        return (
          <div
            key={group.certs[0].id}
            data-item-id={group.certs[0].id}
            className="flex items-baseline justify-between"
          >
            <div>
              <span className="font-semibold text-gray-900">{group.organization}</span>
              <span className="text-gray-600">: {formatCertificationNames(group.certs)}</span>
            </div>
            {group.dateRange && (
              <span className="text-gray-500 shrink-0 ml-2" style={metaText(styles)}>{group.dateRange}</span>
            )}
          </div>
        )
      })}
    </SectionBlock>
  )
}

function CustomPreview({ section, styles, itemIds, continued }: PreviewProps) {
  const items = filterItems(section.items, itemIds).filter((item) => {
    const c = item.content as { title?: string; content?: string }
    return c.title || c.content
  })

  if (items.length === 0) return null

  return (
    <SectionBlock styles={styles} title={section.title} continued={continued} itemGapPx={styles.listGapPx}>
      {items.map((item) => {
        const c = item.content as { title?: string; content?: string }
        return (
          <div key={item.id} data-item-id={item.id}>
            {c.title && (
              <span className="font-semibold text-gray-900">{c.title}</span>
            )}
            {c.content && (
              <p className="text-gray-700 whitespace-pre-line" style={{ textAlign: styles.textAlign }}>
                {parseInlineLinks(c.content)}
              </p>
            )}
          </div>
        )
      })}
    </SectionBlock>
  )
}

function CombinedAdditionalPreview({
  skillsSection,
  certSection,
  styles,
  title,
}: {
  skillsSection?: Section
  certSection: Section
  styles: TemplateStyles
  title: string
}) {
  const skillItems = skillsSection?.items ?? []
  const hasSkills = skillItems.some((item) => {
    const c = item.content as { skills?: string[] }
    return c.skills && c.skills.length > 0
  })
  const certGroups = groupCertificationsByOrg(certSection.items)
  const hasCerts = certGroups.length > 0

  if (!hasSkills && !hasCerts) return null

  return (
    <div className="flex flex-col" style={{ rowGap: styles.headingGapPx }}>
      <PreviewHeading styles={styles} title={title} />
      <div className="flex flex-col" style={{ rowGap: styles.skillGapPx }}>
        {hasSkills && (
          <p className="font-semibold uppercase tracking-wider text-gray-400" style={subLabelText(styles)}>Skills</p>
        )}
        {skillItems.map((item) => {
          const c = item.content as { category?: string; skills?: string[] }
          if (!c.skills || c.skills.length === 0) return null
          return (
            <div key={item.id} className="flex gap-1">
              {c.category && <span className="text-gray-600 shrink-0">{c.category}:</span>}
              <span className="text-gray-700">{c.skills.join(", ")}</span>
            </div>
          )
        })}
        {hasCerts && (
          <p className="font-semibold uppercase tracking-wider text-gray-400 mt-1" style={subLabelText(styles)}>Certifications</p>
        )}
        {certGroups.map((group) => {
          if (group.certs.length === 1) {
            const { id, content: c } = group.certs[0]
            const dateText = formatCertificationDateText(c, normalizeCertDate)
            return (
              <div key={id} className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-1">
                  <span className="text-gray-400 text-[10px]">•</span>
                  <span className="text-gray-700">{c.name || "Certification"}</span>
                  {c.organization && <span className="text-gray-500"> — {c.organization}</span>}
                </div>
                {dateText && (
                  <span className="text-gray-500 shrink-0 ml-2" style={metaText(styles)}>{dateText}</span>
                )}
              </div>
            )
          }
          return (
            <div key={group.certs[0].id} className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-1">
                <span className="text-gray-400 text-[10px]">•</span>
                <span className="text-gray-700 font-medium">{group.organization}:</span>
                <span className="text-gray-600">{formatCertificationNames(group.certs)}</span>
              </div>
              {group.dateRange && (
                <span className="text-gray-500 shrink-0 ml-2" style={metaText(styles)}>{group.dateRange}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
