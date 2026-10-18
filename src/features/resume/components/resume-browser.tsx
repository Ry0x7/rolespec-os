"use client"

import { useRef, useState } from "react"
import { Pagination } from "@/shared/ui/pagination"
import { SegmentedControl } from "@/shared/ui/segmented-control"
import { usePagedList } from "@/shared/hooks/use-paged-list"
import { ResumeCard } from "./resume-card"
import {
  RESUME_VARIANT_SECTIONS,
  groupByRoleFamilyName,
  type ResumeCardData,
  type ResumeVariant,
} from "./resume-sections"

export const RESUME_PAGE_SIZE = 12

type ResumeFilter = "all" | ResumeVariant

/**
 * Client-side browser over the (already user-scoped, updatedAt desc) resume
 * list: one variant filter and a bounded, paged grid instead of three stacked,
 * unbounded sections. Under "All" the page's cards are still grouped under
 * their variant heading, and role-family cards under their family name when
 * more than one family exists.
 */
export function ResumeBrowser({ resumes }: { resumes: ResumeCardData[] }) {
  const [filter, setFilter] = useState<ResumeFilter>("all")

  // Group order first (Master, Role family by family, Job-tailored), so a page
  // of All reads as consecutive groups.
  const byVariant = RESUME_VARIANT_SECTIONS.map((section) => {
    const items = resumes.filter((resume) => resume.variant === section.variant)
    return {
      ...section,
      items:
        section.variant === "ROLE_FAMILY"
          ? groupByRoleFamilyName(items).flatMap((group) => group.resumes)
          : items,
    }
  })
  const present = byVariant.filter((section) => section.items.length > 0)
  const hasMaster = byVariant.some(
    (section) => section.variant === "MASTER" && section.items.length > 0
  )
  const showFamilySubheadings =
    groupByRoleFamilyName(
      resumes.filter((resume) => resume.variant === "ROLE_FAMILY")
    ).length > 1

  // A variant that loses its last resume loses its option, so fall back to All
  // rather than showing an empty, unselectable filter.
  const activeFilter: ResumeFilter =
    filter !== "all" && !present.some((section) => section.variant === filter)
      ? "all"
      : filter
  const ordered = byVariant.flatMap((section) => section.items)
  const filtered =
    activeFilter === "all"
      ? ordered
      : ordered.filter((resume) => resume.variant === activeFilter)
  const paged = usePagedList(filtered, {
    pageSize: RESUME_PAGE_SIZE,
    resetKey: activeFilter,
  })

  const gridRef = useRef<HTMLDivElement>(null)

  // Bring the top of the grid back into view only when the user has scrolled
  // past it; a pager click near the top leaves the window where it is.
  function handlePageChange(nextPage: number) {
    paged.setPage(nextPage)
    const grid = gridRef.current
    if (grid && grid.getBoundingClientRect().top < 0) {
      grid.scrollIntoView({ block: "start" })
    }
  }

  const pageGroups = byVariant
    .map((section) => ({
      ...section,
      items: paged.pageItems.filter((resume) => resume.variant === section.variant),
    }))
    .filter((section) => section.items.length > 0)

  // The old per-section empty hints, kept for the All view: master always,
  // the derived tiers only once a master exists to derive them from.
  const emptyHints =
    activeFilter === "all"
      ? byVariant.filter(
          (section) =>
            section.items.length === 0 &&
            (section.variant === "MASTER" || hasMaster)
        )
      : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Filter resumes by type"
          value={activeFilter}
          onChange={setFilter}
          options={[
            { value: "all" as ResumeFilter, label: "All", count: resumes.length },
            ...present.map((section) => ({
              value: section.variant as ResumeFilter,
              label: section.title,
              count: section.items.length,
            })),
          ]}
        />
        {paged.total > 0 && (
          <p className="text-xs tabular-nums text-muted-foreground">
            Showing {paged.rangeStart}–{paged.rangeEnd} of {paged.total}
          </p>
        )}
      </div>

      <div ref={gridRef} className="space-y-8">
        {pageGroups.map((section) => (
          <section key={section.variant} className="space-y-3">
            <div>
              {activeFilter === "all" && (
                <h2 className="text-sm font-semibold">{section.title}</h2>
              )}
              <p className="text-xs text-muted-foreground">{section.description}</p>
            </div>
            {section.variant === "ROLE_FAMILY" ? (
              <div className="space-y-6">
                {groupByRoleFamilyName(section.items).map((group) => (
                  <div key={group.name} className="space-y-3">
                    {showFamilySubheadings && (
                      <h3 className="text-xs font-medium text-muted-foreground">
                        {group.name}
                      </h3>
                    )}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {group.resumes.map((resume) => (
                        <ResumeCard key={resume.id} resume={resume} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {section.items.map((resume) => (
                  <ResumeCard key={resume.id} resume={resume} />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <Pagination
        label="Resume pages"
        page={paged.page}
        pageCount={paged.pageCount}
        onPageChange={handlePageChange}
      />

      {emptyHints.length > 0 && (
        <div className="space-y-1">
          {emptyHints.map((section) => (
            <p key={section.variant} className="text-sm text-muted-foreground">
              {section.emptyHint}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
