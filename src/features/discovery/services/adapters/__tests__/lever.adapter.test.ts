// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { clearFetchMemo } from "../fetch-memo"
import { LEVER_RESULT_LIMIT, leverAdapter, parseLeverResponse } from "../lever.adapter"

// Pinned so the test does not move whenever the default watchlist is edited.
const CONTEXT = { atsWatchlist: { greenhouse: [], lever: ["ro", "spotify"], ashby: [], bamboohr: [], freshteam: [], workday: [] } }

/** Shaped from a real spotify board response captured on 2026-09-04. */
const LEVER_POSTING = {
  categories: {
    commitment: "Permanent",
    department: "Engineering",
    location: "London",
    team: "Experience",
    allLocations: ["London", "Stockholm"],
  },
  createdAt: 1782214185805,
  descriptionPlain: "Join the Experience team.",
  id: "2193db3f-77c5-43b8-b030-8f92c9882bf1",
  text: "Frontend Engineer - Experience",
  country: "GB",
  workplaceType: "hybrid",
  hostedUrl: "https://jobs.lever.co/spotify/2193db3f-77c5-43b8-b030-8f92c9882bf1",
  applyUrl: "https://jobs.lever.co/spotify/2193db3f-77c5-43b8-b030-8f92c9882bf1/apply",
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

describe("parseLeverResponse", () => {
  it("maps the fields the live API returns", () => {
    const postings = parseLeverResponse([LEVER_POSTING], "spotify", QUERY)

    expect(postings).toEqual([
      {
        provider: "lever",
        externalId: "2193db3f-77c5-43b8-b030-8f92c9882bf1",
        title: "Frontend Engineer - Experience",
        // Lever's payload has no company name, so the watchlist slug stands in.
        companyName: "spotify",
        url: LEVER_POSTING.hostedUrl,
        location: "London",
        workTypeHint: "hybrid",
        description: "Join the Experience team.",
        // `createdAt` is unix milliseconds, not a date string.
        postedAt: new Date(1782214185805).toISOString(),
        raw: LEVER_POSTING,
      },
    ])
  })

  it("leaves the work type hint unset when the board omits it", () => {
    const postings = parseLeverResponse(
      [{ ...LEVER_POSTING, workplaceType: undefined }],
      "spotify",
      QUERY
    )

    expect(postings?.[0]?.workTypeHint).toBeUndefined()
  })

  it("returns null when the response is not the documented array", () => {
    expect(parseLeverResponse({ postings: [] }, "spotify", QUERY)).toBeNull()
    expect(parseLeverResponse(null, "spotify", QUERY)).toBeNull()
    expect(parseLeverResponse("<html>", "spotify", QUERY)).toBeNull()
  })

  it("skips entries missing an id, title or url", () => {
    const postings = parseLeverResponse(
      [
        LEVER_POSTING,
        { ...LEVER_POSTING, id: undefined },
        { ...LEVER_POSTING, hostedUrl: undefined },
        null,
      ],
      "spotify",
      QUERY
    )

    expect(postings).toHaveLength(1)
  })
})

describe("leverAdapter.search", () => {
  it("requests every watched board with a descriptive User-Agent", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse([LEVER_POSTING]))

    const controller = new AbortController()
    const postings = await leverAdapter.search(QUERY, controller.signal, CONTEXT)

    expect(postings).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.lever.co/v0/postings/ro?mode=json",
      "https://api.lever.co/v0/postings/spotify?mode=json",
    ])

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)["user-agent"]).toContain("RoleSpec")
    // The memoized request runs on its own signal, not the caller's: one query's
    // deadline must not cancel a request another query is still waiting on. That
    // the caller's abort still reaches it is covered in `fetch-memo.test.ts`.
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal).not.toBe(controller.signal)
  })

  it("names each posting after the board it came from", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse([LEVER_POSTING]))

    const postings = await leverAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings.map((posting) => posting.companyName)).toEqual(["ro", "spotify"])
  })

  it("fetches each board once across two searches in the same run", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse([LEVER_POSTING]))

    const signal = new AbortController().signal
    await leverAdapter.search(QUERY, signal, CONTEXT)
    const second = await leverAdapter.search({ role: "Frontend Developer" }, signal, CONTEXT)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(second).toHaveLength(2)
  })

  it("keeps postings matching the title and drops the rest", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("/spotify")
        ? jsonResponse([
            LEVER_POSTING,
            { ...LEVER_POSTING, id: "b", text: "Compounding Pharmacy Technician" },
            { ...LEVER_POSTING, id: "c", text: "React Developer" },
          ])
        : jsonResponse([])
    )

    const postings = await leverAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings.map((posting) => posting.externalId)).toEqual([LEVER_POSTING.id, "c"])
  })

  it("caps the total across boards", async () => {
    // 15 matches per board, so the cap can only be hit by both boards together.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      jsonResponse(
        Array.from({ length: 15 }, (_unused, index) => ({
          ...LEVER_POSTING,
          id: `${String(input).includes("/ro?") ? "ro" : "sp"}-${index}`,
        }))
      )
    )

    const postings = await leverAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(LEVER_RESULT_LIMIT)
  })

  it("keeps one board's results when the other slug fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/ro?")) throw new Error("ENOTFOUND")
      return jsonResponse([LEVER_POSTING])
    })

    const postings = await leverAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(1)
  })

  it("keeps one board's results when the other returns a non-OK status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/ro?")) return jsonResponse({}, 404)
      return jsonResponse([LEVER_POSTING])
    })

    const postings = await leverAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(1)
  })

  it("returns an empty list on an unrecognised shape", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ postings: [] }))

    await expect(leverAdapter.search(QUERY, new AbortController().signal, CONTEXT)).resolves.toEqual([])
  })

  it("swallows a network failure rather than throwing at the pipeline", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"))

    await expect(leverAdapter.search(QUERY, new AbortController().signal, CONTEXT)).resolves.toEqual([])
  })

  it("fetches nothing when the user watches no Lever boards", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    await expect(
      leverAdapter.search(QUERY, new AbortController().signal, {
        atsWatchlist: { greenhouse: ["gitlab"], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] },
      })
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not call the source for an empty query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    await expect(
      leverAdapter.search({ role: "   " }, new AbortController().signal, CONTEXT)
    ).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
