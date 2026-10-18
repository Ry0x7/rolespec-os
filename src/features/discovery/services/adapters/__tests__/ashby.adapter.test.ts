// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { ASHBY_RESULT_LIMIT, ashbyAdapter, parseAshbyResponse } from "../ashby.adapter"
import { clearFetchMemo } from "../fetch-memo"

// Pinned so the test does not move whenever the default watchlist is edited.
const CONTEXT = { atsWatchlist: { greenhouse: [], lever: [], ashby: ["linear", "ramp"], bamboohr: [], freshteam: [], workday: [] } }

/** Shaped from a real ramp board response captured on 2026-09-09. */
const ASHBY_JOB = {
  id: "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
  title: "Frontend Engineer, Cloud",
  department: "Engineering",
  team: "Backend",
  employmentType: "FullTime",
  location: "New York, NY (HQ)",
  publishedAt: "2026-04-07T17:12:35.753+00:00",
  isListed: true,
  isRemote: true,
  workplaceType: "Hybrid",
  jobUrl: "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245",
  applyUrl: "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application",
  descriptionHtml: "<p>Build things.</p>",
  descriptionPlain: "Build things.",
  compensation: {
    compensationTierSummary: "$211.4K – $290.6K • Offers Equity",
    scrapeableCompensationSalarySummary: "$211.4K - $290.6K",
  },
}

const QUERY = { role: "Frontend Engineer", keywords: ["react"] }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  clearFetchMemo()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("parseAshbyResponse", () => {
  it("maps the fields the live API returns", () => {
    const postings = parseAshbyResponse({ jobs: [ASHBY_JOB], apiVersion: 1 }, "ramp", QUERY)

    expect(postings).toEqual([
      {
        provider: "ashby",
        externalId: ASHBY_JOB.id,
        title: "Frontend Engineer, Cloud",
        // The payload never names the company, so the slug stands in.
        companyName: "ramp",
        url: ASHBY_JOB.jobUrl,
        location: "New York, NY (HQ)",
        workTypeHint: "Hybrid",
        salaryText: "$211.4K – $290.6K • Offers Equity",
        description: "Build things.",
        postedAt: "2026-04-07T17:12:35.753+00:00",
        raw: ASHBY_JOB,
      },
    ])
  })

  it("falls back to isRemote when the board states no workplace type", () => {
    const postings = parseAshbyResponse(
      { jobs: [{ ...ASHBY_JOB, workplaceType: undefined }] },
      "ramp",
      QUERY
    )

    expect(postings?.[0]?.workTypeHint).toBe("remote")
  })

  it("leaves the work type unstated when the posting is not remote and says nothing", () => {
    const postings = parseAshbyResponse(
      { jobs: [{ ...ASHBY_JOB, workplaceType: undefined, isRemote: false }] },
      "ramp",
      QUERY
    )

    expect(postings?.[0]?.workTypeHint).toBeUndefined()
  })

  it("drops a posting the board has unlisted", () => {
    const postings = parseAshbyResponse(
      { jobs: [{ ...ASHBY_JOB, isListed: false }] },
      "ramp",
      QUERY
    )

    expect(postings).toEqual([])
  })

  it("returns null when the response has no jobs array", () => {
    expect(parseAshbyResponse({ error: "nope" }, "ramp", QUERY)).toBeNull()
    expect(parseAshbyResponse(null, "ramp", QUERY)).toBeNull()
    expect(parseAshbyResponse("<html>", "ramp", QUERY)).toBeNull()
  })

  it("skips entries missing an id, title or url", () => {
    const postings = parseAshbyResponse(
      {
        jobs: [
          ASHBY_JOB,
          { ...ASHBY_JOB, id: undefined },
          { ...ASHBY_JOB, jobUrl: undefined },
          { ...ASHBY_JOB, title: undefined },
          null,
        ],
      },
      "ramp",
      QUERY
    )

    expect(postings).toHaveLength(1)
  })
})

describe("ashbyAdapter.search", () => {
  it("requests every watched board with a descriptive User-Agent", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ jobs: [ASHBY_JOB] }))

    const controller = new AbortController()
    const postings = await ashbyAdapter.search(QUERY, controller.signal, CONTEXT)

    expect(postings).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true",
      "https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true",
    ])

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)["user-agent"]).toContain("RoleSpec")
    // The memoized request runs on its own signal, not the caller's: one query's
    // deadline must not cancel a request another query is still waiting on. That
    // the caller's abort still reaches it is covered in `fetch-memo.test.ts`.
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal).not.toBe(controller.signal)
  })

  it("fetches each board once across two searches in the same run", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ jobs: [ASHBY_JOB] }))

    const signal = new AbortController().signal
    await ashbyAdapter.search(QUERY, signal, CONTEXT)
    const second = await ashbyAdapter.search({ role: "Frontend Developer" }, signal, CONTEXT)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(second).toHaveLength(2)
  })

  it("keeps postings matching the title and drops the rest", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("/linear?")
        ? jsonResponse({
            jobs: [
              ASHBY_JOB,
              { ...ASHBY_JOB, id: "2", title: "Account Executive" },
              { ...ASHBY_JOB, id: "3", title: "Staff Engineer" },
            ],
          })
        : jsonResponse({ jobs: [] })
    )

    const postings = await ashbyAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings.map((posting) => posting.externalId)).toEqual([ASHBY_JOB.id, "3"])
  })

  it("caps the total across boards", async () => {
    // 15 matches per board, so the cap can only be hit by both boards together.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      jsonResponse({
        jobs: Array.from({ length: 15 }, (_unused, index) => ({
          ...ASHBY_JOB,
          id: `${String(input).includes("/linear?") ? "li" : "ra"}-${index}`,
        })),
      })
    )

    const postings = await ashbyAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(ASHBY_RESULT_LIMIT)
  })

  it("keeps one board's results when the other slug fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/linear?")) throw new Error("ENOTFOUND")
      return jsonResponse({ jobs: [ASHBY_JOB] })
    })

    const postings = await ashbyAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(1)
  })

  it("keeps one board's results when the other returns a non-OK status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      // The POST form of this URL answers 401; a wrong slug answers 404.
      if (String(input).includes("/linear?")) return jsonResponse({}, 404)
      return jsonResponse({ jobs: [ASHBY_JOB] })
    })

    const postings = await ashbyAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(1)
  })

  it("returns an empty list on an unrecognised shape", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ results: [] }))

    await expect(
      ashbyAdapter.search(QUERY, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
  })

  it("fetches nothing when the user watches no Ashby boards", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    await expect(
      ashbyAdapter.search(QUERY, new AbortController().signal, {
        atsWatchlist: { greenhouse: ["gitlab"], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] },
      })
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not call the source for an empty query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    await expect(
      ashbyAdapter.search({ role: "   " }, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
