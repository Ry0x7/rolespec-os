// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  GREENHOUSE_RESULT_LIMIT,
  greenhouseAdapter,
  parseGreenhouseResponse,
} from "../greenhouse.adapter"
import { clearFetchMemo } from "../fetch-memo"

// Pinned so the test does not move whenever the default watchlist is edited.
const CONTEXT = { atsWatchlist: { greenhouse: ["gitlab", "stripe"], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] } }

/** Shaped from a real gitlab board response captured on 2026-09-04. */
const GREENHOUSE_JOB = {
  absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/8503792002",
  internal_job_id: "6396658002",
  location: { name: "Remote, Italy" },
  id: 8503792002,
  updated_at: "2026-08-31T17:56:36-04:00",
  requisition_id: "6263",
  title: "Frontend Engineer - Italy",
  company_name: "GitLab",
  first_published: "2026-04-17T05:58:03-04:00",
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

describe("parseGreenhouseResponse", () => {
  it("maps the fields the live API returns", () => {
    const postings = parseGreenhouseResponse({ jobs: [GREENHOUSE_JOB] }, "gitlab", QUERY)

    expect(postings).toEqual([
      {
        provider: "greenhouse",
        externalId: "8503792002",
        title: "Frontend Engineer - Italy",
        companyName: "GitLab",
        url: GREENHOUSE_JOB.absolute_url,
        location: "Remote, Italy",
        // No `?content=true`, so there is no description to carry.
        postedAt: "2026-08-31T17:56:36-04:00",
        raw: GREENHOUSE_JOB,
      },
    ])
  })

  it("falls back to the slug when the board does not name the company", () => {
    const postings = parseGreenhouseResponse(
      { jobs: [{ ...GREENHOUSE_JOB, company_name: undefined }] },
      "gitlab",
      QUERY
    )

    expect(postings?.[0]?.companyName).toBe("gitlab")
  })

  it("returns null when the response has no jobs array", () => {
    expect(parseGreenhouseResponse({ error: "nope" }, "gitlab", QUERY)).toBeNull()
    expect(parseGreenhouseResponse(null, "gitlab", QUERY)).toBeNull()
    expect(parseGreenhouseResponse("<html>", "gitlab", QUERY)).toBeNull()
  })

  it("skips entries missing an id, title or url", () => {
    const postings = parseGreenhouseResponse(
      {
        jobs: [
          GREENHOUSE_JOB,
          { ...GREENHOUSE_JOB, id: undefined },
          { ...GREENHOUSE_JOB, absolute_url: undefined },
          null,
        ],
      },
      "gitlab",
      QUERY
    )

    expect(postings).toHaveLength(1)
  })
})

describe("greenhouseAdapter.search", () => {
  it("requests every watched board with a descriptive User-Agent", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ jobs: [GREENHOUSE_JOB] }))

    const controller = new AbortController()
    const postings = await greenhouseAdapter.search(QUERY, controller.signal, CONTEXT)

    expect(postings).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs",
      "https://boards-api.greenhouse.io/v1/boards/stripe/jobs",
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
      .mockImplementation(async () => jsonResponse({ jobs: [GREENHOUSE_JOB] }))

    const signal = new AbortController().signal
    await greenhouseAdapter.search(QUERY, signal, CONTEXT)
    const second = await greenhouseAdapter.search({ role: "Frontend Developer" }, signal, CONTEXT)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(second).toHaveLength(2)
  })

  it("keeps postings matching the title and drops the rest", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("/gitlab/")
        ? jsonResponse({
            jobs: [
              GREENHOUSE_JOB,
              { ...GREENHOUSE_JOB, id: 2, title: "Account Executive - Italy" },
              { ...GREENHOUSE_JOB, id: 3, title: "React Developer" },
            ],
          })
        : jsonResponse({ jobs: [] })
    )

    const postings = await greenhouseAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings.map((posting) => posting.externalId)).toEqual(["8503792002", "3"])
  })

  it("caps the total across boards", async () => {
    // 15 matches per board, so the cap can only be hit by both boards together.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      jsonResponse({
        jobs: Array.from({ length: 15 }, (_unused, index) => ({
          ...GREENHOUSE_JOB,
          id: `${String(input).includes("/gitlab/") ? "gl" : "st"}-${index}`,
        })),
      })
    )

    const postings = await greenhouseAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(GREENHOUSE_RESULT_LIMIT)
  })

  it("keeps one board's results when the other slug fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/gitlab/")) throw new Error("ENOTFOUND")
      return jsonResponse({ jobs: [GREENHOUSE_JOB] })
    })

    const postings = await greenhouseAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(1)
  })

  it("keeps one board's results when the other returns a non-OK status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/gitlab/")) return jsonResponse({}, 404)
      return jsonResponse({ jobs: [GREENHOUSE_JOB] })
    })

    const postings = await greenhouseAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(1)
  })

  it("returns an empty list on an unrecognised shape", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ results: [] }))

    await expect(greenhouseAdapter.search(QUERY, new AbortController().signal, CONTEXT)).resolves.toEqual([])
  })

  it("fetches nothing when the user watches no Greenhouse boards", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    await expect(
      greenhouseAdapter.search(QUERY, new AbortController().signal, {
        atsWatchlist: { greenhouse: [], lever: ["ro"], ashby: [], bamboohr: [], freshteam: [], workday: [] },
      })
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not call the source for an empty query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    await expect(
      greenhouseAdapter.search({ role: "   " }, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
