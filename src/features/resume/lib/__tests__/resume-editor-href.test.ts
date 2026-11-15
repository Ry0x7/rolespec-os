import { describe, it, expect } from "vitest"

import { resumeEditorHref } from "../resume-editor-href"

describe("resumeEditorHref", () => {
  it("opens the editor with no job context", () => {
    expect(resumeEditorHref("resume-1")).toBe("/resumes/resume-1")
    expect(resumeEditorHref("resume-1", null)).toBe("/resumes/resume-1")
    expect(resumeEditorHref("resume-1", "")).toBe("/resumes/resume-1")
  })

  it("carries the job application as ?jobId=", () => {
    expect(resumeEditorHref("resume-1", "app-1")).toBe("/resumes/resume-1?jobId=app-1")
  })

  it("encodes the job id", () => {
    expect(resumeEditorHref("resume-1", "a b&c")).toBe("/resumes/resume-1?jobId=a%20b%26c")
  })
})
