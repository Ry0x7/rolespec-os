import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}))

import { IntakePanel } from "../intake-panel"
import type { IntakeRunDTO } from "../../types"

const RUN: IntakeRunDTO = {
  id: "run-1",
  status: "COMPLETED",
  requestedSources: ["RESUME"],
  error: null,
  warnings: [],
  startedAt: "2026-11-11T10:00:00.000Z",
  finishedAt: "2026-11-11T10:00:02.000Z",
  createdAt: "2026-11-11T10:00:00.000Z",
  sources: [
    {
      id: "source-1",
      source: "RESUME",
      status: "SUCCEEDED",
      progress: 100,
      message: "1 fact ready for review.",
      error: null,
      startedAt: "2026-11-11T10:00:00.000Z",
      finishedAt: "2026-11-11T10:00:02.000Z",
    },
  ],
  patches: [
    {
      id: "patch-1",
      kind: "EVIDENCE",
      source: "RESUME",
      status: "PENDING",
      confidence: 85,
      data: {
        evidenceKind: "EXPERIENCE",
        title: "Backend Engineer",
        organization: "Acme",
        details: "Built the billing service.",
        outcome: null,
        startDate: "2021-01-01",
        endDate: "2023-12-31",
      },
      provenance: {
        adapter: "resume-text",
        sourceUrl: null,
        fileName: "ada.pdf",
        externalId: null,
        locator: "experience:1",
        fetchedAt: "2026-11-11T10:00:00.000Z",
        detail: null,
      },
      rejectionReason: null,
      appliedTargetType: null,
      appliedTargetId: null,
      correctedAt: null,
      conflict: null,
    },
  ],
  counts: { pending: 1, applied: 0, conflicts: 0, rejected: 0 },
}

const PROPS = {
  initialRuns: [RUN],
  resumes: [{ id: "resume-1", title: "Master resume" }],
  githubUrl: null,
  websiteUrl: null,
  missingFields: [],
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("IntakePanel", () => {
  it("uses arrow keys and a labelled panel for source tabs", () => {
    render(<IntakePanel {...PROPS} />)
    const resume = screen.getByRole("tab", { name: "Resume" })
    fireEvent.keyDown(resume, { key: "ArrowRight" })
    const github = screen.getByRole("tab", { name: "GitHub" })
    expect(document.activeElement).toBe(github)
    expect(github.getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("tabpanel", { name: "GitHub" })).toBeTruthy()
    expect(resume.getAttribute("tabindex")).toBe("-1")
  })
  it("appends only new speech results instead of repeating the cumulative transcript", () => {
    const recognitions: { onresult: ((event: { resultIndex: number; results: { transcript: string }[][] }) => void) | null }[] = []
    class Recognition {
      continuous = false
      interimResults = false
      lang = ""
      onresult = null
      onerror = null
      onend = null
      constructor() { recognitions.push(this) }
      start() {}
      stop() {}
    }
    vi.stubGlobal("SpeechRecognition", Recognition)
    render(<IntakePanel {...PROPS} />)
    fireEvent.click(screen.getByRole("tab", { name: "Voice transcript" }))
    fireEvent.click(screen.getByRole("button", { name: "Use microphone" }))
    // Real Web Speech events contain every result so far plus the first changed index.
    const first = [[{ transcript: "I use React." }]]
    act(() => {
      recognitions[0].onresult?.({ resultIndex: 0, results: first })
      recognitions[0].onresult?.({ resultIndex: 1, results: [...first, [{ transcript: "I use TypeScript." }]] })
    })
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }))
    expect((screen.getByLabelText("Transcript") as HTMLTextAreaElement).value).toBe("I use React. I use TypeScript.")
    vi.unstubAllGlobals()
  })
  it("shows the proposed fact with its source and confidence", () => {
    render(<IntakePanel {...PROPS} />)

    expect(screen.getByText("Backend Engineer at Acme (2021-01-01 – 2023-12-31)")).toBeTruthy()
    expect(screen.getByText(/85% confidence/)).toBeTruthy()
    expect(screen.getByText(/ada.pdf/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply to profile" })).toBeTruthy()
  })

  it("applies a fact and refreshes the server-rendered profile", async () => {
    const appliedRun: IntakeRunDTO = {
      ...RUN,
      patches: [
        {
          ...RUN.patches[0],
          status: "APPLIED",
          appliedTargetType: "career_evidence",
          appliedTargetId: "evidence-1",
        },
      ],
      counts: { pending: 0, applied: 1, conflicts: 0, rejected: 0 },
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/patches/patch-1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "APPLIED",
            patchId: "patch-1",
            message: "Added as candidate evidence.",
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ run: appliedRun }),
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<IntakePanel {...PROPS} />)
    fireEvent.click(screen.getByRole("button", { name: "Apply to profile" }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/intake/run-1/patches/patch-1",
        expect.objectContaining({ method: "POST" })
      )
    )
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url === "/api/intake/run-1")
      ).toBe(true)
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    vi.unstubAllGlobals()
  })

  it("offers all six intake sources without requiring AI", () => {
    render(<IntakePanel {...PROPS} />)

    for (const label of [
      "Resume",
      "GitHub",
      "LinkedIn export",
      "Portfolio / website",
      "Conversational chat",
      "Voice transcript",
    ]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy()
    }
  })

  it("reuses review operations without importing or applying anything on entry", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    render(<IntakePanel {...PROPS} reviewOnly />)
    expect(screen.queryByRole("tab", { name: "Resume" })).toBeNull()
    expect(screen.getByRole("button", { name: "Apply to profile" })).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("renders a successful HTTP conflict as a human choice, never an applied fact", async () => {
    const conflictRun: IntakeRunDTO = {
      ...RUN,
      patches: [{ ...RUN.patches[0], status: "CONFLICT", conflict: { id: "conflict-1", existingType: "career_evidence", existingId: "existing-evidence-1", field: "details", status: "OPEN", existing: { details: "Existing fact" }, incoming: { details: "Imported fact" }, resolution: null } }],
      counts: { pending: 0, applied: 0, conflicts: 1, rejected: 0 },
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => url.endsWith("patch-1") ? { status: "CONFLICT", message: "Compare the values before choosing." } : { run: conflictRun } }))
    vi.stubGlobal("fetch", fetchMock)
    render(<IntakePanel {...PROPS} reviewOnly />)
    fireEvent.click(screen.getByRole("button", { name: "Apply to profile" }))
    await screen.findByRole("button", { name: "Keep existing" })
    expect(screen.getByRole("button", { name: "Use imported" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Keep both" })).toBeTruthy()
    expect(screen.queryByText("Added to profile")).toBeNull()
    expect(screen.getByText("Compare the values before choosing.")).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it("keeps an unsuccessful correction open with the user's edit intact", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "Confirmed evidence cannot be overwritten." }) }))
    render(<IntakePanel {...PROPS} reviewOnly />)
    fireEvent.click(screen.getByRole("button", { name: "Correct" }))
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Keep my correction" } })
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }))
    await screen.findByRole("alert")
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Keep my correction")
    expect(screen.getByRole("button", { name: "Save correction" })).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it("restores a failed chat preview for an explicit retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Could not extract this message. Retry when connected." }) }))
    render(<IntakePanel {...PROPS} />)
    fireEvent.click(screen.getByRole("tab", { name: "Conversational chat" }))
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "My actual career details" } })
    fireEvent.click(screen.getByRole("button", { name: "Preview facts" }))
    await screen.findByRole("alert")
    expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).value).toBe("My actual career details")
    expect((screen.getByRole("button", { name: "Start chat intake" }) as HTMLButtonElement).disabled).toBe(true)
    vi.unstubAllGlobals()
  })

  it("preserves all 50 loaded review runs after refreshing the selected run", async () => {
    const runs = Array.from({ length: 50 }, (_, index) => ({ ...RUN, id: `run-${index + 1}`, createdAt: new Date(Date.UTC(2026, 10, 12, 10, 0, 50 - index)).toISOString() }))
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ run: { ...runs[0], warnings: ["Refreshed persisted run"] } }) })
    vi.stubGlobal("fetch", fetchMock)
    render(<IntakePanel {...PROPS} initialRuns={runs} reviewOnly />)
    const runPicker = screen.getByRole("combobox", { name: "Choose an intake run" }) as HTMLSelectElement
    expect(runPicker.options.length).toBe(50)
    fireEvent.click(screen.getByRole("button", { name: "Refresh run" }))
    await screen.findByText("Refreshed persisted run")
    expect(runPicker.options.length).toBe(50)
    expect(Array.from(runPicker.options).some((option) => option.value === "run-50")).toBe(true)
    vi.unstubAllGlobals()
  })
})
