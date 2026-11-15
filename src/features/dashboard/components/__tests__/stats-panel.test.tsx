import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { StatsPanel } from "../stats-panel"

afterEach(cleanup)

describe("StatsPanel", () => {
  it("renders the activity counts", () => {
    render(
      <StatsPanel resumeCount={3} atsScannedCount={2} applicationCount={11} />
    )

    expect(screen.getByText("Resumes")).toBeTruthy()
    expect(screen.getByText("ATS-scored resumes")).toBeTruthy()
    expect(screen.getByText("Applications tracked")).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
    expect(screen.getByText("2")).toBeTruthy()
    expect(screen.getByText("11")).toBeTruthy()
  })

  it("links each stat to its feature", () => {
    render(
      <StatsPanel resumeCount={0} atsScannedCount={0} applicationCount={0} />
    )
    const links = screen.getAllByRole("link")
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/resumes",
      "/resumes",
      "/jobs",
    ])
  })
})
