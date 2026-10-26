import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useResumeStore } from "../use-resume-store"
import type { ResumeData } from "../use-resume-store"

vi.mock("../../actions/save", () => ({
  saveResume: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { saveResume } from "../../actions/save"
import { useAutosave } from "../use-autosave"

const mockedSaveResume = vi.mocked(saveResume)

const makeResume = (overrides: Partial<ResumeData> = {}): ResumeData => ({
  id: "resume-autosave",
  title: "Autosave Resume",
  targetRole: null,
  targetCompany: null,
  template: "MINIMAL",
  sections: [
    {
      id: "section-1",
      resumeId: "resume-autosave",
      type: "SUMMARY",
      title: "Summary",
      order: 0,
      visible: true,
      items: [
        {
          id: "item-1",
          sectionId: "section-1",
          content: { text: "Original" },
          order: 0,
        },
      ],
    },
  ],
  atsScore: null,
  jobDescription: null,
  latestAnalysis: null,
  ...overrides,
})

describe("useAutosave", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockedSaveResume.mockResolvedValue({ success: true, idMap: {} })
    useResumeStore.getState().setResume(makeResume())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("saves after the debounce delay once the resume is dirty", async () => {
    renderHook(() => useAutosave())

    act(() => {
      useResumeStore.getState().updateSectionItem("section-1", "item-1", { text: "Edited" })
    })
    expect(mockedSaveResume).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(8000)
    })

    expect(mockedSaveResume).toHaveBeenCalledTimes(1)
    expect(mockedSaveResume).toHaveBeenCalledWith(
      "resume-autosave",
      useResumeStore.getState().resume!.sections
    )
    expect(useResumeStore.getState().isDirty).toBe(false)
    expect(useResumeStore.getState().saveStatus).toBe("saved")
    expect(useResumeStore.getState().lastSavedAt).toBeInstanceOf(Date)
  })

  it("does not save before the delay elapses", async () => {
    renderHook(() => useAutosave())

    act(() => {
      useResumeStore.getState().updateSectionItem("section-1", "item-1", { text: "Edited" })
    })
    // The debounce is 2500ms: one millisecond short must stay silent.
    act(() => {
      vi.advanceTimersByTime(2499)
    })

    expect(mockedSaveResume).not.toHaveBeenCalled()

    // Crossing the boundary is what arms the save — the assertion above only
    // means something if the very next tick does fire it.
    await act(async () => {
      vi.advanceTimersByTime(1)
    })

    expect(mockedSaveResume).toHaveBeenCalledTimes(1)
  })

  it("flushes a pending save exactly once when the editor unmounts", async () => {
    const { unmount } = renderHook(() => useAutosave())

    act(() => {
      useResumeStore.getState().updateSectionItem("section-1", "item-1", { text: "Typed then left" })
    })
    // Client-side nav happens well before the 2.5s debounce fires.
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(mockedSaveResume).not.toHaveBeenCalled()

    await act(async () => {
      unmount()
    })

    expect(mockedSaveResume).toHaveBeenCalledTimes(1)
    expect(mockedSaveResume).toHaveBeenCalledWith("resume-autosave", [
      expect.objectContaining({
        id: "section-1",
        items: [expect.objectContaining({ content: { text: "Typed then left" } })],
      }),
    ])
    expect(useResumeStore.getState().isDirty).toBe(false)
    expect(useResumeStore.getState().lastSavedAt).toBeInstanceOf(Date)
  })

  it("does not flush on unmount when there is nothing dirty", async () => {
    const { unmount } = renderHook(() => useAutosave())

    await act(async () => {
      unmount()
    })

    expect(mockedSaveResume).not.toHaveBeenCalled()
  })

  it("does not double-fire when unmount lands mid-save", async () => {
    let resolveSave: (value: { success: true; idMap: Record<string, string> }) => void = () => {}
    mockedSaveResume.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )

    const { unmount } = renderHook(() => useAutosave())

    act(() => {
      useResumeStore.getState().updateSectionItem("section-1", "item-1", { text: "Edited" })
    })
    // The debounced save is in flight (still dirty — markClean waits on the
    // promise) when the user navigates away.
    act(() => {
      vi.advanceTimersByTime(8000)
    })
    expect(mockedSaveResume).toHaveBeenCalledTimes(1)
    expect(useResumeStore.getState().isDirty).toBe(true)

    await act(async () => {
      unmount()
    })

    expect(mockedSaveResume).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSave({ success: true, idMap: {} })
    })

    expect(mockedSaveResume).toHaveBeenCalledTimes(1)
    expect(useResumeStore.getState().isDirty).toBe(false)
  })

  it("keeps edits typed during an in-flight save dirty and saves them next", async () => {
    let resolveSave: (value: { success: true; idMap: Record<string, string> }) => void = () => {}
    mockedSaveResume.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )

    renderHook(() => useAutosave())

    act(() => {
      useResumeStore.getState().updateSectionItem("section-1", "item-1", { text: "First" })
    })
    await act(async () => {
      vi.advanceTimersByTime(8000)
    })
    expect(mockedSaveResume).toHaveBeenCalledTimes(1)

    // The user keeps typing while the first save is still on the wire.
    act(() => {
      useResumeStore.getState().updateSectionItem("section-1", "item-1", { text: "Second" })
    })
    await act(async () => {
      resolveSave({ success: true, idMap: {} })
    })

    expect(useResumeStore.getState().isDirty).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(8000)
    })

    expect(mockedSaveResume).toHaveBeenCalledTimes(2)
    expect(mockedSaveResume).toHaveBeenLastCalledWith("resume-autosave", [
      expect.objectContaining({
        items: [expect.objectContaining({ content: { text: "Second" } })],
      }),
    ])
    expect(useResumeStore.getState().isDirty).toBe(false)
  })

  it("reports a save failure through the store and a toast", async () => {
    mockedSaveResume.mockResolvedValue({ error: "Resume not found" })
    renderHook(() => useAutosave())

    act(() => {
      useResumeStore.getState().updateSectionItem("section-1", "item-1", { text: "Edited" })
    })
    await act(async () => {
      vi.advanceTimersByTime(8000)
    })

    const { toast } = await import("sonner")
    expect(useResumeStore.getState().saveStatus).toBe("error")
    expect(useResumeStore.getState().isDirty).toBe(true)
    expect(toast.error).toHaveBeenCalledWith("Resume not found")
  })
})
