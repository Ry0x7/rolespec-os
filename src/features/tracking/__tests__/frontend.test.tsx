import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { AttemptList, FollowUpList } from "../components/application-tracking"
import { AiStageSettings } from "@/features/settings/components/ai-stage-settings"
import { OutreachPlans } from "../components/tracking-workspace"
import type { SubmissionAttemptView } from "@/features/submissions/services/submission.service"
import type { FollowUpTaskView } from "@/features/jobs/services/follow-up-task.service"

const request = vi.hoisted(() => vi.fn())
const refresh = vi.hoisted(() => vi.fn())
const reload = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const sequences = vi.hoisted(() => ({ value: [] as unknown[] }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/shared/lib/api-client", () => ({ apiRequest: request }))
vi.mock("@/shared/hooks/use-api-resource", () => ({ useApiResource: (path: string) => ({ data: path.startsWith("/api/outreach") ? { sequences: sequences.value } : { items: [{ stage: "TAILOR", provider: "openai", configured: true, last4: "1234", model: "custom-model", defaultModel: "default-model" }], availableStages: ["TAILOR"] }, error: null, loading: false, offline: false, reload }) }))

const attempt = { id: "attempt-1", jobApplicationId: "application-1", resumeId: "resume-1", source: "MANUAL", status: "STAGED", jobTitle: "Engineer", companyName: "Example", createdAt: "2026-11-12T00:00:00Z" } as SubmissionAttemptView
const followUp = { id: "follow-1", jobApplicationId: "application-1", channel: "EMAIL", status: "PENDING", dueAt: "2026-11-19", reason: "Check in yourself" } as FollowUpTaskView

beforeEach(() => { vi.clearAllMocks(); sequences.value = []; request.mockResolvedValue({}); reload.mockResolvedValue(undefined) })
afterEach(cleanup)

describe("submission confirmation", () => {
  it("does not write on render, opening the dialog, or cancelling", () => {
    render(<AttemptList items={[attempt]} offline={false} onChanged={reload} />)
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "I submitted on the employer site" }))
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(request).not.toHaveBeenCalled()
  })
  it("records a positive confirmation only after the explicit final action", async () => {
    render(<AttemptList items={[attempt]} offline={false} onChanged={reload} />)
    fireEvent.click(screen.getByRole("button", { name: "I submitted on the employer site" }))
    fireEvent.change(screen.getByLabelText("Optional note"), { target: { value: "Submitted personally" } })
    fireEvent.click(screen.getByRole("button", { name: "Confirm I submitted" }))
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/submission-attempts/attempt-1", { method: "PATCH", body: JSON.stringify({ submitted: true, note: "Submitted personally" }) }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
  it("keeps a failed confirmation visible, preserves the note and supports retry", async () => {
    request.mockRejectedValueOnce(new Error("State changed. Reload before retrying.")).mockResolvedValueOnce({})
    render(<AttemptList items={[attempt]} offline={false} onChanged={reload} />)
    fireEvent.click(screen.getByRole("button", { name: "I did not submit" }))
    fireEvent.change(screen.getByLabelText("Optional note"), { target: { value: "Not ready" } })
    fireEvent.click(screen.getByRole("button", { name: "Confirm not submitted" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("State changed"))
    expect((screen.getByLabelText("Optional note") as HTMLTextAreaElement).value).toBe("Not ready")
    fireEvent.click(screen.getByRole("button", { name: "Confirm not submitted" }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ submitted: false, note: "Not ready" })
  })
  it("does not offer terminal or offline transitions", () => {
    const view = render(<AttemptList items={[{ ...attempt, status: "SUBMITTED" }]} offline={false} onChanged={reload} />)
    expect(screen.queryByRole("button", { name: "I did not submit" })).toBeNull()
    view.rerender(<AttemptList items={[attempt]} offline={true} onChanged={reload} />)
    expect((screen.getByRole("button", { name: "I submitted on the employer site" }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("follow-up reminders", () => {
  it("records only DONE and never sends a message", async () => {
    render(<FollowUpList items={[followUp]} offline={false} onChanged={reload} />)
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }))
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/follow-ups/follow-1", { method: "PATCH", body: JSON.stringify({ action: "DONE" }) }))
  })
  it("does not expose actions for cancelled tasks", () => {
    render(<FollowUpList items={[{ ...followUp, status: "CANCELLED" }]} offline={false} onChanged={reload} />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("stage settings", () => {
  function tailorSection() {
    fireEvent.click(screen.getByRole("tab", { name: "Tailor" }))
    return screen.getByRole("heading", { name: "Tailor" }).closest("section")!
  }
  it("omits a blank key to preserve the saved secret and never displays it", async () => {
    render(<AiStageSettings />)
    const section = within(tailorSection())
    fireEvent.click(section.getByRole("button", { name: "Edit override" }))
    fireEvent.click(section.getByRole("button", { name: "Save tailor override" }))
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/settings/ai-stages", { method: "PUT", body: JSON.stringify({ stage: "TAILOR", provider: "openai", model: "custom-model" }) }))
    expect(screen.getByText(/key ending 1234/)).toBeTruthy()
  })
  it("clears keys only after an explicit checkbox and warns on provider change", async () => {
    render(<AiStageSettings />)
    const section = within(tailorSection())
    fireEvent.click(section.getByRole("button", { name: "Edit override" }))
    fireEvent.change(section.getByLabelText("Provider"), { target: { value: "anthropic" } })
    expect(section.getByText(/Changing provider clears/)).toBeTruthy()
    fireEvent.click(section.getByRole("checkbox"))
    fireEvent.click(section.getByRole("button", { name: "Save tailor override" }))
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/settings/ai-stages", { method: "PUT", body: JSON.stringify({ stage: "TAILOR", provider: "anthropic", model: "custom-model", clearApiKey: true }) }))
  })
})

describe("outreach plans", () => {
  it("creates a draft only on submit and retains a replay key after network failure", async () => {
    request.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({})
    render(<OutreachPlans />)
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "New outreach plan" }))
    fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Platform outreach" } })
    fireEvent.change(screen.getByLabelText("Contact name"), { target: { value: "Recruiter" } })
    fireEvent.click(screen.getByRole("button", { name: "Save draft plan" }))
    await screen.findByRole("alert")
    const first = JSON.parse(request.mock.calls[0][1].body)
    expect(first.contact).toEqual({ name: "Recruiter" })
    expect(first.idempotencyKey).toBeTruthy()
    expect(first.action).toBeUndefined()
    fireEvent.click(screen.getByRole("button", { name: "Save draft plan" }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(JSON.parse(request.mock.calls[1][1].body).idempotencyKey).toBe(first.idempotencyKey)
    await screen.findByText(/saved as a draft/)
  })
  it("offers touches only after activation, and cancelling needs confirmation", async () => {
    sequences.value = [{ id: "sequence-1", name: "Platform outreach", status: "DRAFT", contact: { name: "Recruiter" }, touches: [{ id: "touch-1", channel: "EMAIL", dueOn: "2026-11-12", note: "Introduce yourself", status: "PENDING" }] }]
    render(<OutreachPlans />)
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Cancel plan" }))
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel plan" }))
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/outreach/sequences/sequence-1", { method: "PATCH", body: JSON.stringify({ action: "CANCEL" }) }))
  })
})
