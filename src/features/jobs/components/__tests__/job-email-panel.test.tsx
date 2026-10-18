import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const {
  mockUseSession,
  mockUpdate,
  mockGenerateApplication,
  mockGenerateCold,
  mockGenerateReply,
  mockToastError,
  mockToastSuccess,
  mockPush,
} = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockUpdate: vi.fn(),
  mockGenerateApplication: vi.fn(),
  mockGenerateCold: vi.fn(),
  mockGenerateReply: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockPush: vi.fn(),
}))

vi.mock("next-auth/react", () => ({ useSession: mockUseSession }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }))
vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: mockToastSuccess },
}))
vi.mock("../../actions/application-email.actions", () => ({
  generateApplicationEmail: mockGenerateApplication,
}))
vi.mock("../../actions/cold-email.actions", () => ({
  generateColdEmail: mockGenerateCold,
}))
vi.mock("../../actions/reply-email.actions", () => ({
  generateReplyEmail: mockGenerateReply,
}))

import { JobEmailPanel } from "../job-email-panel"

const resumeOptions = [{ id: "r1", title: "Engineer", atsScore: 70 }]

function renderPanel() {
  return render(
    <JobEmailPanel jobApplicationId="j1" resumeOptions={resumeOptions} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue({})
  mockUseSession.mockReturnValue({ update: mockUpdate })
})

afterEach(cleanup)

describe("job email panel", () => {
  it("offers both email types with application selected by default", () => {
    renderPanel()
    const application = screen.getByRole("button", { name: "Application email" })
    const cold = screen.getByRole("button", { name: "Cold email" })
    expect(application.getAttribute("aria-pressed")).toBe("true")
    expect(cold.getAttribute("aria-pressed")).toBe("false")
  })

  it("calls the application-email action and renders the result", async () => {
    mockGenerateApplication.mockResolvedValue({
      subject: "Application for Platform — Jo",
      body: "Hi Dana",
    })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /generate/i }))

    await waitFor(() => expect(mockGenerateApplication).toHaveBeenCalled())
    expect(mockGenerateCold).not.toHaveBeenCalled()
    const formData = mockGenerateApplication.mock.calls[0][0] as FormData
    expect(formData.get("jobApplicationId")).toBe("j1")
    expect(formData.get("resumeId")).toBe("r1")

    await waitFor(() => expect(screen.getByText(/isn't saved/i)).toBeTruthy())
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe(
      "Application for Platform — Jo",
    )
    expect((screen.getByLabelText("Email") as HTMLTextAreaElement).value).toBe("Hi Dana")
  })

  it("calls the cold-email action once the cold type is selected", async () => {
    mockGenerateCold.mockResolvedValue({ subject: "Quick idea", body: "Body" })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Cold email" }))

    fireEvent.click(screen.getByRole("button", { name: /generate/i }))

    await waitFor(() => expect(mockGenerateCold).toHaveBeenCalled())
    expect(mockGenerateApplication).not.toHaveBeenCalled()
    await waitFor(() =>
      expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe(
        "Quick idea",
      ),
    )
  })

  it("shows errors as a plain toast", async () => {
    mockGenerateApplication.mockResolvedValue({ error: "Create a resume first" })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /generate/i }))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Create a resume first"),
    )
  })

  it("shows the received-email field only in reply mode, with a counter", () => {
    renderPanel()
    expect(screen.queryByLabelText(/paste the email you received/i)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Reply assist" }))

    const received = screen.getByLabelText(/paste the email you received/i) as HTMLTextAreaElement
    expect(received).toBeTruthy()
    expect(screen.getByText("0/8000")).toBeTruthy()

    fireEvent.change(received, { target: { value: "Hi, are you free?" } })
    expect(screen.getByText("17/8000")).toBeTruthy()
  })

  it("refuses to generate a reply with an empty received email", async () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Reply assist" }))
    fireEvent.click(screen.getByRole("button", { name: /generate/i }))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Paste the email you received first"),
    )
    expect(mockGenerateReply).not.toHaveBeenCalled()
  })

  it("calls the reply action with the pasted email and renders the result", async () => {
    mockGenerateReply.mockResolvedValue({
      subject: "Re: Your application",
      body: "Hi Dana, thank you",
    })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Reply assist" }))
    fireEvent.change(screen.getByLabelText(/paste the email you received/i), {
      target: { value: "Thanks for applying — are you free?" },
    })
    fireEvent.click(screen.getByRole("button", { name: /generate/i }))

    await waitFor(() => expect(mockGenerateReply).toHaveBeenCalled())
    expect(mockGenerateApplication).not.toHaveBeenCalled()
    expect(mockGenerateCold).not.toHaveBeenCalled()
    const formData = mockGenerateReply.mock.calls[0][0] as FormData
    expect(formData.get("jobApplicationId")).toBe("j1")
    expect(formData.get("receivedEmail")).toBe("Thanks for applying — are you free?")

    await waitFor(() =>
      expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe(
        "Re: Your application",
      ),
    )
    expect((screen.getByLabelText("Email") as HTMLTextAreaElement).value).toBe(
      "Hi Dana, thank you",
    )
  })

  it("shows the tone and length controls only in reply mode, defaulting to professional/standard", () => {
    renderPanel()
    expect(screen.queryByRole("group", { name: "Tone" })).toBeNull()
    expect(screen.queryByRole("group", { name: "Length" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Reply assist" }))

    expect(screen.getByRole("group", { name: "Tone" })).toBeTruthy()
    expect(screen.getByRole("group", { name: "Length" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Professional" }).getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(screen.getByRole("button", { name: "Warm" }).getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByRole("button", { name: "Standard" }).getAttribute("aria-pressed")).toBe(
      "true",
    )
  })

  it("shows the thread textarea only in reply mode and submits it", async () => {
    mockGenerateReply.mockResolvedValue({ subject: "Re: x", body: "Body" })

    renderPanel()
    expect(screen.queryByLabelText(/earlier messages in this thread/i)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Reply assist" }))
    expect(screen.getByText("0/6000")).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/paste the email you received/i), {
      target: { value: "Are you free?" },
    })
    fireEvent.change(screen.getByLabelText(/earlier messages in this thread/i), {
      target: { value: "We received your application." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Direct" }))
    fireEvent.click(screen.getByRole("button", { name: "Brief" }))
    fireEvent.click(screen.getByRole("button", { name: /generate/i }))

    await waitFor(() => expect(mockGenerateReply).toHaveBeenCalled())
    const formData = mockGenerateReply.mock.calls[0][0] as FormData
    expect(formData.get("priorThread")).toBe("We received your application.")
    expect(formData.get("tone")).toBe("direct")
    expect(formData.get("length")).toBe("brief")
    // Nothing to regenerate away from on the first pass.
    expect(formData.get("previousDraft")).toBeNull()
  })

  it("sends the current body as previousDraft on a regenerate", async () => {
    mockGenerateReply.mockResolvedValue({ subject: "Re: x", body: "First draft body" })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Reply assist" }))
    fireEvent.change(screen.getByLabelText(/paste the email you received/i), {
      target: { value: "Are you free?" },
    })
    fireEvent.click(screen.getByRole("button", { name: /generate/i }))

    await waitFor(() => expect(screen.getByRole("button", { name: /regenerate/i })).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }))

    await waitFor(() => expect(mockGenerateReply).toHaveBeenCalledTimes(2))
    const second = mockGenerateReply.mock.calls[1][0] as FormData
    expect(second.get("previousDraft")).toBe("First draft body")
  })

  it("does not send an application-email body as a reply previousDraft", async () => {
    mockGenerateApplication.mockResolvedValue({ subject: "Application", body: "Application body" })
    mockGenerateReply.mockResolvedValue({ subject: "Re: x", body: "Reply body" })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /generate/i }))
    await waitFor(() =>
      expect((screen.getByLabelText("Email") as HTMLTextAreaElement).value).toBe(
        "Application body",
      ),
    )

    // The panel disables its controls while a generation is in flight; wait for
    // it to settle before switching tabs so the click can't be swallowed.
    const replyTab = screen.getByRole("button", { name: "Reply assist" })
    await waitFor(() => expect((replyTab as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(replyTab)

    fireEvent.change(await screen.findByLabelText(/paste the email you received/i), {
      target: { value: "Are you free?" },
    })
    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }))

    await waitFor(() => expect(mockGenerateReply).toHaveBeenCalled())
    const formData = mockGenerateReply.mock.calls[0][0] as FormData
    expect(formData.get("previousDraft")).toBeNull()
  })

  it("tells the user to create a resume when they have none", () => {
    render(<JobEmailPanel jobApplicationId="j1" resumeOptions={[]} />)
    expect(screen.getByText(/create a resume first/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /generate/i })).toBeNull()
  })
})

/**
 * The name checks the services already run, finally reaching the user. The
 * suppression case is the one worth a test: `missing_name` is a style finding
 * and must not nag, and a stale warning left over from a previous draft is worse
 * than no warning at all.
 */
describe("job email panel — the signature notice", () => {
  const WRONG_NAME = {
    issue: "wrong_name" as const,
    expectedName: "Marisol Reyes",
    signature: ["Best,", "Cebu General Hospital staff nurse"],
    offending: ["Cebu General Hospital staff nurse"],
  }
  const MISSING_NAME = {
    issue: "missing_name" as const,
    expectedName: "Marisol Reyes",
    signature: ["Best regards,"],
    offending: [],
  }
  const SUBJECT_WRONG = {
    issue: "wrong_name" as const,
    expectedName: "Marisol Reyes",
    offending: "Platform Team",
  }

  // The draft renders while the generate transition is still pending, so the
  // draft text alone is not a settled panel: the button still reads
  // "Generating…" and matches neither /generate/i nor /regenerate/i. Settle on
  // the button's own label, which is the thing that tracks `isPending`.
  async function generate() {
    fireEvent.click(screen.getByRole("button", { name: /generate/i }))
    await waitFor(() => expect(screen.getByText(/isn't saved/i)).toBeTruthy())
    await screen.findByRole("button", { name: /regenerate/i })
  }

  it("shows a wrong_name sign-off finding above the draft", async () => {
    mockGenerateApplication.mockResolvedValue({
      subject: "Application for Nurse",
      body: "Hi Dana",
      signature: WRONG_NAME,
      subjectName: null,
    })

    renderPanel()
    await generate()

    expect(screen.getByText(/Check the name before you send/)).toBeTruthy()
    expect(screen.getByText(/Cebu General Hospital staff nurse/)).toBeTruthy()
    expect(screen.getByText("Marisol Reyes")).toBeTruthy()
  })

  it("shows a subject-name finding", async () => {
    mockGenerateApplication.mockResolvedValue({
      subject: "Application for Nurse — Platform Team",
      body: "Hi Dana",
      signature: null,
      subjectName: SUBJECT_WRONG,
    })

    renderPanel()
    await generate()

    expect(screen.getByText(/Check the subject line/)).toBeTruthy()
  })

  it("shows NOTHING for a missing_name finding", async () => {
    mockGenerateApplication.mockResolvedValue({
      subject: "Application for Nurse",
      body: "Hi Dana",
      signature: MISSING_NAME,
      subjectName: null,
    })

    renderPanel()
    await generate()

    expect(screen.queryByText(/Check the name before you send/)).toBeNull()
  })

  it("clears the previous finding when the next draft comes back clean", async () => {
    mockGenerateApplication.mockResolvedValue({
      subject: "Application for Nurse",
      body: "Hi Dana",
      signature: WRONG_NAME,
      subjectName: SUBJECT_WRONG,
    })

    renderPanel()
    await generate()
    expect(screen.getByText(/Check the name before you send/)).toBeTruthy()

    mockGenerateApplication.mockResolvedValue({
      subject: "Application for Nurse — Marisol Reyes",
      body: "Hi Dana",
      signature: null,
      subjectName: null,
    })
    fireEvent.click(await screen.findByRole("button", { name: /regenerate/i }))

    await waitFor(() =>
      expect(screen.queryByText(/Check the name before you send/)).toBeNull()
    )
    expect(screen.queryByText(/Check the subject line/)).toBeNull()
  })
})

describe("job email panel — one resume per job", () => {
  const options = [
    { id: "r1", title: "Engineer", atsScore: 70 },
    { id: "r2", title: "Tailored for this job", atsScore: null },
  ]

  it("defaults to the resume the job page resolved rather than the first option", () => {
    render(
      <JobEmailPanel
        jobApplicationId="j1"
        resumeOptions={options}
        chosenResumeId="r2"
      />,
    )

    expect((screen.getByLabelText(/resume/i) as HTMLSelectElement).value).toBe("r2")
  })

  it("falls back to the first option when the page resolved none", () => {
    render(
      <JobEmailPanel
        jobApplicationId="j1"
        resumeOptions={options}
        chosenResumeId={null}
      />,
    )

    expect((screen.getByLabelText(/resume/i) as HTMLSelectElement).value).toBe("r1")
  })
})
