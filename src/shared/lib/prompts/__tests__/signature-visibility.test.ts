import { describe, it, expect } from "vitest"

import type { SignatureCheck } from "../signature-check"
import {
  isUserFacingSignatureIssue,
  userFacingSignature,
} from "../signature-visibility"

/**
 * This module is exercised through four layers — three server actions, two
 * extension routes, `SignatureNotice` and the extension's own `parseSignature`
 * — but the decision it encodes is a PRODUCT decision, made deliberately: of
 * the three issue kinds `checkDraftSignature()` reports, only `wrong_name` and
 * `unexpected_name` ever reach a human. `missing_name` stays in the service
 * log, because an unsigned draft is odd rather than wrong and is the finding
 * most likely to fire on a legitimately short draft — surfacing it would train
 * the user to dismiss the notice and cost them the two that matter.
 *
 * A decision that deliberate is pinned here, at the helper, so that changing it
 * fails a test that states the reason rather than four tests that only state
 * the plumbing.
 */

function check(issue: SignatureCheck["issue"]): SignatureCheck {
  return {
    issue,
    expectedName: issue === "unexpected_name" ? null : "Marisol Reyes",
    signature: ["Best,", "Alex"],
    offending: issue === "missing_name" ? [] : ["Alex"],
  }
}

describe("signature visibility — which findings reach a human", () => {
  it("shows a wrong name: the observed failure, and it lands in an employer's inbox", () => {
    const finding = check("wrong_name")
    expect(isUserFacingSignatureIssue(finding)).toBe(true)
    expect(userFacingSignature(finding)).toBe(finding)
  })

  it("shows an unexpected name: no name was on file, so the model invented one", () => {
    const finding = check("unexpected_name")
    expect(isUserFacingSignatureIssue(finding)).toBe(true)
    expect(userFacingSignature(finding)).toBe(finding)
  })

  it("SUPPRESSES a missing name: a style finding, not a correctness one", () => {
    const finding = check("missing_name")
    expect(isUserFacingSignatureIssue(finding)).toBe(false)
    expect(userFacingSignature(finding)).toBeNull()
  })
})

describe("signature visibility — the nullable convention", () => {
  it("passes null straight through, so a clean draft stays clean", () => {
    expect(isUserFacingSignatureIssue(null)).toBe(false)
    expect(userFacingSignature(null)).toBeNull()
  })

  it("treats undefined the same, so a caller may spread an absent field", () => {
    expect(isUserFacingSignatureIssue(undefined)).toBe(false)
    expect(userFacingSignature(undefined)).toBeNull()
  })
})
