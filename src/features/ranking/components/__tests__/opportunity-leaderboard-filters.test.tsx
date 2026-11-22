import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import type { RankingResult } from "../../types"
import { OpportunityLeaderboard, type OpportunityIdentity } from "../opportunity-leaderboard"

const { replace, search } = vi.hoisted(() => ({
  replace: vi.fn(),
  search: { params: new URLSearchParams("") },
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace }),
  useSearchParams: () => search.params,
}))

beforeEach(() => {
  replace.mockClear()
  search.params = new URLSearchParams("")
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const snapshot: RankingResult["snapshot"] = {
  rankedAt: "2026-11-12T00:00:00Z",
  corpusSize: 3,
  unscoredCount: 0,
  averageDocumentLength: 0,
  queryTerms: [],
  topK: 20,
  minScore: 40,
  lexicalWeight: 0.4,
  fitWeight: 0.6,
}

function entry(postingId: string, rank: number): RankingResult["entries"][number] {
  return {
    postingId,
    rank,
    score: 70 - rank,
    lexicalScore: null,
    lexicalRank: null,
    fitScore: 74,
    coverage: 0.7,
    factors: [
      {
        id: "SKILLS",
        label: "Skills",
        state: "MATCH",
        weight: 25,
        reason: "Confirmed experience matches the posting.",
        evidence: ["React"],
      },
    ],
    explanation: ["Uses confirmed facts."],
  }
}

const result: RankingResult = {
  snapshot,
  entries: [entry("job-a", 1), entry("job-b", 2), entry("job-c", 3)],
  excluded: [],
}

const jobs: OpportunityIdentity[] = [
  {
    id: "application-a",
    jobId: "job-a",
    status: "INTERESTED",
    job: {
      title: "Role A",
      companyName: "Alpha",
      location: "Manila",
      workType: "REMOTE",
      salary: { min: "100000", max: "120000", currency: "PHP", period: "MONTHLY", termMonths: null },
    },
  },
  {
    id: "application-b",
    jobId: "job-b",
    status: "INTERESTED",
    job: { title: "Role B", companyName: "Beta", location: null, workType: null },
  },
  {
    id: "application-c",
    jobId: "job-c",
    status: "INTERESTED",
    job: {
      title: "Role C",
      companyName: "Gamma",
      location: "Cebu",
      workType: "ONSITE",
      salary: { min: "20000", max: "25000", currency: "PHP", period: "MONTHLY", termMonths: null },
    },
  },
]

const json = (data: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(data), { status }))

function renderLeaderboard(list: OpportunityIdentity[] = jobs) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      json({ snapshot: { id: "snapshot-1", result, poolSize: 3, reranked: false } })
    )
  )
  render(<OpportunityLeaderboard jobs={list} />)
}

function findDetails(text: string): Element | undefined {
  return Array.from(document.querySelectorAll("details")).find(element =>
    element.textContent?.includes(text)
  )
}

function liveCounts(): string {
  return document.querySelector('[aria-live="polite"]')?.textContent ?? ""
}

describe("leaderboard opportunity filters", () => {
  it("moves a payless posting to Needs more info instead of guessing its pay", async () => {
    renderLeaderboard()
    await screen.findByText("Role A")
    fireEvent.click(screen.getByRole("button", { name: "Show all 3 ranked roles" }))
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }))
    fireEvent.click(screen.getByLabelText("Only postings that state their pay"))

    const needsInfo = Array.from(document.querySelectorAll("details")).find(element =>
      element.textContent?.includes("Needs more info")
    )
    expect(needsInfo?.textContent).toContain("Role B")
    expect(liveCounts()).toContain("2 eligible")
    expect(liveCounts()).toContain("1 need more info")
  })

  it("applies the High pay preset, narrows the list and keeps the chip pressed", async () => {
    renderLeaderboard()
    await screen.findByText("Role A")

    fireEvent.click(screen.getByRole("button", { name: "High pay" }))

    expect(screen.getByRole("button", { name: "High pay" }).getAttribute("aria-pressed")).toBe(
      "true"
    )
    expect(liveCounts()).toContain("2 eligible")
    expect(liveCounts()).toContain("1 need more info")
    // Role B has no stated pay, so it is not an eligible row any more.
    expect(screen.queryByText("Role B")).toBeNull()
    expect(findDetails("Needs more info")?.textContent).toContain("Role B")
  })

  it("renders safely when no saved posting records pay", async () => {
    const bareJobs = jobs.map(job => ({ ...job, job: { ...job.job, salary: null } }))
    renderLeaderboard(bareJobs)
    await screen.findByText("Role A")

    fireEvent.click(screen.getByRole("button", { name: "High pay" }))

    expect(liveCounts()).toContain("0 eligible")
    expect(liveCounts()).toContain("3 need more info")
    const needsInfo = findDetails("Needs more info")
    expect(needsInfo?.textContent).toContain("Role C")
  })

  it("opens from a URL that already carries filters", async () => {
    search.params = new URLSearchParams("paymin=500000&paycur=PHP")
    renderLeaderboard()
    await screen.findByText("Role A")

    expect(liveCounts()).toContain("1 eligible")
    expect(liveCounts()).toContain("1 need more info")
    expect(liveCounts()).toContain("1 excluded")
    expect(findDetails("Excluded by your filters")?.textContent).toContain("Role C")
  })

  it("excludes a below-floor same-currency posting with its reason", async () => {
    renderLeaderboard()
    await screen.findByText("Role A")
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }))
    fireEvent.change(screen.getByLabelText("Minimum pay (annual)"), {
      target: { value: "500000" },
    })

    const excluded = Array.from(document.querySelectorAll("details")).find(element =>
      element.textContent?.includes("Excluded by your filters")
    )
    expect(excluded?.textContent).toContain("Role C")
    expect(excluded?.textContent).toContain("Pay is below PHP 500000.")

    expect(liveCounts()).toContain("1 eligible")
    expect(liveCounts()).toContain("1 need more info")
    expect(liveCounts()).toContain("1 excluded")
    expect(screen.getByText("Role A")).toBeTruthy()
  })

  it("resets every filter and restores all entries", async () => {
    renderLeaderboard()
    await screen.findByText("Role A")
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }))
    fireEvent.change(screen.getByLabelText("Minimum pay (annual)"), {
      target: { value: "500000" },
    })

    await waitFor(() => expect(resetButton().disabled).toBe(false))
    // The debounce writes the filter into the URL before reset replaces it.
    await waitFor(() => expect(replace).toHaveBeenCalled(), { timeout: 2000 })
    expect(String(replace.mock.calls.at(-1)?.[0])).toContain("paymin=500000")

    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }))

    await waitFor(() => expect(liveCounts()).toContain("3 eligible"))
    expect(liveCounts()).toContain("0 excluded")
    expect(screen.getByText("Role A")).toBeTruthy()
    await waitFor(() => expect(resetButton().disabled).toBe(true))
  })
})

function resetButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Reset filters" }) as HTMLButtonElement
}
