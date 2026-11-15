import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ResumePdfDrawer } from "../resume-pdf-drawer"
import { useResumeStore } from "../../hooks/use-resume-store"
import type { ResumeData } from "../../hooks/use-resume-store"
import { DEFAULT_CUSTOMIZATION } from "../../types/customization"

const exportPdf = vi.hoisted(() => vi.fn())
vi.mock("@/features/export/actions/export-pdf", () => ({ exportResumePdf: exportPdf }))
beforeEach(() => {
  vi.clearAllMocks()
  useResumeStore.setState({ resume: { id: "resume-1", version: 2, template: "MINIMAL" } as ResumeData, isDirty: false, saveStatus: "idle", customization: DEFAULT_CUSTOMIZATION, groupAdditional: false, groupAdditionalTitle: "Additional" })
  exportPdf.mockResolvedValue({ success: true, pdfUrl: "/api/exports/resume-1/render/file.pdf", template: "MINIMAL" })
})
afterEach(cleanup)

describe("generated PDF preview", () => {
  it("does not fabricate a PDF before an explicit real export", async () => {
    render(<ResumePdfDrawer resumeId="resume-1" onSave={vi.fn()} open onClose={vi.fn()} />)
    expect(exportPdf).not.toHaveBeenCalled()
    expect(screen.queryByRole("link", { name: /Preview generated PDF in a new tab/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Generate PDF preview" }))
    await waitFor(() => expect(screen.getByRole("link", { name: /Preview generated PDF in a new tab/ }).getAttribute("href")).toBe("/api/exports/resume-1/render/file.pdf"))
    expect(screen.getByRole("link", { name: /Preview generated PDF in a new tab/ }).getAttribute("target")).toBe("_blank")
    expect(screen.getByText(/security policy blocks embedded documents/)).toBeTruthy()
    expect(document.querySelector("iframe, object, embed")).toBeNull()
    expect(screen.queryByText(/Rendered PDF:/)).toBeNull()
  })
  it("reports genuine measured overflow without claiming one page", async () => {
    exportPdf.mockResolvedValue({ success: true, pdfUrl: "/api/exports/resume-1/render/file.pdf", template: "MINIMAL", pageCount: 2, singlePageSatisfied: false, warning: "Content requires more than one page" })
    render(<ResumePdfDrawer resumeId="resume-1" onSave={vi.fn()} open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Try to fit one page" }))
    fireEvent.click(screen.getByRole("button", { name: "Generate PDF preview" }))
    await screen.findByText(/Rendered PDF: 2 pages/)
    expect(screen.getByText(/Content requires more than one page/).textContent).toContain("not been truncated")
    expect(exportPdf.mock.calls[0][1].singlePage).toBe(true)
  })
  it("refuses to render an older revision after an unsuccessful save", async () => {
    useResumeStore.setState({ isDirty: true, saveStatus: "error" })
    const onSave = vi.fn()
    render(<ResumePdfDrawer resumeId="resume-1" onSave={onSave} open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Generate PDF preview" }))
    await screen.findByRole("alert")
    expect(onSave).toHaveBeenCalledOnce()
    expect(exportPdf).not.toHaveBeenCalled()
  })
  it("preserves export failure and retries without clearing draft content", async () => {
    exportPdf.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ success: true, pdfUrl: "/api/exports/resume-1/render/file.pdf", template: "MINIMAL" })
    render(<ResumePdfDrawer resumeId="resume-1" onSave={vi.fn()} open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Generate PDF preview" }))
    await screen.findByRole("alert")
    fireEvent.click(screen.getByRole("button", { name: "Generate PDF preview" }))
    await waitFor(() => expect(screen.getByRole("link", { name: /Preview generated PDF in a new tab/ })).toBeTruthy())
    expect(screen.queryByRole("alert")).toBeNull()
    expect(useResumeStore.getState().resume?.version).toBe(2)
  })
  it.each(["customization", "groupAdditional", "groupAdditionalTitle", "singlePage"])("marks the PDF stale after %s changes without a version bump", async setting => {
    render(<ResumePdfDrawer resumeId="resume-1" onSave={vi.fn()} open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Generate PDF preview" }))
    await screen.findByRole("link", { name: /Preview generated PDF in a new tab/ })
    expect(screen.queryByText(/does not match the latest/)).toBeNull()
    if (setting === "singlePage") fireEvent.click(screen.getByRole("checkbox", { name: "Try to fit one page" }))
    else act(() => {
      if (setting === "customization") useResumeStore.setState({ customization: { ...DEFAULT_CUSTOMIZATION, fontScale: 1.1 } })
      if (setting === "groupAdditional") useResumeStore.setState({ groupAdditional: true })
      if (setting === "groupAdditionalTitle") useResumeStore.setState({ groupAdditionalTitle: "Other experience" })
    })
    expect(useResumeStore.getState().resume?.version).toBe(2)
    expect(screen.getByText(/does not match the latest edits or presentation settings/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Regenerate PDF" }))
    await waitFor(() => expect(screen.queryByText(/does not match the latest/)).toBeNull())
  })
  it("disables generation while a clean-flagged draft is still saving", () => {
    useResumeStore.setState({ isDirty: false, saveStatus: "saving" })
    render(<ResumePdfDrawer resumeId="resume-1" onSave={vi.fn()} open onClose={vi.fn()} />)
    const button = screen.getByRole("button", { name: "Generate PDF preview" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(exportPdf).not.toHaveBeenCalled()
  })
})
