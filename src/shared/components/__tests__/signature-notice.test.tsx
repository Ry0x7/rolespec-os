import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { SignatureNotice } from "../signature-notice"
import type { SignatureCheck } from "@/shared/lib/prompts/signature-check"
import type { SubjectNameCheck } from "@/shared/lib/prompts/signature-check"

const WRONG_NAME: SignatureCheck = {
  issue: "wrong_name",
  expectedName: "Marisol Reyes",
  signature: ["Best,", "Cebu General Hospital staff nurse"],
  offending: ["Cebu General Hospital staff nurse"],
}

const UNEXPECTED_NAME: SignatureCheck = {
  issue: "unexpected_name",
  expectedName: null,
  signature: ["Best,", "Alex"],
  offending: ["Alex"],
}

const MISSING_NAME: SignatureCheck = {
  issue: "missing_name",
  expectedName: "Marisol Reyes",
  signature: ["Best regards,"],
  offending: [],
}

const SUBJECT: SubjectNameCheck = {
  issue: "wrong_name",
  expectedName: "Marisol Reyes",
  offending: "Platform Team",
}

const amberCount = (container: HTMLElement) =>
  container.querySelectorAll('[class*="amber"]').length

describe("SignatureNotice", () => {
  it("renders nothing when both checks are null", () => {
    const { container } = render(<SignatureNotice signature={null} subjectName={null} />)
    expect(container.innerHTML).toBe("")
  })

  it("renders nothing when nothing is passed at all", () => {
    const { container } = render(<SignatureNotice />)
    expect(container.innerHTML).toBe("")
  })

  /**
   * The product decision: an unsigned draft is odd, not wrong, so it never
   * reaches the user. The component is the last line of that filter — a stale
   * persisted record or an older caller must not be able to render it.
   */
  it("renders NOTHING for a missing_name finding", () => {
    const { container } = render(<SignatureNotice signature={MISSING_NAME} />)
    expect(container.innerHTML).toBe("")
  })

  it("names the expected name and quotes what stood there instead", () => {
    const { container } = render(<SignatureNotice signature={WRONG_NAME} label="email" />)

    expect(screen.getByText(/Check the sign-off/)).toBeTruthy()
    expect(screen.getByText("Marisol Reyes")).toBeTruthy()
    expect(screen.getByText(/Cebu General Hospital staff nurse/)).toBeTruthy()
    expect(amberCount(container)).toBeGreaterThan(0)
  })

  it("uses different wording when no name was available to sign with", () => {
    render(<SignatureNotice signature={UNEXPECTED_NAME} />)

    expect(screen.getByText(/signed off as/i)).toBeTruthy()
    expect(screen.getByText(/Alex/)).toBeTruthy()
    // The sign-off case that HAS a name must not claim a name it never had.
    expect(screen.queryByText(/should have signed/i)).toBeNull()
  })

  it("renders a subject finding on its own", () => {
    const { container } = render(<SignatureNotice subjectName={SUBJECT} />)

    expect(screen.getByText(/Check the subject line/)).toBeTruthy()
    expect(screen.getByText(/Platform Team/)).toBeTruthy()
    expect(screen.getByText("Marisol Reyes")).toBeTruthy()
    expect(amberCount(container)).toBeGreaterThan(0)
  })

  /**
   * Two findings on one draft is the realistic case — the same missing name
   * fails in both slots. They must read as two distinct fixes, in one box, with
   * the heading said once.
   */
  it("renders both findings in a single box, without duplicating the heading", () => {
    const { container } = render(
      <SignatureNotice signature={WRONG_NAME} subjectName={SUBJECT} label="email" />
    )

    expect(screen.getByText(/Check the sign-off/)).toBeTruthy()
    expect(screen.getByText(/Check the subject line/)).toBeTruthy()

    const headings = Array.from(container.querySelectorAll("p")).map((n) => n.textContent)
    const headingCount = headings.filter((text) =>
      text?.startsWith("Check the name")
    ).length
    expect(headingCount).toBe(1)

    // One alarm box, not two stacked amber panels.
    expect(container.querySelectorAll('[class*="border-amber"]').length).toBe(1)
  })

  it("still renders the subject finding when the signature is suppressed", () => {
    render(<SignatureNotice signature={MISSING_NAME} subjectName={SUBJECT} />)

    expect(screen.getByText(/Check the subject line/)).toBeTruthy()
    expect(screen.queryByText(/Check the sign-off/)).toBeNull()
  })
})
