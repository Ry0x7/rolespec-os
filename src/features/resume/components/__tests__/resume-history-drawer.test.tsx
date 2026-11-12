import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ResumeHistoryDrawer } from "../resume-history-drawer"
import { useResumeStore } from "../../hooks/use-resume-store"

const history = vi.hoisted(() => vi.fn())
const rollback = vi.hoisted(() => vi.fn())
vi.mock("../../actions/history", () => ({ getResumeHistory: history }))
vi.mock("../../actions/rollback", () => ({ rollbackTailoredResume: rollback }))
const saved = {
  resumeId: "resume-1", version: 4, editEvents: [{ id: "edit-1", kind: "MANUAL_EDIT", versionBefore: 3, versionAfter: 4, summary: "Edited summary", createdAt: "2026-11-12T00:00:00Z" }],
  snapshots: [{ id: "snapshot-1", sourceResumeId: "source-1", sourceVersion: 2, hash: "abc123456789012345", capturedAt: "2026-11-11T00:00:00Z", restoredAt: null, restoreCount: 0 }],
  latestValidation: { id: "validation-1", status: "PASS", sourceHash: "source-only", createdAt: "2026-11-11T00:00:00Z", report: { issues: [], claims: [] } },
  requirements: [{ id: "requirement-1", text: "TypeScript", verdict: "SUPPORTED", evidenceRefs: [{ label: "Platform work", quote: "Built a TypeScript service", origin: "profile", ref: "profile:evidence-1" }] }], tailoring: null,
}
beforeEach(() => { vi.clearAllMocks(); useResumeStore.setState({ isDirty: false, saveStatus: "idle" }); history.mockResolvedValue({ data: saved }); rollback.mockResolvedValue({ error: "Snapshot unavailable" }) })
afterEach(cleanup)

describe("resume history", () => {
  it("labels PASS as historical and shows actual requirement provenance", async () => {
    render(<ResumeHistoryDrawer resumeId="resume-1" open onClose={vi.fn()} />)
    await screen.findByText("Historical PASS")
    expect(screen.getByText(/not proof that the current draft passes/)).toBeTruthy()
    expect(screen.getByText("Built a TypeScript service")).toBeTruthy()
    expect(rollback).not.toHaveBeenCalled()
  })
  it("requires explicit confirmation for the selected captured source and preserves failure", async () => {
    render(<ResumeHistoryDrawer resumeId="resume-1" open onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole("button", { name: "Restore source v2" }))
    expect(rollback).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Restore captured source" }))
    await waitFor(() => expect(rollback).toHaveBeenCalledWith("resume-1", "snapshot-1"))
    expect((await screen.findByRole("alert")).textContent).toBe("Snapshot unavailable")
  })
  it("does not allow restoring while unsaved changes exist", async () => {
    useResumeStore.setState({ isDirty: true })
    render(<ResumeHistoryDrawer resumeId="resume-1" open onClose={vi.fn()} />)
    const restore = await screen.findByRole("button", { name: "Restore source v2" }) as HTMLButtonElement
    expect(restore.disabled).toBe(true)
    fireEvent.click(restore)
    expect(rollback).not.toHaveBeenCalled()
  })
  it("recovers a history failure on refresh", async () => {
    history.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ data: saved })
    render(<ResumeHistoryDrawer resumeId="resume-1" open onClose={vi.fn()} />)
    await screen.findByRole("alert")
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }))
    await screen.findByText("Historical PASS")
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
