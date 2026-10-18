import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const { mockUseSession, mockUpdate, mockGenerate } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockUpdate: vi.fn(),
  mockGenerate: vi.fn(),
}))

vi.mock("next-auth/react", () => ({ useSession: mockUseSession }))
vi.mock("../../actions/cover-letter.actions", () => ({
  generateCoverLetter: mockGenerate,
}))

import { CoverLetterForm } from "../cover-letter-form"

const resumes = [{ id: "r1", title: "Engineer", atsScore: 70 }]
const applications = [
  { id: "j1", companyName: "Northwind", jobTitle: "Platform", hasJobDescription: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue({})
  mockUseSession.mockReturnValue({ update: mockUpdate })
})

afterEach(cleanup)

describe("cover letter form", () => {
  it("renders errors as plain text", async () => {
    mockGenerate.mockResolvedValue({ error: "Resume not found" })

    const { container } = render(
      <CoverLetterForm
        resumes={resumes}
        applications={applications}
        defaultJobApplicationId="j1"
      />,
    )

    fireEvent.submit(container.querySelector("form")!)

    await waitFor(() => expect(screen.getByText("Resume not found")).toBeTruthy())
  })
})

describe("cover letter form — locked to one application", () => {
  it("names the job, hides the picker and submits the fixed id", async () => {
    mockGenerate.mockResolvedValue({})

    const { container } = render(
      <CoverLetterForm
        resumes={resumes}
        applications={applications}
        lockedApplication={applications[0]}
      />,
    )

    expect(screen.getByText("Cover letter for: Northwind — Platform")).not.toBeNull()
    expect(screen.queryByLabelText("Job Application (optional)")).toBeNull()

    fireEvent.submit(container.querySelector("form")!)

    await waitFor(() => expect(mockGenerate).toHaveBeenCalled())
    const formData = mockGenerate.mock.calls[0][0] as FormData
    expect(formData.get("jobApplicationId")).toBe("j1")
    // The linked application's stored job description is used, so no paste box.
    expect(container.querySelector("textarea")).toBeNull()
  })

  it("pre-selects the application's chosen resume and lets the user override", () => {
    render(
      <CoverLetterForm
        resumes={[...resumes, { id: "r2", title: "Platform", atsScore: null }]}
        applications={applications}
        lockedApplication={applications[0]}
        defaultResumeId="r2"
      />,
    )

    const select = screen.getByLabelText("Resume") as HTMLSelectElement
    expect(select.value).toBe("r2")

    fireEvent.change(select, { target: { value: "r1" } })
    expect(select.value).toBe("r1")
  })

  it("keeps the picker and the empty resume default without a locked application", () => {
    render(<CoverLetterForm resumes={resumes} applications={applications} />)

    expect(screen.queryByText(/Cover letter for:/)).toBeNull()
    const picker = screen.getByLabelText("Job Application (optional)") as HTMLSelectElement
    expect(picker.value).toBe("")
    expect((screen.getByLabelText("Resume") as HTMLSelectElement).value).toBe("")
  })
})

describe("cover letter form — resume default and hint", () => {
  it("preselects the resolved resume and names why it was suggested", () => {
    render(
      <CoverLetterForm
        resumes={[
          { id: "r1", title: "Engineer", atsScore: 70 },
          { id: "r2", title: "Rose Eden", atsScore: null },
        ]}
        applications={applications}
        lockedApplication={applications[0]}
        defaultResumeId="r2"
        resumeHint="Recommended: Rose Eden · Tailored for this job"
      />,
    )

    expect((screen.getByLabelText("Resume") as HTMLSelectElement).value).toBe("r2")
    expect(
      screen.getByText("Recommended: Rose Eden · Tailored for this job"),
    ).toBeTruthy()
  })

  it("says nothing about tiers when there is no hint to give", () => {
    render(
      <CoverLetterForm
        resumes={[{ id: "r1", title: "Engineer", atsScore: 70 }]}
        applications={applications}
        resumeHint={null}
      />,
    )

    expect(screen.queryByText(/Recommended:/)).toBeNull()
  })
})

describe("cover letter form — staying on the page", () => {
  it("asks the action not to navigate and hands the new id back", async () => {
    mockGenerate.mockResolvedValue({ id: "cl-new" })
    const onGenerated = vi.fn()

    const { container } = render(
      <CoverLetterForm
        resumes={resumes}
        applications={applications}
        lockedApplication={applications[0]}
        redirect={false}
        onGenerated={onGenerated}
      />,
    )

    fireEvent.submit(container.querySelector("form")!)

    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith("cl-new"))
    expect(mockGenerate).toHaveBeenCalledWith(expect.any(FormData), {
      redirect: false,
    })
  })

  it("reports the error instead of the id, and never calls back", async () => {
    mockGenerate.mockResolvedValue({ error: "Resume not found" })
    const onGenerated = vi.fn()

    const { container } = render(
      <CoverLetterForm
        resumes={resumes}
        applications={applications}
        lockedApplication={applications[0]}
        redirect={false}
        onGenerated={onGenerated}
      />,
    )

    fireEvent.submit(container.querySelector("form")!)

    await waitFor(() => expect(screen.getByText("Resume not found")).toBeTruthy())
    expect(onGenerated).not.toHaveBeenCalled()
  })

  it("keeps the redirecting call shape by default", async () => {
    mockGenerate.mockResolvedValue(undefined)

    const { container } = render(
      <CoverLetterForm
        resumes={resumes}
        applications={applications}
        lockedApplication={applications[0]}
      />,
    )

    fireEvent.submit(container.querySelector("form")!)

    await waitFor(() => expect(mockGenerate).toHaveBeenCalled())
    // One argument only: the action keeps its hard redirect.
    expect(mockGenerate.mock.calls[0]).toHaveLength(1)
  })
})

describe("cover letter form — variants", () => {
  it("keeps the card chrome and the job line by default", () => {
    render(
      <CoverLetterForm
        resumes={resumes}
        applications={applications}
        lockedApplication={applications[0]}
      />,
    )

    // The card title plus the submit button.
    expect(screen.getAllByText("Generate Cover Letter")).toHaveLength(2)
    expect(screen.getByText("Cover letter for: Northwind — Platform")).toBeTruthy()
  })

  it("drops both when bare — the host already names the job", () => {
    const { container } = render(
      <CoverLetterForm
        resumes={resumes}
        applications={applications}
        lockedApplication={applications[0]}
        variant="bare"
      />,
    )

    // The submit button is the only "Generate Cover Letter" left.
    expect(screen.queryByText(/Cover letter for:/)).toBeNull()
    expect(screen.getAllByText("Generate Cover Letter")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Generate Cover Letter" })).toBeTruthy()
    // The form itself is the root, not a card.
    expect(container.firstChild?.nodeName).toBe("FORM")
    // Every field survives the chrome change.
    expect(screen.getByLabelText("Resume")).toBeTruthy()
  })
})

describe("cover letter form — dropped request", () => {
  it("reports the failure and re-enables the button", async () => {
    mockGenerate.mockRejectedValue(new TypeError("Failed to fetch"))

    const { container } = render(
      <CoverLetterForm
        resumes={resumes}
        applications={applications}
        lockedApplication={applications[0]}
      />,
    )

    fireEvent.submit(container.querySelector("form")!)

    await waitFor(() =>
      expect(screen.getByText("Couldn't reach RoleSpec — try again.")).toBeTruthy(),
    )
    const submit = screen.getByRole("button", {
      name: "Generate Cover Letter",
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })
})

describe("cover letter form — framework redirect", () => {
  it("rethrows a redirect instead of calling it a network failure", async () => {
    // What `redirect()` throws once it reaches the client.
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/x",
    })
    mockGenerate.mockRejectedValue(redirectError)

    const { container } = render(
      <CoverLetterForm
        resumes={resumes}
        applications={applications}
        lockedApplication={applications[0]}
      />,
    )

    // The handler is invoked directly so the rejection can be asserted instead
    // of escaping as an unhandled one, which is what a rethrow looks like here.
    const formEl = container.querySelector("form")!
    const propsKey = Object.keys(formEl).find((key) =>
      key.startsWith("__reactProps$"),
    )!
    const { onSubmit } = (formEl as unknown as Record<
      string,
      { onSubmit: (event: unknown) => Promise<void> }
    >)[propsKey]

    await expect(
      onSubmit({ preventDefault: () => {}, currentTarget: formEl }),
    ).rejects.toBe(redirectError)

    expect(screen.queryByText("Couldn't reach RoleSpec — try again.")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
