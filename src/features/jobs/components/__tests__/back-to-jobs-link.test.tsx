import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { BackToJobsLink } from "../back-to-jobs-link"
import { JOBS_LIST_HREF_STORAGE_KEY } from "../../lib/jobs-list-href"

const ORIGIN = window.location.origin

function mockReferrer(value: string) {
  vi.spyOn(document, "referrer", "get").mockReturnValue(value)
}

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("BackToJobsLink", () => {
  it("links to the referring list URL after mount", () => {
    mockReferrer(`${ORIGIN}/jobs?status=APPLIED`)
    render(<BackToJobsLink className="back">Job Applications</BackToJobsLink>)
    const link = screen.getByRole("link", { name: "Job Applications" })
    expect(link.getAttribute("href")).toBe("/jobs?status=APPLIED")
    expect(link.className).toBe("back")
  })

  it("falls back to /jobs for a foreign referrer", () => {
    mockReferrer("https://evil.example/jobs?status=APPLIED")
    render(<BackToJobsLink>Job Applications</BackToJobsLink>)
    expect(screen.getByRole("link", { name: "Job Applications" }).getAttribute("href")).toBe("/jobs")
  })

  it("uses the list URL remembered in this tab", () => {
    mockReferrer("")
    window.sessionStorage.setItem(JOBS_LIST_HREF_STORAGE_KEY, "/jobs?sort=recent")
    render(<BackToJobsLink>Job Applications</BackToJobsLink>)
    expect(screen.getByRole("link", { name: "Job Applications" }).getAttribute("href")).toBe(
      "/jobs?sort=recent",
    )
  })
})
