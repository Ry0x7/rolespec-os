import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { RequirementBadges } from "../requirement-badges"

afterEach(cleanup)

describe("RequirementBadges", () => {
  it("renders nothing when there are no flags", () => {
    const { container } = render(<RequirementBadges flags={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing for a null or undefined Json column", () => {
    expect(render(<RequirementBadges flags={null} />).container.firstChild).toBeNull()
    cleanup()
    expect(render(<RequirementBadges flags={undefined} />).container.firstChild).toBeNull()
  })

  it("renders a human label per known flag", () => {
    render(<RequirementBadges flags={["US_ONLY", "NO_SPONSORSHIP", "ONSITE_REQUIRED"]} />)

    expect(screen.getByText("US only")).toBeTruthy()
    expect(screen.getByText("No sponsorship")).toBeTruthy()
    expect(screen.getByText("Onsite required")).toBeTruthy()
  })

  it("styles restrictive, informational and positive flags differently", () => {
    render(
      <RequirementBadges
        flags={["NO_SPONSORSHIP", "WORK_AUTH_REQUIRED", "SPONSORSHIP_AVAILABLE"]}
      />,
    )

    expect(screen.getByText("No sponsorship").className).toContain("amber")
    expect(screen.getByText("Work authorization").className).toContain("muted")
    expect(screen.getByText("Sponsorship available").className).toContain("green")
  })

  it("drops unknown and non-string entries rather than rendering them", () => {
    render(
      <RequirementBadges
        flags={["US_ONLY", "SOMETHING_NEW", 42 as unknown as string]}
      />,
    )

    expect(screen.getByText("US only")).toBeTruthy()
    expect(screen.queryByText("SOMETHING_NEW")).toBeNull()
    expect(screen.queryByText("42")).toBeNull()
  })

  it("renders nothing when every entry is unknown", () => {
    const { container } = render(<RequirementBadges flags={["NOPE"]} />)
    expect(container.firstChild).toBeNull()
  })
})
