import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { OpportunityLeaderboard } from "../opportunity-leaderboard"
import type { RankingResult } from "../../types"

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const result: RankingResult = {
  snapshot: { rankedAt: "2026-11-12T00:00:00Z", corpusSize: 1, unscoredCount: 1, averageDocumentLength: 0, queryTerms: [], topK: 20, minScore: 40, lexicalWeight: 0.4, fitWeight: 0.6 },
  entries: [{ postingId: "posting-1", rank: 1, score: 42, lexicalScore: null, lexicalRank: null, fitScore: 70, coverage: 0.5, factors: [{ id: "SKILLS", label: "Skills", state: "MATCH", weight: 25, reason: "Confirmed React experience matches the posting.", evidence: ["React"] }, { id: "AUTHORIZATION", label: "Work authorization", state: "UNKNOWN", weight: 15, reason: "Not specified", evidence: [] }], explanation: ["Uses confirmed facts."] }],
  excluded: [],
}
const jobs = [{ id: "application-1", jobId: "posting-1", status: "INTERESTED", job: { title: "Systems engineer", companyName: "Example", location: null, workType: null } }]
const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }))

describe("persisted opportunity leaderboard", () => {
  it("does not run ranking on mount and links posting results to application ids", async () => {
    const fetch = vi.fn(() => json({ snapshot: { id: "snapshot-1", result, poolSize: 1, reranked: false } }))
    vi.stubGlobal("fetch", fetch)
    render(<OpportunityLeaderboard jobs={jobs} />)
    const job = await screen.findByRole("link", { name: "Systems engineer" })
    expect(job.getAttribute("href")).toBe("/jobs/application-1#decide")
    expect(fetch.mock.calls).toHaveLength(1)
    expect(screen.getByText("Some evidence · 50%")).toBeTruthy()
    expect(screen.getByText("No job description was saved.")).toBeTruthy()
    expect(screen.getByText("What helped")).toBeTruthy()
    expect(screen.getByText("Match")).toBeTruthy()
    expect(screen.getByText("Not specified")).toBeTruthy()
  })
  it("ranks without AI by default and discloses an unsaved result", async () => {
    const fetch = vi.fn((url: string, init?: RequestInit) => init?.method === "POST" ? json({ ...result, reranked: false, warnings: [], poolSize: 1, snapshotId: null }) : json({ snapshot: null }))
    vi.stubGlobal("fetch", fetch)
    render(<OpportunityLeaderboard jobs={jobs} />)
    await screen.findByText("Choose what deserves your attention")
    fireEvent.click(screen.getByRole("button", { name: "Rank saved jobs" }))
    await screen.findByText(/snapshot could not be saved/)
    const post = fetch.mock.calls.find(call => call[1]?.method === "POST")
    expect(JSON.parse(post![1]!.body as string)).toEqual({ topK: 20, minScore: 40, rerank: false })
  })
  it("keeps the previous snapshot after a failed refresh", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => init?.method === "POST" ? json({ error: "Too many ranking requests" }, 429) : json({ snapshot: { id: "snapshot-1", result, poolSize: 1, reranked: false } })))
    render(<OpportunityLeaderboard jobs={jobs} />)
    await screen.findByRole("link", { name: "Systems engineer" })
    fireEvent.click(screen.getByRole("button", { name: "Refresh ranking" }))
    await screen.findByRole("alert")
    expect(screen.getByRole("link", { name: "Systems engineer" })).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("Too many ranking requests")
  })
  it("shows only the first ranked roles and expands on request", async () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      ...result.entries[0],
      postingId: `posting-${i + 1}`,
      rank: i + 1,
    }))
    const many = { ...result, entries }
    const manyJobs = entries.map((entry, i) => ({
      id: `application-${i + 1}`,
      jobId: entry.postingId,
      status: "INTERESTED",
      job: {
        title: `Role ${i + 1}`,
        companyName: "Example",
        location: null,
        workType: null,
      },
    }))
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json({ snapshot: { id: "snapshot-1", result: many, poolSize: 8, reranked: false } }))
    )

    render(<OpportunityLeaderboard jobs={manyJobs} />)

    await screen.findByText("Role 1")
    // jsdom has no matchMedia, so the component uses its phone branch (two
    // rows). The desktop branch shows five.
    expect(screen.queryByText("Role 3")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Show all 8 ranked roles" }))
    expect(screen.getByText("Role 8")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Show top 2" }))
    expect(screen.queryByText("Role 3")).toBeNull()
  })

  it("disables ranking when offline and offers honest empty state", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ snapshot: null })))
    render(<OpportunityLeaderboard jobs={[]} />)
    await screen.findByText("Your shortlist starts with a saved job")
    fireEvent(window, new Event("offline"))
    await waitFor(() => expect((screen.getByRole("button", { name: "Rank saved jobs" }) as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByText(/You’re offline/)).toBeTruthy()
  })
})
