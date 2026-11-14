import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

vi.mock("@/features/resume/actions", () => ({
  createResume: vi.fn(),
  createRoleFamilyResume: vi.fn(),
}))
vi.mock("@/features/resume/actions/tailor", () => ({
  createJobTailoredResume: vi.fn(),
}))

import { TailorResumeButton } from "../tailor-resume-button"

afterEach(cleanup)

function renderButton(tailoredResumes: Array<{ id: string; title: string }>) {
  render(
    <TailorResumeButton
      jobApplicationId="job-1"
      jobTitle="Web Developer"
      companyName="Rose Eden LLC"
      tailoredResumes={tailoredResumes}
      masterResumes={[{ id: "m1", title: "Master", detail: null }]}
      roleFamilies={[]}
      roleFamilyResumes={[]}
    />,
  )
}

describe("tailor resume button", () => {
  it("invites a first tailored resume when the job has none", () => {
    renderButton([])
    expect(screen.getByRole("button", { name: "Tailor a resume" })).toBeTruthy()
  })

  it("reads 'Tailor another' once one exists", () => {
    renderButton([{ id: "t1", title: "Rose Eden" }])
    expect(screen.getByRole("button", { name: "Tailor another" })).toBeTruthy()
  })
})
