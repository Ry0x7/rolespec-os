import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { UploadResumeDialog } from "../upload-resume-dialog"

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }))

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe("UploadResumeDialog", () => {
  it.each([false, true])("sends explicit AI choice %s and closes after a successful import", async (useAi) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ resumeId: "resume-1" }) })
    vi.stubGlobal("fetch", fetchMock)
    const { container } = render(<UploadResumeDialog />)
    fireEvent.click(screen.getByRole("button", { name: "Upload Resume" }))
    // Dialog is portaled into document.body.
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File(["%PDF-1.4"], "resume.pdf", { type: "application/pdf" })] } })
    const checkbox = screen.getByRole("checkbox", { name: /Organize and polish with AI/ }) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    if (useAi) fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole("button", { name: useAi ? "Upload with AI" : "Import Resume" }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/resumes/resume-1"))
    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.get("useAi")).toBe(String(useAi))
    expect(body.get("optimizeBullets")).toBe(String(useAi))
    expect(screen.queryByRole("dialog")).toBeNull()
    fireEvent.click(container.querySelector("button")!)
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false)
  })
})
