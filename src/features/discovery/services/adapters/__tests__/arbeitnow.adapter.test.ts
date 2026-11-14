// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  ARBEITNOW_RESULT_LIMIT,
  arbeitnowAdapter,
  parseArbeitnowResponse,
} from "../arbeitnow.adapter"
import { clearFetchMemo } from "../fetch-memo"

/** Arbeitnow has a cross-company search, so it ignores the watchlist. */
const CONTEXT = { atsWatchlist: { greenhouse: [], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] } }

/** Shaped from a real response captured on 2026-09-04. */
const ARBEITNOW_JOB = {
  slug: "frontend-engineer-berlin-365180",
  company_name: "Hws",
  title: "Frontend Engineer (m/w/d)",
  description: "<p>Wir suchen</p>",
  remote: true,
  url: "https://www.arbeitnow.com/jobs/companies/hws/frontend-engineer-berlin-365180",
  tags: ["React", "TypeScript"],
  job_types: ["Full time"],
  location: "Berlin",
  created_at: 1788530988,
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

describe("parseArbeitnowResponse", () => {
  it("maps the fields the live API returns", () => {
    const postings = parseArbeitnowResponse({ data: [ARBEITNOW_JOB] }, QUERY)

    expect(postings).toEqual([
      {
        provider: "arbeitnow",
        externalId: "frontend-engineer-berlin-365180",
        title: "Frontend Engineer (m/w/d)",
        companyName: "Hws",
        url: ARBEITNOW_JOB.url,
        location: "Berlin",
        workTypeHint: "remote",
        description: "<p>Wir suchen</p>",
        // `created_at` is unix seconds, not a date string.
        postedAt: new Date(1788530988 * 1000).toISOString(),
        raw: ARBEITNOW_JOB,
      },
    ])
  })

  it("leaves the hint unset unless `remote` is explicitly true", () => {
    // A false flag is not evidence of an onsite role — live postings with
    // `remote: false` still say "oder remote" in their location text.
    expect(
      parseArbeitnowResponse({ data: [{ ...ARBEITNOW_JOB, remote: false }] }, QUERY)?.[0]
        ?.workTypeHint
    ).toBeUndefined()
    expect(
      parseArbeitnowResponse({ data: [{ ...ARBEITNOW_JOB, remote: undefined }] }, QUERY)?.[0]
        ?.workTypeHint
    ).toBeUndefined()
  })

  it("returns null when the response has no data array", () => {
    expect(parseArbeitnowResponse({ error: "nope" }, QUERY)).toBeNull()
    expect(parseArbeitnowResponse(null, QUERY)).toBeNull()
    expect(parseArbeitnowResponse("<html>", QUERY)).toBeNull()
  })

  it("skips entries missing a slug, title, company or url", () => {
    const postings = parseArbeitnowResponse(
      {
        data: [
          ARBEITNOW_JOB,
          { ...ARBEITNOW_JOB, slug: undefined },
          { ...ARBEITNOW_JOB, title: "Frontend Engineer", company_name: null },
          { ...ARBEITNOW_JOB, url: undefined },
          null,
        ],
      },
      QUERY
    )

    expect(postings).toHaveLength(1)
  })
})

describe("arbeitnowAdapter.search", () => {
  it("issues exactly one request with a descriptive User-Agent", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: [ARBEITNOW_JOB] }))

    const controller = new AbortController()
    const postings = await arbeitnowAdapter.search(QUERY, controller.signal, CONTEXT)

    expect(postings).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://www.arbeitnow.com/api/job-board-api")
    expect((init.headers as Record<string, string>)["user-agent"]).toContain("RoleSpec")
    // The memoized request runs on its own signal, not the caller's: one query's
    // deadline must not cancel a request another query is still waiting on. That
    // the caller's abort still reaches it is covered in `fetch-memo.test.ts`.
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal).not.toBe(controller.signal)
  })

  it("fetches the feed once across two searches in the same run", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ data: [ARBEITNOW_JOB] }))

    const signal = new AbortController().signal
    const first = await arbeitnowAdapter.search(QUERY, signal, CONTEXT)
    const second = await arbeitnowAdapter.search({ role: "React Engineer" }, signal, CONTEXT)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toHaveLength(1)
    // The second query re-filters the memoized body rather than refetching it.
    expect(second).toHaveLength(1)
  })

  it("keeps postings matching the title or tags and drops the rest", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [
          ARBEITNOW_JOB,
          // Matches on a tag rather than the title.
          { ...ARBEITNOW_JOB, slug: "b", title: "Werkstudent", tags: ["React"] },
          { ...ARBEITNOW_JOB, slug: "c", title: "Pflegefachkraft", tags: ["Pflege"] },
        ],
      })
    )

    const postings = await arbeitnowAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings.map((posting) => posting.externalId)).toEqual([ARBEITNOW_JOB.slug, "b"])
  })

  it("caps the result count", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: Array.from({ length: 60 }, (_unused, index) => ({
          ...ARBEITNOW_JOB,
          slug: `job-${index}`,
        })),
      })
    )

    const postings = await arbeitnowAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(ARBEITNOW_RESULT_LIMIT)
  })

  it("returns an empty list on a non-OK status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 503))

    await expect(arbeitnowAdapter.search(QUERY, new AbortController().signal, CONTEXT)).resolves.toEqual([])
  })

  it("returns an empty list on an unrecognised shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ jobs: [] }))

    await expect(arbeitnowAdapter.search(QUERY, new AbortController().signal, CONTEXT)).resolves.toEqual([])
  })

  it("swallows a network failure rather than throwing at the pipeline", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"))

    await expect(arbeitnowAdapter.search(QUERY, new AbortController().signal, CONTEXT)).resolves.toEqual([])
  })

  it("does not call the source for an empty query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    await expect(
      arbeitnowAdapter.search({ role: "   " }, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
