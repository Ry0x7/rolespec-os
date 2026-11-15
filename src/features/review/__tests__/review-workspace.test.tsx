import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReviewTaskDTO } from "@/features/workflows/types"
import { ReviewDecision, ReviewWorkspace, reviewResolution } from "../components/review-workspace"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const task: ReviewTaskDTO = {
  id: "review-1", runId: null, stepId: null, jobApplicationId: null, atsPreparationId: null,
  kind: "SUBMISSION_CONFIRMATION", status: "OPEN", question: "Review this preparation?", reason: "Nothing has been submitted.", category: null, fallback: null,
  suggestedValue: { preparedFieldCount: 4, blockedQuestionCount: 2, tailoredResumeId: "resume-1", validationStatus: "PASS", validationIssueCount: 0 },
  answer: null, resolvedAt: null, createdAt: "2026-11-12T10:00:00.000Z",
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("review decision boundaries", () => {
  it("requires explicit preparation approval and never sends a submission confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ task: { ...task, status: "RESOLVED" } }) })
    vi.stubGlobal("fetch", fetchMock)
    const changed = vi.fn().mockResolvedValue(undefined)
    render(<ReviewDecision task={task} offline={false} onChanged={changed} />)
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole("button", { name: "Approve preparation" }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Approve preparation" }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith("/api/review-tasks/review-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "RESOLVE", value: { approved: true } }) }))
    expect(screen.getByText("Preparation approved. Nothing was submitted.")).toBeTruthy()
  })

  it("does not generate or prefill a sensitive ATS answer and defaults to this form", async () => {
    const sensitive = { ...task, kind: "SENSITIVE_ANSWER" as const, atsPreparationId: "prep-1", suggestedValue: "untrusted suggestion" }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ task: sensitive }) })
    vi.stubGlobal("fetch", fetchMock)
    render(<ReviewDecision task={sensitive} offline={false} onChanged={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.queryByText(/untrusted suggestion/)).toBeNull()
    expect((screen.getByLabelText("Your answer") as HTMLTextAreaElement).value).toBe("")
    expect((screen.getByLabelText("Remember this answer") as HTMLSelectElement).value).toBe("APPLICATION")
    expect(screen.getByText(/may replace a saved answer/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "My explicit answer" } })
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Save reviewed answer" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "RESOLVE", value: "My explicit answer", scope: "APPLICATION" })
  })

  it("retains input and permits retry after a backend failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "Question changed. Refresh before retrying." }) }).mockResolvedValue({ ok: true, json: async () => ({ task }) })
    vi.stubGlobal("fetch", fetchMock)
    const changed = vi.fn().mockResolvedValue(undefined)
    render(<ReviewDecision task={{ ...task, kind: "UNKNOWN_FIELD", suggestedValue: null }} offline={false} onChanged={changed} />)
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Keep this text" } })
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Save reviewed answer" }))
    await screen.findByRole("alert")
    expect((screen.getByLabelText("Your answer") as HTMLTextAreaElement).value).toBe("Keep this text")
    expect(changed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Save reviewed answer" }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  })

  it("keeps attachment and previous-answer comparison on their supported extension surface", () => {
    for (const kind of ["RESUME_ATTACHMENT", "CONFLICTING_ANSWER"] as const) expect(() => reviewResolution({ ...task, kind }, "pretend attachment", true, "GLOBAL")).toThrow(/extension/)
    render(<ReviewDecision task={{ ...task, kind: "RESUME_ATTACHMENT" }} offline={false} onChanged={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /Save reviewed answer|Approve/ })).toBeNull()
    expect(screen.getByRole("link", { name: "Extension connection instructions" }).getAttribute("href")).toBe("/settings/api")
  })

  it("sends acknowledgements without creating reusable answers for workflow checkpoints", () => {
    expect(reviewResolution({ ...task, kind: "MISSING_PROFILE_FACT" }, "", true, "GLOBAL")).toEqual({ action: "RESOLVE", value: { reviewed: true } })
    expect(() => reviewResolution(task, "", false, "APPLICATION")).toThrow(/Confirm/)
  })

  it("disables saving and dismissal while offline", () => {
    render(<ReviewDecision task={task} offline onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole("checkbox"))
    expect((screen.getByRole("button", { name: "Approve preparation" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Leave unanswered" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows actual prepared facts and unanswered questions from the persisted workflow", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workflow: { steps: [{ name: "PREPARE_ATS", output: { fields: { fullName: "Candidate Owner" }, needsUserAnswer: [{ question: "Which salary expectation do you want to provide?", reason: "This must be your decision." }], resumeExportReady: false } }] } }) })
    vi.stubGlobal("fetch", fetchMock)
    render(<ReviewDecision task={{ ...task, runId: "workflow-1" }} offline={false} onChanged={vi.fn()} />)
    await screen.findByText("Which salary expectation do you want to provide?")
    expect(screen.getByText("Candidate Owner")).toBeTruthy()
    expect(screen.getByText(/No resume PDF export is recorded/)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith("/api/workflows/workflow-1", expect.objectContaining({ credentials: "same-origin" }))
    expect(fetchMock.mock.calls.every(([, init]) => !init.method)).toBe(true)
  })

  it("explains a missing deep-linked question and retains selection when filters locate it", async () => {
    const located = { ...task, id: "older-review", status: "RESOLVED", question: "Previously reviewed preparation" }
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => ({ items: url.includes("status=RESOLVED") ? [located] : [task] }) }))
    vi.stubGlobal("fetch", fetchMock)
    render(<ReviewWorkspace initialTaskId="older-review" />)
    await screen.findByText(/requested question is unavailable in the current results/)
    expect(screen.getByText(/latest 50 matches/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "RESOLVED" } })
    await screen.findByRole("heading", { name: "Previously reviewed preparation" })
    expect(screen.queryByText(/requested question is unavailable in the current results/)).toBeNull()
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("/api/review-tasks?"))).toBe(true)
  })
})
