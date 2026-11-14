// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  KALIBRR_RESULT_LIMIT,
  kalibrrAdapter,
  kalibrrSalaryText,
  parseKalibrrResponse,
} from "../kalibrr.adapter"
import fixture from "./fixtures/kalibrr-search.json"

/** Kalibrr has a cross-company search, so it ignores the watchlist. */
const CONTEXT = { atsWatchlist: { greenhouse: [], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] } }

/**
 * A live `text=Web Developer` response captured on 2026-09-13, trimmed to three
 * jobs — one work-from-home, one hybrid with a hidden salary, one onsite — and
 * with the HTML descriptions cut short.
 */
const [WFH_JOB, HYBRID_JOB, ONSITE_JOB] = fixture.jobs
const QUERY = { role: "Web Developer", keywords: ["react"] }

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

describe("parseKalibrrResponse", () => {
  it("maps the fields the live API returns", () => {
    const postings = parseKalibrrResponse({ jobs: [WFH_JOB] })

    expect(postings).toEqual([
      {
        provider: "kalibrr",
        externalId: "171137",
        title: "Web Developer | Junior to Mid",
        companyName: "Squadzip (Digital Space Explorer, Inc.)",
        url: "https://www.kalibrr.com/c/squadzip-digital-space-explorer-inc/jobs/171137/web-developer-junior-to-mid",
        location: "Makati, National Capital Region (Metro Manila), Philippines",
        workTypeHint: "remote",
        salaryText: undefined,
        description: WFH_JOB?.description,
        postedAt: "2026-07-28T23:54:39.795076+00:00",
        raw: WFH_JOB,
      },
    ])
  })

  it("reads the arrangement off the two boolean flags", () => {
    expect(parseKalibrrResponse({ jobs: [HYBRID_JOB] })?.[0]?.workTypeHint).toBe("hybrid")
    // Neither flag set is a real answer on this board, not an unstated one.
    expect(parseKalibrrResponse({ jobs: [ONSITE_JOB] })?.[0]?.workTypeHint).toBe("onsite")
  })

  it("skips empty address parts rather than leaving gaps in the location", () => {
    const job = {
      ...WFH_JOB,
      google_location: { address_components: { city: "Cebu City", region: null, country: "" } },
    }

    expect(parseKalibrrResponse({ jobs: [job] })?.[0]?.location).toBe("Cebu City")
  })

  it("leaves the location unset when the payload has no address", () => {
    expect(parseKalibrrResponse({ jobs: [{ ...WFH_JOB, google_location: null }] })?.[0]?.location)
      .toBeUndefined()
  })

  it("returns an empty list when the response has no jobs", () => {
    expect(parseKalibrrResponse({ count: 0, jobs: [] })).toEqual([])
  })

  it("returns null when the response has no jobs array", () => {
    expect(parseKalibrrResponse({ error: "nope" })).toBeNull()
    expect(parseKalibrrResponse(null)).toBeNull()
    expect(parseKalibrrResponse("<html>")).toBeNull()
  })

  it("skips entries missing an id, title, slug, company code or company name", () => {
    const postings = parseKalibrrResponse({
      jobs: [
        WFH_JOB,
        { ...WFH_JOB, id: undefined },
        { ...WFH_JOB, name: null },
        { ...WFH_JOB, slug: "" },
        { ...WFH_JOB, company: { name: "No code" } },
        { ...WFH_JOB, company: { code: "no-name" }, company_name: undefined },
        null,
      ],
    })

    expect(postings).toHaveLength(1)
  })
})

describe("kalibrrSalaryText", () => {
  it("publishes the range only when the employer chose to show it", () => {
    // The live hybrid posting carries a maximum alongside `salary_shown: false`.
    expect(kalibrrSalaryText(HYBRID_JOB)).toBeUndefined()
    expect(kalibrrSalaryText({ ...HYBRID_JOB, salary_shown: true })).toBe("PHP 50000 / month")
    expect(
      kalibrrSalaryText({ ...HYBRID_JOB, salary_shown: true, base_salary: 30000 })
    ).toBe("PHP 30000 - 50000 / month")
    expect(
      kalibrrSalaryText({
        ...HYBRID_JOB,
        salary_shown: true,
        base_salary: 50000,
      })
    ).toBe("PHP 50000 / month")
  })

  it("stays unset when there is no figure at all", () => {
    expect(kalibrrSalaryText(WFH_JOB)).toBeUndefined()
  })
})

describe("kalibrrAdapter.search", () => {
  it("issues exactly one request with the query, a capped limit and a descriptive User-Agent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(fixture))

    const controller = new AbortController()
    const postings = await kalibrrAdapter.search(QUERY, controller.signal, CONTEXT)

    expect(postings).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin + url.pathname).toBe("https://www.kalibrr.com/kjs/job_board/search")
    expect(url.searchParams.get("text")).toBe("Web Developer react")
    expect(url.searchParams.get("limit")).toBe(String(KALIBRR_RESULT_LIMIT))
    expect(url.searchParams.get("offset")).toBe("0")
    expect((init.headers as Record<string, string>)["user-agent"]).toContain("RoleSpec")
    expect(init.signal).toBe(controller.signal)
  })

  it("trusts the server-side search rather than re-filtering locally", async () => {
    // The live `text=Web Developer` page includes "iOS Developer"; the source
    // already judged it relevant, so the adapter keeps it.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(fixture))

    const postings = await kalibrrAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings.map((posting) => posting.title)).toContain("iOS Developer")
  })

  it("caps the result count", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        jobs: Array.from({ length: 60 }, (_unused, index) => ({ ...WFH_JOB, id: index + 1 })),
      })
    )

    const postings = await kalibrrAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(KALIBRR_RESULT_LIMIT)
  })

  it("returns an empty list on a non-OK status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 503))

    await expect(
      kalibrrAdapter.search(QUERY, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
  })

  it("returns an empty list on an unrecognised shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }))

    await expect(
      kalibrrAdapter.search(QUERY, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
  })

  it("returns an empty list when the body is not JSON at all", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>Service unavailable</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    )

    await expect(
      kalibrrAdapter.search(QUERY, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
  })

  it("swallows a network failure rather than throwing at the pipeline", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"))

    await expect(
      kalibrrAdapter.search(QUERY, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
  })

  it("does not call the source for an empty query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    await expect(
      kalibrrAdapter.search({ role: "   " }, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
