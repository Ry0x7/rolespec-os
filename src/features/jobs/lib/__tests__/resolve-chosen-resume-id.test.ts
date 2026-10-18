import { describe, it, expect } from "vitest"
import { resolveChosenResumeId } from "../resolve-chosen-resume-id"

describe("resolveChosenResumeId", () => {
  it("keeps a chosen resume that is in the non-archived list", () => {
    expect(
      resolveChosenResumeId([{ id: "resume-1" }, { id: "resume-2" }], "resume-2"),
    ).toBe("resume-2")
  })

  it("treats an archived or deleted choice as no choice", () => {
    // `resume-9` is still on the application row, but the page's resume list
    // excludes ARCHIVED, so it is absent here.
    expect(
      resolveChosenResumeId([{ id: "resume-1" }], "resume-9"),
    ).toBeNull()
  })

  it("returns null when nothing was chosen", () => {
    expect(resolveChosenResumeId([{ id: "resume-1" }], null)).toBeNull()
  })
})
