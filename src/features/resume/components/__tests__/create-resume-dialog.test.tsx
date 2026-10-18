import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CreateResumeDialog } from "../create-resume-dialog"
import { createResume, createRoleFamilyResume } from "../../actions"
import { createJobTailoredResume } from "../../actions/tailor"

vi.mock("../../actions", () => ({
  createResume: vi.fn(),
  createRoleFamilyResume: vi.fn(),
}))

vi.mock("../../actions/tailor", () => ({
  createJobTailoredResume: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const masterResumes = [{ id: "master-1", title: "Core Experience" }]
const roleFamilies = [{ id: "family-1", name: "Platform Engineering" }]
const roleFamilyResumes = [{ id: "rf-resume-1", title: "Platform Resume" }]
const jobApplications = [
  { id: "job-1", jobTitle: "Platform Engineer", companyName: "Acme" },
]

function renderDialog(
  props: Partial<React.ComponentProps<typeof CreateResumeDialog>> = {}
) {
  render(
    <CreateResumeDialog
      masterResumes={masterResumes}
      roleFamilies={roleFamilies}
      roleFamilyResumes={roleFamilyResumes}
      jobApplications={jobApplications}
      {...props}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Create Resume" }))
}

function openRoleFamilyMode() {
  fireEvent.click(
    screen.getByRole("button", { name: "Create a role family resume instead" })
  )
}

function openJobTailoredMode() {
  fireEvent.click(
    screen.getByRole("button", { name: "Create a job tailored resume instead" })
  )
}

describe("CreateResumeDialog", () => {
  it("opens in master mode and submits the ordinary resume action", async () => {
    vi.mocked(createResume).mockResolvedValue(undefined as never)
    renderDialog()

    expect(screen.getByRole("heading", { name: "Create a master resume" })).toBeTruthy()
    expect(screen.getByLabelText("Target Role (optional)")).toBeTruthy()
    expect(screen.getByLabelText("Target Company (optional)")).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Resume Title"), {
      target: { value: "Primary Resume" },
    })
    fireEvent.submit(
      screen.getByRole("button", { name: "Create Master Resume" }).closest("form")!
    )

    await waitFor(() => expect(createResume).toHaveBeenCalledOnce())
    expect(createRoleFamilyResume).not.toHaveBeenCalled()
  })

  it("reveals required fields and visibly marks master sources", () => {
    renderDialog()
    openRoleFamilyMode()

    expect(screen.getByRole("heading", { name: "Create a role family resume" })).toBeTruthy()
    expect(screen.getByLabelText("Source master resume")).toHaveProperty("required", true)
    expect(screen.getByLabelText("Role family")).toHaveProperty("required", true)
    expect(screen.getByRole("option", { name: "Core Experience — Master" })).toBeTruthy()
    expect(screen.queryByLabelText("Target Company (optional)")).toBeNull()
  })

  it("submits the role family values to the completed action", async () => {
    vi.mocked(createRoleFamilyResume).mockResolvedValue(undefined as never)
    renderDialog()
    openRoleFamilyMode()

    fireEvent.change(screen.getByLabelText("Resume Title"), {
      target: { value: "Platform Resume" },
    })
    fireEvent.change(screen.getByLabelText("Source master resume"), {
      target: { value: "master-1" },
    })
    fireEvent.change(screen.getByLabelText("Role family"), {
      target: { value: "family-1" },
    })
    fireEvent.submit(
      screen.getByRole("button", { name: "Create Role Family Resume" }).closest("form")!
    )

    await waitFor(() => expect(createRoleFamilyResume).toHaveBeenCalledOnce())
    const formData = vi.mocked(createRoleFamilyResume).mock.calls[0][0]
    expect(Object.fromEntries(formData)).toMatchObject({
      title: "Platform Resume",
      sourceResumeId: "master-1",
      roleFamilyId: "family-1",
    })
  })

  it("offers master creation and prevents a dead submission without a master", () => {
    renderDialog({ masterResumes: [] })
    openRoleFamilyMode()

    expect(screen.getByText("Create a master resume first")).toBeTruthy()
    expect((screen.getByLabelText("Source master resume") as HTMLSelectElement).disabled).toBe(true)
    expect(
      (screen.getByRole("button", { name: "Create Role Family Resume" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Create a master resume" }))
    expect(screen.getByRole("heading", { name: "Create a master resume" })).toBeTruthy()
  })

  it("reveals job tailoring fields listing both source kinds", () => {
    renderDialog()
    openJobTailoredMode()

    expect(
      screen.getByRole("heading", { name: "Create a job tailored resume" })
    ).toBeTruthy()
    expect(screen.getByLabelText("Source resume")).toHaveProperty("required", true)
    expect(screen.getByLabelText("Job application")).toHaveProperty("required", true)
    expect(screen.getByRole("option", { name: "Core Experience — Master" })).toBeTruthy()
    expect(
      screen.getByRole("option", { name: "Platform Resume — Role family" })
    ).toBeTruthy()
    expect(
      screen.getByRole("option", { name: "Platform Engineer — Acme" })
    ).toBeTruthy()
  })

  it("disambiguates same-titled sources with target role and family name", () => {
    renderDialog({
      masterResumes: [
        { id: "m1", title: "Core Experience", detail: "Account Executive" },
      ],
      roleFamilyResumes: [
        { id: "r1", title: "Core Experience", detail: "Platform Engineering" },
      ],
    })
    openJobTailoredMode()

    expect(
      screen.getByRole("option", {
        name: "Core Experience — Master · Account Executive",
      })
    ).toBeTruthy()
    expect(
      screen.getByRole("option", {
        name: "Core Experience — Role family · Platform Engineering",
      })
    ).toBeTruthy()
  })

  it("auto-opens in job tailored mode with the job preselected from tailorJobId", () => {
    render(
      <CreateResumeDialog
        masterResumes={masterResumes}
        roleFamilies={roleFamilies}
        roleFamilyResumes={roleFamilyResumes}
        jobApplications={jobApplications}
        tailorJobId="job-1"
      />
    )

    expect(
      screen.getByRole("heading", { name: "Create a job tailored resume" })
    ).toBeTruthy()
    expect(
      (screen.getByLabelText("Job application") as HTMLSelectElement).value
    ).toBe("job-1")
  })

  it("ignores a tailorJobId that is not one of the user's applications", () => {
    render(
      <CreateResumeDialog
        masterResumes={masterResumes}
        roleFamilies={roleFamilies}
        roleFamilyResumes={roleFamilyResumes}
        jobApplications={jobApplications}
        tailorJobId="not-mine"
      />
    )

    expect(screen.getByRole("button", { name: "Create Resume" })).toBeTruthy()
    expect(
      screen.queryByRole("heading", { name: "Create a job tailored resume" })
    ).toBeNull()
  })

  it("submits the job tailoring values to the tailoring action", async () => {
    vi.mocked(createJobTailoredResume).mockResolvedValue(undefined as never)
    renderDialog()
    openJobTailoredMode()

    fireEvent.change(screen.getByLabelText("Resume Title"), {
      target: { value: "Acme Platform Resume" },
    })
    fireEvent.change(screen.getByLabelText("Source resume"), {
      target: { value: "rf-resume-1" },
    })
    fireEvent.change(screen.getByLabelText("Job application"), {
      target: { value: "job-1" },
    })
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Create Job Tailored Resume" })
        .closest("form")!
    )

    await waitFor(() => expect(createJobTailoredResume).toHaveBeenCalledOnce())
    const formData = vi.mocked(createJobTailoredResume).mock.calls[0][0]
    expect(Object.fromEntries(formData)).toMatchObject({
      title: "Acme Platform Resume",
      sourceResumeId: "rf-resume-1",
      jobApplicationId: "job-1",
    })
    expect(createResume).not.toHaveBeenCalled()
    expect(createRoleFamilyResume).not.toHaveBeenCalled()
  })

  it("offers master creation and prevents tailoring without any source resume", () => {
    renderDialog({ masterResumes: [], roleFamilyResumes: [] })
    openJobTailoredMode()

    expect(screen.getByText("Create a master resume first")).toBeTruthy()
    expect((screen.getByLabelText("Source resume") as HTMLSelectElement).disabled).toBe(
      true
    )
    expect(
      (screen.getByRole("button", { name: "Create Job Tailored Resume" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Create a master resume" }))
    expect(screen.getByRole("heading", { name: "Create a master resume" })).toBeTruthy()
  })

  it("links to the Job Tracker and prevents tailoring without applications", () => {
    renderDialog({ jobApplications: [] })
    openJobTailoredMode()

    expect(screen.getByText("Track a job application to continue")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Open Job Tracker" }).getAttribute("href")
    ).toBe("/jobs")
    expect(
      (screen.getByLabelText("Job application") as HTMLSelectElement).disabled
    ).toBe(true)
    expect(
      (screen.getByRole("button", { name: "Create Job Tailored Resume" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it("links to Career Profile and prevents submission without role families", () => {
    renderDialog({ roleFamilies: [] })
    openRoleFamilyMode()

    expect(screen.getByText("Add a role family to continue")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Open Career Profile" }).getAttribute("href")
    ).toBe("/career-profile")
    expect((screen.getByLabelText("Role family") as HTMLSelectElement).disabled).toBe(true)
    expect(
      (screen.getByRole("button", { name: "Create Role Family Resume" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })
})

describe("create resume dialog — opened from one job", () => {
  function renderTailorOnly(
    props: Partial<React.ComponentProps<typeof CreateResumeDialog>> = {}
  ) {
    render(
      <CreateResumeDialog
        masterResumes={masterResumes}
        roleFamilies={roleFamilies}
        roleFamilyResumes={roleFamilyResumes}
        jobApplications={jobApplications}
        tailorJobId="job-1"
        tailorOnly
        {...props}
      />
    )
  }

  it("opens the source select on the resume the page preselected", () => {
    renderTailorOnly({ defaultSourceResumeId: "rf-resume-1" })
    fireEvent.click(screen.getByRole("button", { name: "Tailor a resume" }))

    expect((screen.getByLabelText("Source resume") as HTMLSelectElement).value).toBe(
      "rf-resume-1"
    )
  })

  it("names the tailored resumes this job already has and still allows another", () => {
    renderTailorOnly({
      existingTailoredResumes: [
        { id: "t-1", title: "Acme Resume" },
        { id: "t-2", title: "Acme Resume v2" },
      ],
    })
    // The trigger label is the caller's (see `TailorResumeButton`); the dialog
    // renders the default one.
    fireEvent.click(screen.getByRole("button", { name: "Tailor a resume" }))

    expect(
      screen.getByText(/You already have 2 tailored resumes for this job/)
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Acme Resume" }).getAttribute("href")
    ).toBe("/resumes/t-1")
    expect(
      screen.getByText("Create another only if you need a different angle.")
    ).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "Create Job Tailored Resume" }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  })

  it("says resume in the singular for one existing tailored resume", () => {
    renderTailorOnly({
      existingTailoredResumes: [{ id: "t-1", title: "Acme Resume" }],
    })
    // The trigger label is the caller's (see `TailorResumeButton`); the dialog
    // renders the default one.
    fireEvent.click(screen.getByRole("button", { name: "Tailor a resume" }))

    expect(
      screen.getByText(/You already have 1 tailored resume for this job/)
    ).toBeTruthy()
  })

  it("shows no notice and the plain label when nothing is tailored yet", () => {
    renderTailorOnly()
    fireEvent.click(screen.getByRole("button", { name: "Tailor a resume" }))

    expect(screen.queryByText(/You already have/)).toBeNull()
  })
})
