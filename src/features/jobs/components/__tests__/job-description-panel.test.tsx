import { describe, it, expect, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { JobDescriptionPanel } from "../job-description-panel"

afterEach(cleanup)

describe("JobDescriptionPanel", () => {
  it("stays collapsed by default and shows a one-line preview instead of the body", () => {
    render(<JobDescriptionPanel jobDescription="We need a Kubernetes wrangler." />)

    const toggle = screen.getByRole("button", { name: /job description/i })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    // The preview is inside the toggle; the full body is not rendered at all.
    expect(toggle.textContent).toMatch("We need a Kubernetes wrangler.")
    expect(
      screen.queryByText("We need a Kubernetes wrangler.", { selector: "p" })
    ).toBeNull()
  })

  it("truncates a long posting to a single flattened preview line", () => {
    const long = `First line about the role.\n\n${"detail ".repeat(60)}`
    render(<JobDescriptionPanel jobDescription={long} />)

    const preview = screen.getByRole("button", { name: /job description/i }).textContent ?? ""
    expect(preview).toMatch("…")
    expect(preview).not.toMatch("\n")
    expect(preview.length).toBeLessThan(long.length)
  })

  it("expands the body when the header is clicked", () => {
    render(<JobDescriptionPanel jobDescription="We need a Kubernetes wrangler." />)

    const toggle = screen.getByRole("button", { name: /job description/i })
    fireEvent.click(toggle)

    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("We need a Kubernetes wrangler.")).toBeTruthy()
  })

  it("opens on mount when the caller asks for defaultOpen", () => {
    render(
      <JobDescriptionPanel jobDescription="We need a Kubernetes wrangler." defaultOpen />
    )

    expect(
      screen
        .getByRole("button", { name: /job description/i })
        .getAttribute("aria-expanded")
    ).toBe("true")
    expect(screen.getByText("We need a Kubernetes wrangler.")).toBeTruthy()
  })

  it("preserves line breaks from the pasted posting once expanded", () => {
    render(<JobDescriptionPanel jobDescription={"Line one\nLine two"} defaultOpen />)

    const body = screen.getByText(/Line one/)
    expect(body.className).toMatch("whitespace-pre-wrap")
  })
})
