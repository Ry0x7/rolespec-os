import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { GroundingNotice } from "../grounding-notice"

describe("GroundingNotice", () => {
  it("renders nothing when the draft is clean", () => {
    const { container } = render(<GroundingNotice claimed={[]} />)
    expect(container.innerHTML).toBe("")
  })

  it("names every requirement and the reason it was rejected", () => {
    render(
      <GroundingNotice
        label="letter"
        claimed={[
          { keyword: "JPQL", verdict: "unsupported", reason: "Nothing supports this." },
          {
            keyword: "Spring Batch",
            verdict: "ambiguous",
            reason: "Your resume mentions Spring but not the rest.",
          },
        ]}
      />
    )

    expect(screen.getByText("Check before you send (2)")).toBeTruthy()
    expect(screen.getByText(/This letter mentions the following/)).toBeTruthy()
    expect(screen.getByText("JPQL")).toBeTruthy()
    expect(screen.getByText("Spring Batch")).toBeTruthy()
    expect(screen.getByText(/Nothing supports this\./)).toBeTruthy()
  })

  it("calls the draft a draft by default", () => {
    render(
      <GroundingNotice
        claimed={[{ keyword: "JMS", verdict: "unsupported", reason: "No evidence." }]}
      />
    )
    expect(screen.getByText(/This draft mentions the following/)).toBeTruthy()
  })
})

/**
 * The quiet tier. Amber is reserved for the case that can embarrass the user;
 * a draft that says "Kafka is new to me" gets a neutral note, and — the part
 * worth a test — no amber container at all.
 */
describe("GroundingNotice — the two tiers", () => {
  const CLAIMED = [
    { keyword: "JPQL", verdict: "unsupported" as const, reason: "Nothing supports this." },
  ]
  const GAPS = [
    { keyword: "Kafka", verdict: "unsupported" as const, reason: "No evidence." },
  ]

  const amberCount = (container: HTMLElement) =>
    container.querySelectorAll('[class*="amber"]').length

  it("renders nothing when both tiers are empty", () => {
    const { container } = render(<GroundingNotice claimed={[]} namedAsGap={[]} />)
    expect(container.innerHTML).toBe("")
  })

  it("renders the calm tier alone, with no amber anywhere", () => {
    const { container } = render(
      <GroundingNotice claimed={[]} namedAsGap={GAPS} label="letter" />
    )

    expect(screen.getByText("Named as a gap (1)")).toBeTruthy()
    expect(screen.getByText("Kafka")).toBeTruthy()
    expect(screen.getByText(/This letter brings these up as things you have not done/)).toBeTruthy()
    expect(screen.queryByText(/Check before you send/)).toBeNull()
    expect(amberCount(container)).toBe(0)
  })

  it("renders the loud tier alone exactly as before", () => {
    const { container } = render(<GroundingNotice claimed={CLAIMED} />)

    expect(screen.getByText("Check before you send (1)")).toBeTruthy()
    expect(screen.queryByText(/Named as a gap/)).toBeNull()
    expect(amberCount(container)).toBeGreaterThan(0)
  })

  it("renders both, loud first", () => {
    const { container } = render(
      <GroundingNotice claimed={CLAIMED} namedAsGap={GAPS} />
    )

    const headings = Array.from(container.querySelectorAll("p")).map(
      (node) => node.textContent
    )
    expect(headings[0]).toBe("Check before you send (1)")
    expect(headings).toContain("Named as a gap (1)")
    expect(headings.indexOf("Check before you send (1)")).toBeLessThan(
      headings.indexOf("Named as a gap (1)")
    )
  })

  it("ignores an absent namedAsGap, so an older persisted record still renders", () => {
    render(<GroundingNotice claimed={CLAIMED} />)
    expect(screen.getByText("Check before you send (1)")).toBeTruthy()
    expect(screen.queryByText(/Named as a gap/)).toBeNull()
  })
})
