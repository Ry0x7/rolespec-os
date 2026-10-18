import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PortfolioView } from "../portfolio-view"

const ratePortfolio = vi.fn()
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

vi.mock("../../actions/rate-portfolio.action", () => ({
  ratePortfolio: (...args: unknown[]) => ratePortfolio(...args),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

function renderView() {
  return render(
    <PortfolioView initialPortfolio={null} />
  )
}

describe("PortfolioRatingCard", () => {
  it("does not call the action when the URL is empty", async () => {
    renderView()

    fireEvent.click(screen.getByRole("button", { name: /Rate portfolio/ }))

    await waitFor(() =>
      expect(
        screen.getByText("Enter your portfolio URL to run a rating.")
      ).toBeTruthy()
    )
    expect(ratePortfolio).not.toHaveBeenCalled()
  })

  // The input is type="url", so malformed text is blocked by native constraint
  // validation before submit; the action's INVALID_URL code still has to map.
  it("shows the mapped inline message for INVALID_URL without toasting", async () => {
    ratePortfolio.mockResolvedValue({
      error: "That does not look like a valid website URL.",
      code: "INVALID_URL",
    })
    renderView()

    fireEvent.change(screen.getByLabelText("Portfolio URL"), {
      target: { value: "https://example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Rate portfolio/ }))

    await waitFor(() =>
      expect(screen.getByText("Enter a valid public website URL.")).toBeTruthy()
    )
    expect(ratePortfolio).toHaveBeenCalledWith("https://example.com")
    expect(toastError).not.toHaveBeenCalled()
  })

  it("toasts on RATE_LIMITED", async () => {
    ratePortfolio.mockResolvedValue({
      error: "Too many portfolio ratings",
      code: "RATE_LIMITED",
    })
    renderView()

    fireEvent.change(screen.getByLabelText("Portfolio URL"), {
      target: { value: "https://example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Rate portfolio/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError).toHaveBeenCalledWith(
      "Too many portfolio ratings. Wait a few minutes and try again."
    )
  })

  it("renders the returned rating on success", async () => {
    ratePortfolio.mockResolvedValue({
      success: true,
      data: {
        id: "r1",
        kind: "PORTFOLIO",
        sourceUrl: "https://example.com",
        overallScore: 91,
        scores: {
          contentClarity: 90,
          projectShowcase: 92,
          professionalPositioning: 88,
          contactability: 95,
          keywordsSeo: 90,
        },
        issues: [],
        suggestions: { items: ["Keep it up"] },
        createdAt: "2026-07-25T09:30:00.000Z",
      },
    })
    renderView()

    fireEvent.change(screen.getByLabelText("Portfolio URL"), {
      target: { value: "https://example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Rate portfolio/ }))

    await waitFor(() => expect(screen.getByText("Score: 91")).toBeTruthy())
    expect(toastSuccess).toHaveBeenCalledWith("Portfolio rated")
  })
})
