// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  REMOTIVE_RESULT_LIMIT,
  parseRemotiveResponse,
  remotiveAdapter,
} from "../remotive.adapter"

/** Remotive has a cross-company search, so it ignores the watchlist. */
const CONTEXT = { atsWatchlist: { greenhouse: [], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] } }

/** Shaped from a real response captured on 2026-09-01. */
const REMOTIVE_JOB = {
  id: 2091101,
  url: "https://remotive.com/remote-jobs/software-development/senior-react-2091101",
  title: "Senior React Full-stack Developer",
  company_name: "Lemon.io",
  category: "Software Development",
  tags: ["react", "node.js"],
  job_type: "full_time",
  publication_date: "2026-08-27T14:36:09",
  candidate_required_location: "LATAM, Europe, USA",
  salary: "",
  description: "<p>Are you a talented Senior Developer?</p>",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("parseRemotiveResponse", () => {
  it("maps the fields the live API returns", () => {
    const postings = parseRemotiveResponse({ jobs: [REMOTIVE_JOB] })

    expect(postings).toEqual([
      {
        provider: "remotive",
        externalId: "2091101",
        title: "Senior React Full-stack Developer",
        companyName: "Lemon.io",
        url: REMOTIVE_JOB.url,
        location: "LATAM, Europe, USA",
        workTypeHint: "remote",
        // An empty `salary` string is treated as absent, not as "".
        salaryText: undefined,
        description: "<p>Are you a talented Senior Developer?</p>",
        postedAt: "2026-08-27T14:36:09",
        raw: REMOTIVE_JOB,
      },
    ])
  })

  it("returns null when the response has no jobs array", () => {
    expect(parseRemotiveResponse({ error: "nope" })).toBeNull()
    expect(parseRemotiveResponse(null)).toBeNull()
    expect(parseRemotiveResponse("<html>")).toBeNull()
  })

  it("skips entries missing an id, title, company or url", () => {
    const postings = parseRemotiveResponse({
      jobs: [
        REMOTIVE_JOB,
        { ...REMOTIVE_JOB, id: undefined },
        { ...REMOTIVE_JOB, title: "" },
        { ...REMOTIVE_JOB, company_name: null },
        { ...REMOTIVE_JOB, url: undefined },
        null,
      ],
    })

    expect(postings).toHaveLength(1)
  })
})

describe("remotiveAdapter.search", () => {
  it("issues exactly one capped request with a descriptive User-Agent", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ jobs: [REMOTIVE_JOB] }))

    const controller = new AbortController()
    const postings = await remotiveAdapter.search(
      { role: "Frontend Engineer", keywords: ["react"] },
      controller.signal
,
      CONTEXT
    )

    expect(postings).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin + url.pathname).toBe("https://remotive.com/api/remote-jobs")
    expect(url.searchParams.get("search")).toBe("Frontend Engineer react")
    expect(url.searchParams.get("limit")).toBe(String(REMOTIVE_RESULT_LIMIT))
    expect((init.headers as Record<string, string>)["user-agent"]).toContain("RoleSpec")
    expect(init.signal).toBe(controller.signal)
  })

  it("caps the result count even if the source ignores the limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        jobs: Array.from({ length: 60 }, (_unused, index) => ({
          ...REMOTIVE_JOB,
          id: index,
        })),
      })
    )

    const postings = await remotiveAdapter.search({ role: "Engineer" }, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(REMOTIVE_RESULT_LIMIT)
  })

  it("returns an empty list on a non-OK status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 503))

    await expect(
      remotiveAdapter.search({ role: "Engineer" }, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
  })

  it("returns an empty list on an unrecognised shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ results: [] }))

    await expect(
      remotiveAdapter.search({ role: "Engineer" }, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
  })

  it("swallows a network failure rather than throwing at the pipeline", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"))

    await expect(
      remotiveAdapter.search({ role: "Engineer" }, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
  })

  it("does not call the source for an empty query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    await expect(
      remotiveAdapter.search({ role: "   " }, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
