import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { LinkedinView } from "../linkedin-view"
import type { ProfileRatingData } from "@/shared/lib/rating/rating.service"
import type { RatingBenchmark } from "@/shared/lib/rating/schemas"
import { installMotionTestEnv } from "./motion-test-env"

const update = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()

vi.mock("next-auth/react", () => ({
  useSession: () => ({ update: (...args: unknown[]) => update(...args) }),
}))
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

beforeAll(installMotionTestEnv)

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

function pdf(name = "profile.pdf", size = 1000) {
  const file = new File(["x"], name, { type: "application/pdf" })
  Object.defineProperty(file, "size", { value: size })
  return file
}

const benchmark: RatingBenchmark = {
  role: "Senior Frontend Engineer",
  percentile: 42,
  summary: "Stronger tooling depth than most, but experience reads as duties.",
  benchmarkScores: {
    headline: 80,
    about: 82,
    experienceImpact: 85,
    skillsKeywords: 78,
    completeness: 88,
  },
  advantages: ["Rare depth in design systems"],
  gaps: ["No quantified impact in recent roles"],
}

function rating(overrides: Partial<ProfileRatingData> = {}): ProfileRatingData {
  return {
    id: "r1",
    kind: "LINKEDIN",
    sourceUrl: null,
    overallScore: 77,
    scores: {
      headline: 70,
      about: 80,
      experienceImpact: 75,
      skillsKeywords: 60,
      completeness: 90,
    },
    issues: [{ severity: "warning", message: "Thin about", category: "about" }],
    suggestions: { items: ["Add metrics"] },
    benchmark,
    createdAt: "2026-07-25T09:30:00.000Z",
    ...overrides,
  }
}

function okResponse(data: ProfileRatingData, contextUsed?: unknown) {
  return {
    ok: true,
    json: async () => ({ data, ...(contextUsed ? { contextUsed } : {}) }),
  }
}

describe("LinkedinView — source panel", () => {
  it("rejects a non-PDF client-side without fetching", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    render(<LinkedinView initialLinkedin={null} />)

    const input = screen.getByLabelText(/Choose PDF/) as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(["x"], "shot.png", { type: "image/png" })] },
    })

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Only PDF")
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a PDF over 5 MB client-side", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    render(<LinkedinView initialLinkedin={null} />)

    fireEvent.change(screen.getByLabelText(/Choose PDF/), {
      target: { files: [pdf("big.pdf", 6 * 1024 * 1024)] },
    })

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("over 5 MB")
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("clears the selected file", async () => {
    render(<LinkedinView initialLinkedin={null} />)

    fireEvent.change(screen.getByLabelText(/Choose PDF/), {
      target: { files: [pdf()] },
    })
    await waitFor(() => expect(screen.getByText("profile.pdf")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Clear selected PDF" }))
    await waitFor(() => expect(screen.queryByText("profile.pdf")).toBeNull())
  })

  it("uploads and renders the rating", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(rating()))
    vi.stubGlobal("fetch", fetchMock)
    render(<LinkedinView initialLinkedin={null} />)

    fireEvent.change(screen.getByLabelText(/Choose PDF/), {
      target: { files: [pdf()] },
    })
    await waitFor(() => expect(screen.getByText("profile.pdf")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /Rate profile/ }))

    await waitFor(() => expect(screen.getByText("77/100")).toBeTruthy())
    expect(fetchMock.mock.calls[0][0]).toBe("/api/linkedin/rating")
    expect(toastSuccess).toHaveBeenCalledWith("LinkedIn profile rated")
  })
})

describe("LinkedinView — linked context", () => {
  const resumeOptions = [
    { id: "res-1", title: "Frontend resume", atsScore: 84 },
    { id: "res-2", title: "Untitled", atsScore: null },
  ]

  it("renders the resume picker", () => {
    render(<LinkedinView initialLinkedin={null} resumeOptions={resumeOptions} />)

    const select = screen.getByLabelText(/Resume \(optional\)/) as HTMLSelectElement
    expect(select.value).toBe("")
    expect(screen.getByText("Frontend resume — ATS 84")).toBeTruthy()
    expect(screen.getByText("Untitled")).toBeTruthy()
  })

  it("sends resumeId in the FormData when filled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse(rating(), { resume: true }))
    vi.stubGlobal("fetch", fetchMock)
    render(<LinkedinView initialLinkedin={null} resumeOptions={resumeOptions} />)

    fireEvent.change(screen.getByLabelText(/Choose PDF/), {
      target: { files: [pdf()] },
    })
    fireEvent.change(screen.getByLabelText(/Resume \(optional\)/), {
      target: { value: "res-1" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Rate profile/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.get("resumeId")).toBe("res-1")

    // Context chip reflects what the server reported it used.
    await waitFor(() => expect(screen.getByText("Resume linked")).toBeTruthy())
  })

  it("omits the optional field when left empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(rating()))
    vi.stubGlobal("fetch", fetchMock)
    render(<LinkedinView initialLinkedin={null} resumeOptions={resumeOptions} />)

    fireEvent.change(screen.getByLabelText(/Choose PDF/), {
      target: { files: [pdf()] },
    })
    fireEvent.click(screen.getByRole("button", { name: /Rate profile/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.get("resumeId")).toBeNull()
    expect(screen.queryByText("Resume linked")).toBeNull()
  })
})

describe("LinkedinView — benchmark rendering", () => {
  it("shows the sidebar percentile and per-category comparison", () => {
    render(<LinkedinView initialLinkedin={rating()} />)

    // percentile 42 → top 58%
    expect(screen.getByText("Top 58%")).toBeTruthy()
    expect(screen.getByText("42%")).toBeTruthy()
    expect(screen.getByText("You vs competitors")).toBeTruthy()
    expect(
      screen.getByLabelText("Headline: your score 70 vs typical competitor 80")
    ).toBeTruthy()
    expect(
      screen.getByLabelText(
        "Experience impact: your score 75 vs typical competitor 85"
      )
    ).toBeTruthy()
    expect(screen.getByText("Marker = typical competing profile")).toBeTruthy()
  })

  it("renders the competitor narrative with advantages and gaps", () => {
    render(<LinkedinView initialLinkedin={rating()} />)

    expect(screen.getByText("Against the competition")).toBeTruthy()
    expect(
      screen.getByText(
        "Stronger tooling depth than most, but experience reads as duties."
      )
    ).toBeTruthy()
    expect(screen.getByText("Rare depth in design systems")).toBeTruthy()
    expect(screen.getByText("No quantified impact in recent roles")).toBeTruthy()
  })

  it("falls back to plain category bars when benchmark is null", () => {
    render(<LinkedinView initialLinkedin={rating({ benchmark: null })} />)

    expect(screen.queryByText("Against the competition")).toBeNull()
    expect(screen.queryByText(/^Top /)).toBeNull()
    expect(screen.getByText("Category scores")).toBeTruthy()
    expect(screen.getByLabelText("Headline: your score 70 out of 100")).toBeTruthy()
    expect(
      screen.getByText("Re-rate this profile to add the competitor benchmark.")
    ).toBeTruthy()
  })

  it("invites a first rating when there is none", () => {
    render(<LinkedinView initialLinkedin={null} />)

    expect(screen.getByText("No rating yet — run your first scan")).toBeTruthy()
    // Pre-scan there is nothing to put in the stats rail, so it is not rendered
    // at all — the empty state carries the invitation on its own.
    expect(
      screen.queryByText(
        "Rate your profile to see how you stack up against the competition."
      )
    ).toBeNull()
  })

  it("renders issues and suggestions as their own sections", () => {
    render(<LinkedinView initialLinkedin={rating()} />)

    expect(screen.getByText("What to fix")).toBeTruthy()
    expect(screen.getByText("Thin about")).toBeTruthy()
    expect(screen.getByText("Suggested next moves")).toBeTruthy()
    expect(screen.getByText("Add metrics")).toBeTruthy()
  })
})

describe("LinkedinView — error codes", () => {
  function submitWith(code: string, error = "boom") {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error, code }) })
    )
    render(<LinkedinView initialLinkedin={null} />)
    fireEvent.change(screen.getByLabelText(/Choose PDF/), {
      target: { files: [pdf()] },
    })
    fireEvent.click(screen.getByRole("button", { name: /Rate profile/ }))
  }

  it("maps EMPTY_PDF from the route", async () => {
    submitWith("EMPTY_PDF")
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("no readable text")
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it("maps INVALID_RESUME", async () => {
    submitWith("INVALID_RESUME")
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "That resume couldn't be found"
      )
    )
  })

  it("toasts RATE_LIMITED", async () => {
    submitWith("RATE_LIMITED", "slow down")
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
  })
})
