import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { LinkedinView } from "../linkedin-view"
import type { LinkedinSuggestionData } from "../../services/linkedin.service"
import { installMotionTestEnv } from "./motion-test-env"

const update = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()
const writeText = vi.fn()

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
beforeEach(() => {
  vi.clearAllMocks()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  })
})

const suggestions: LinkedinSuggestionData = {
  id: "s1",
  createdAt: "2026-07-29T10:00:00.000Z",
  suggestions: {
    headline: {
      current: "Software Engineer at Acme",
      suggested: "Backend Engineer | Node.js & PostgreSQL",
      rationale: "Adds specialisation",
    },
    about: {
      suggested: "I build payment systems.",
      rationale: "Leads with the specialism",
    },
    experience: [
      {
        position: "Software Engineer — Acme",
        suggestedBullets: ["Rebuilt the checkout service", "Cut failed payments"],
        rationale: "Outcomes over duties",
      },
    ],
    skillsToAdd: ["PostgreSQL"],
    quickWins: ["Add your certification to the profile"],
  },
}

function pdf(name = "profile.pdf", size = 1000) {
  const file = new File(["x"], name, { type: "application/pdf" })
  Object.defineProperty(file, "size", { value: size })
  return file
}

function renderView(initialLinkedinSuggestions: LinkedinSuggestionData | null = null) {
  return render(
    <LinkedinView
      initialLinkedin={null}
      initialLinkedinSuggestions={initialLinkedinSuggestions}
    />
  )
}

describe("LinkedinAssistResults", () => {
  it("renders persisted suggestions on load", () => {
    renderView(suggestions)

    expect(screen.getByText("LinkedIn Assist")).toBeTruthy()
    expect(screen.getByText("Backend Engineer | Node.js & PostgreSQL")).toBeTruthy()
    expect(screen.getByText("Software Engineer at Acme")).toBeTruthy()
    expect(screen.getByText("I build payment systems.")).toBeTruthy()
    expect(screen.getByText("Rebuilt the checkout service")).toBeTruthy()
    expect(screen.getByText("PostgreSQL")).toBeTruthy()
    expect(screen.getByText("Add your certification to the profile")).toBeTruthy()
  })

  it("renders nothing when there are no suggestions", () => {
    renderView(null)
    expect(screen.queryByText("LinkedIn Assist")).toBeNull()
  })

  it("copies the joined bullets for a position", async () => {
    renderView(suggestions)

    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy suggested bullets for Software Engineer — Acme",
      })
    )

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "Rebuilt the checkout service\nCut failed payments"
      )
    )
    expect(toastSuccess).toHaveBeenCalledWith("Copied")
  })

  it("copies the suggested headline", async () => {
    renderView(suggestions)

    fireEvent.click(screen.getByRole("button", { name: "Copy suggested headline" }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Backend Engineer | Node.js & PostgreSQL")
    )
  })

  it("reuses the picked file for the assist run and renders the result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: suggestions }) })
    vi.stubGlobal("fetch", fetchMock)
    renderView(null)

    fireEvent.change(screen.getByLabelText(/Choose PDF/), { target: { files: [pdf()] } })
    await waitFor(() => expect(screen.getByText("profile.pdf")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /Generate suggestions/ }))

    await waitFor(() =>
      expect(screen.getByText("Backend Engineer | Node.js & PostgreSQL")).toBeTruthy()
    )
    expect(fetchMock.mock.calls[0][0]).toBe("/api/linkedin/assist")
    expect(toastSuccess).toHaveBeenCalledWith("Suggestions ready")
  })

  it("surfaces ASSIST_FAILED inline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "nope", code: "ASSIST_FAILED" }),
      })
    )
    renderView(null)

    fireEvent.change(screen.getByLabelText(/Choose PDF/), { target: { files: [pdf()] } })
    fireEvent.click(screen.getByRole("button", { name: /Generate suggestions/ }))

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Generating suggestions failed"
      )
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it("toasts RATE_LIMITED from the assist route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "broke", code: "RATE_LIMITED" }),
      })
    )
    renderView(null)

    fireEvent.change(screen.getByLabelText(/Choose PDF/), { target: { files: [pdf()] } })
    fireEvent.click(screen.getByRole("button", { name: /Generate suggestions/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
  })
})
