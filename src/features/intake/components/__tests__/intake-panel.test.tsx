import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

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
})
