import { describe, it, expect, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ResumeBrowser, RESUME_PAGE_SIZE } from "../resume-browser"
import type { ResumeCardData } from "../resume-sections"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("../../actions", () => ({
  deleteResume: vi.fn(),
}))

afterEach(cleanup)

function makeResume(overrides: Partial<ResumeCardData>): ResumeCardData {
  return {
    id: "r1",
    title: "Backend Engineer",
    targetRole: "Platform Engineer",
    variant: "MASTER",
    roleFamily: null,
    jobApplication: null,
    template: "MODERN",
    atsScore: null,
    updatedAt: new Date("2026-01-15T00:00:00.000Z"),
    ...overrides,
  }
}

function many(variant: ResumeCardData["variant"], count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) =>
    makeResume({ id: `${prefix}-${i + 1}`, variant, title: `${prefix} ${i + 1}` })
  )
}

function filterButton(name: RegExp) {
  return screen.getByRole("button", { name })
}

describe("ResumeBrowser filter", () => {
  it("defaults to All and only offers variants that have resumes, with counts", () => {
    render(
      <ResumeBrowser
        resumes={[...many("MASTER", 2, "Master"), ...many("JOB_TAILORED", 3, "Tailored")]}
      />
    )

    expect(filterButton(/^All/).getAttribute("aria-pressed")).toBe("true")
    expect(filterButton(/^All/).textContent).toContain("(5)")
    expect(filterButton(/^Master resumes/).textContent).toContain("(2)")
    expect(filterButton(/^Job-tailored resumes/).textContent).toContain("(3)")
    expect(screen.queryByRole("button", { name: /^Role family resumes/ })).toBeNull()
  })

  it("narrows the grid to one variant and drops the variant headings", () => {
    render(
      <ResumeBrowser
        resumes={[...many("MASTER", 2, "Master"), ...many("JOB_TAILORED", 3, "Tailored")]}
      />
    )

    fireEvent.click(filterButton(/^Job-tailored resumes/))

    expect(filterButton(/^Job-tailored resumes/).getAttribute("aria-pressed")).toBe("true")
    expect(screen.queryByRole("link", { name: "Master 1" })).toBeNull()
    expect(screen.getByRole("link", { name: "Tailored 1" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Job-tailored resumes" })).toBeNull()
    expect(screen.getByText("Showing 1–3 of 3")).toBeTruthy()
  })
})

describe("ResumeBrowser paging", () => {
  it("shows twelve per page with a range line and a pager", () => {
    render(<ResumeBrowser resumes={many("MASTER", 15, "Master")} />)

    expect(RESUME_PAGE_SIZE).toBe(12)
    expect(screen.getByText("Showing 1–12 of 15")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Master 12" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Master 13" })).toBeNull()
    expect(screen.getByText("Page 1 of 2")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByText("Showing 13–15 of 15")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Master 13" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Master 1" })).toBeNull()
  })

  it("hides the pager when everything fits on one page", () => {
    render(<ResumeBrowser resumes={many("MASTER", 3, "Master")} />)

    expect(screen.getByText("Showing 1–3 of 3")).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Resume pages" })).toBeNull()
  })

  it("goes back to page 1 when the filter changes", () => {
    render(
      <ResumeBrowser
        resumes={[...many("MASTER", 14, "Master"), ...many("JOB_TAILORED", 2, "Tailored")]}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Showing 13–16 of 16")).toBeTruthy()

    fireEvent.click(filterButton(/^Master resumes/))
    expect(screen.getByText("Showing 1–12 of 14")).toBeTruthy()
    expect(screen.getByText("Page 1 of 2")).toBeTruthy()
  })
})

describe("ResumeBrowser scroll on page change", () => {
  it("scrolls the grid top into view on a page change only when it is above the viewport", () => {
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      render(
        <ResumeBrowser
          resumes={[...many("MASTER", 30, "Master"), ...many("JOB_TAILORED", 3, "Tailored")]}
        />
      )
      const grid = screen.getByRole("link", { name: "Master 1" }).closest(
        ".space-y-8"
      ) as HTMLElement
      const top = vi.spyOn(grid, "getBoundingClientRect")

      top.mockReturnValue({ top: 40 } as DOMRect)
      fireEvent.click(screen.getByRole("button", { name: "Next" }))
      expect(scrollIntoView).not.toHaveBeenCalled()

      top.mockReturnValue({ top: -600 } as DOMRect)
      fireEvent.click(screen.getByRole("button", { name: "Next" }))
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" })

      // A filter change never scrolls.
      fireEvent.click(filterButton(/^Job-tailored resumes/))
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })
})

describe("ResumeBrowser grouping", () => {
  it("under All, heads only the variants on the current page, in tier order", () => {
    render(
      <ResumeBrowser
        resumes={[
          // Incoming order is updatedAt desc and mixes tiers.
          ...many("JOB_TAILORED", 4, "Tailored"),
          ...many("MASTER", 10, "Master"),
        ]}
      />
    )

    // Page 1: 10 masters then 2 tailored, master heading first.
    const master = screen.getByRole("heading", { name: "Master resumes" })
    const tailored = screen.getByRole("heading", { name: "Job-tailored resumes" })
    expect(
      master.compareDocumentPosition(tailored) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))

    // Page 2 holds only the remaining tailored resumes.
    expect(screen.queryByRole("heading", { name: "Master resumes" })).toBeNull()
    expect(screen.getByRole("heading", { name: "Job-tailored resumes" })).toBeTruthy()
    expect(screen.getByText("Showing 13–14 of 14")).toBeTruthy()
  })

  it("links each resume to its editor", () => {
    render(
      <ResumeBrowser
        resumes={[
          makeResume({ id: "m1", variant: "MASTER", title: "Master Resume" }),
          makeResume({
            id: "rf1",
            variant: "ROLE_FAMILY",
            title: "RF Resume",
            roleFamily: { name: "Engineering" },
          }),
          makeResume({ id: "jt1", variant: "JOB_TAILORED", title: "JT Resume" }),
        ]}
      />
    )
    expect(screen.getByRole("link", { name: "Master Resume" }).getAttribute("href")).toBe(
      "/resumes/m1"
    )
    expect(screen.getByRole("link", { name: "RF Resume" }).getAttribute("href")).toBe(
      "/resumes/rf1"
    )
    expect(screen.getByRole("link", { name: "JT Resume" }).getAttribute("href")).toBe(
      "/resumes/jt1"
    )
  })

  it("labels role family cards but omits subheadings when only one family is present", () => {
    render(
      <ResumeBrowser
        resumes={[
          makeResume({
            id: "rf1",
            variant: "ROLE_FAMILY",
            title: "RF Resume",
            roleFamily: { name: "Engineering" },
          }),
        ]}
      />
    )
    expect(screen.getByText("Engineering")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Engineering" })).toBeNull()
  })

  it("adds a subheading per family when multiple role families are present", () => {
    render(
      <ResumeBrowser
        resumes={[
          makeResume({
            id: "rf1",
            variant: "ROLE_FAMILY",
            title: "RF Resume 1",
            roleFamily: { name: "Engineering" },
          }),
          makeResume({
            id: "rf2",
            variant: "ROLE_FAMILY",
            title: "RF Resume 2",
            roleFamily: { name: "Sales" },
          }),
        ]}
      />
    )
    expect(screen.getByRole("heading", { name: "Engineering" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Sales" })).toBeTruthy()
  })
})

describe("ResumeBrowser empty hints", () => {
  it("suggests a master when there is none, and not the derived tiers", () => {
    render(<ResumeBrowser resumes={many("JOB_TAILORED", 1, "Tailored")} />)
    expect(screen.getByText(/No master resumes yet/)).toBeTruthy()
    expect(screen.queryByText(/Create one from a master resume/)).toBeNull()
  })

  it("suggests role family and job-tailored variants once a master exists", () => {
    render(<ResumeBrowser resumes={many("MASTER", 1, "Master")} />)
    expect(screen.getByText(/Create one from a master resume/)).toBeTruthy()
    expect(screen.getByText(/Create one from a master or role family resume/)).toBeTruthy()
    expect(screen.queryByText(/No master resumes yet/)).toBeNull()
  })
})
