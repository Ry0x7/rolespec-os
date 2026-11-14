// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  BAMBOOHR_RESULT_LIMIT,
  bamboohrAdapter,
  bamboohrLocation,
  parseBambooHrPosting,
  parseBambooHrResponse,
} from "../bamboohr.adapter"
import { humanizeBoardSlug } from "../company-name"
import { clearFetchMemo } from "../fetch-memo"

// Pinned so the test does not move whenever the default watchlist is edited.
const CONTEXT = {
  atsWatchlist: {
    greenhouse: [],
    lever: [],
    ashby: [],
    bamboohr: ["kumu"],
    freshteam: [],
    workday: [],
  },
}

/** Trimmed from the real kumu `/careers/list` response captured on 2026-09-14. */
const BAMBOO_LIST = {
  meta: { totalCount: 3 },
  result: [
    {
      id: "336",
      jobOpeningName: "Business Development Associate",
      departmentId: "19634",
      departmentLabel: "Operations",
      employmentStatusLabel: "Probationary",
      employmentType: null,
      location: { city: "Makati", state: "Metro Manila" },
      atsLocation: { country: null, state: null, province: null, city: null },
      isRemote: null,
      locationType: "2",
    },
    {
      id: "337",
      jobOpeningName: "User Operations Associate",
      departmentLabel: "Operations",
      employmentStatusLabel: "Contractor",
      location: { city: null, state: null },
      atsLocation: { country: "Philippines", state: null, province: "NCR", city: "Makati" },
      isRemote: true,
      locationType: "1",
    },
    {
      id: "340",
      jobOpeningName: "Finance Associate",
      departmentLabel: "Finance",
      location: { city: "Makati", state: "Metro Manila" },
      isRemote: null,
    },
  ],
}

/** Trimmed from the real `/careers/336/detail` response captured on 2026-09-14. */
const BAMBOO_DETAIL = {
  meta: {},
  result: {
    jobOpening: {
      jobOpeningShareUrl: "https://kumu.bamboohr.com/careers/336",
      jobOpeningName: "Business Development Associate",
      jobOpeningStatus: "Open",
      departmentLabel: "Operations",
      location: { city: "Makati", state: "Metro Manila", addressCountry: "Philippines" },
      description: "<p>Are you a fan of social gaming?</p>",
      datePosted: "2026-01-12",
      minimumExperience: "Mid-level",
    },
    formFields: [],
  },
}

const QUERY = { role: "Business Development", keywords: [] }

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

describe("humanizeBoardSlug", () => {
  it.each([
    ["kumu", "Kumu"],
    ["globe", "Globe"],
    ["thinking-machines", "Thinking Machines"],
    ["acme_corp", "Acme Corp"],
    ["acme--corp", "Acme Corp"],
    ["-acme-", "Acme"],
    // No word boundary to recover, so it stays one word.
    ["thinkingmachines", "Thinkingmachines"],
    ["GITLAB", "Gitlab"],
    // Already uppercase and at most three characters, so it survives.
    ["ibm-uk", "Ibm Uk"],
    ["IBM-uk", "IBM Uk"],
  ])("turns %p into %p", (slug, expected) => {
    expect(humanizeBoardSlug(slug)).toBe(expected)
  })

  it.each(["", "-", "__"])("returns %p unchanged when there is nothing to humanize", (slug) => {
    expect(humanizeBoardSlug(slug)).toBe(slug)
  })
})

describe("bamboohrLocation", () => {
  it("joins the parts of `location` a reader would write", () => {
    expect(bamboohrLocation({ location: { city: "Makati", state: "Metro Manila" } })).toBe(
      "Makati, Metro Manila"
    )
  })

  it("falls through to `atsLocation` when `location` is empty", () => {
    expect(
      bamboohrLocation({
        location: { city: null, state: null },
        atsLocation: { country: "Philippines", province: "NCR", city: "Makati" },
      })
    ).toBe("Makati, NCR, Philippines")
  })

  it("does not repeat a part that appears in both objects", () => {
    expect(
      bamboohrLocation({
        location: { city: "Makati" },
        atsLocation: { city: "makati", country: "Philippines" },
      })
    ).toBe("Makati, Philippines")
  })

  it("is undefined when the board states no place at all", () => {
    expect(bamboohrLocation({ location: {}, atsLocation: {} })).toBeUndefined()
  })
})

describe("parseBambooHrResponse", () => {
  it("maps the fields the live list endpoint returns", () => {
    const postings = parseBambooHrResponse(BAMBOO_LIST, "kumu", QUERY)

    expect(postings).toEqual([
      {
        provider: "bamboohr",
        externalId: "336",
        title: "Business Development Associate",
        // The payload never names the company, so the humanized slug stands in.
        companyName: "Kumu",
        url: "https://kumu.bamboohr.com/careers/336",
        location: "Makati, Metro Manila",
        // The list has neither a body nor a date.
        raw: BAMBOO_LIST.result[0],
      },
    ])
  })

  it("carries a remote hint only when the board says so", () => {
    const postings = parseBambooHrResponse(BAMBOO_LIST, "kumu", { role: "Associate" })

    expect(postings?.map((posting) => posting.workTypeHint)).toEqual([
      undefined,
      "remote",
      undefined,
    ])
  })

  it("filters on the title, not the rest of the entry", () => {
    // "Probationary" is only ever an `employmentStatusLabel`.
    expect(parseBambooHrResponse(BAMBOO_LIST, "kumu", { role: "Probationary" })).toEqual([])
  })

  it("returns an empty list for a board with no openings", () => {
    expect(parseBambooHrResponse({ meta: { totalCount: 0 }, result: [] }, "kumu", QUERY)).toEqual([])
  })

  it.each([null, undefined, "nope", 7, [], { result: {} }, { jobs: [] }])(
    "returns null for the unrecognised body %p",
    (body) => {
      expect(parseBambooHrResponse(body, "kumu", QUERY)).toBeNull()
    }
  )

  it("drops an entry with no id or no title rather than crashing", () => {
    const postings = parseBambooHrResponse(
      {
        result: [
          { jobOpeningName: "Business Development Associate" },
          { id: "9" },
          null,
          "nope",
          BAMBOO_LIST.result[0],
        ],
      },
      "kumu",
      QUERY
    )

    expect(postings?.map((posting) => posting.externalId)).toEqual(["336"])
  })
})

describe("parseBambooHrPosting", () => {
  it("reads the description and the real posting date off the detail endpoint", () => {
    expect(parseBambooHrPosting(BAMBOO_DETAIL, "kumu", "336")).toEqual({
      provider: "bamboohr",
      externalId: "336",
      title: "Business Development Associate",
      companyName: "Kumu",
      url: "https://kumu.bamboohr.com/careers/336",
      location: "Makati, Metro Manila, Philippines",
      description: "<p>Are you a fan of social gaming?</p>",
      postedAt: "2026-01-12",
      // The detail payload has no id of its own, so the one from the URL is added.
      raw: { ...BAMBOO_DETAIL.result.jobOpening, id: "336" },
    })
  })

  it.each([null, {}, { result: null }, { result: { jobOpening: null } }, { result: {} }])(
    "returns null for the unrecognised detail body %p",
    (body) => {
      expect(parseBambooHrPosting(body, "kumu", "336")).toBeNull()
    }
  )
})

describe("bamboohrAdapter", () => {
  it("asks the watched board once and returns what matched", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(BAMBOO_LIST) as never)

    const postings = await bamboohrAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://kumu.bamboohr.com/careers/list")
    expect(postings.map((posting) => posting.externalId)).toEqual(["336"])
  })

  it("returns nothing and does not fetch when the watchlist is empty", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    expect(
      await bamboohrAdapter.search(QUERY, new AbortController().signal, {
        atsWatchlist: { ...CONTEXT.atsWatchlist, bamboohr: [] },
      })
    ).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns nothing for a blank query without touching the network", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    expect(await bamboohrAdapter.search({ role: "" }, new AbortController().signal, CONTEXT)).toEqual(
      []
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a slug that could not be a subdomain", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")

    expect(
      await bamboohrAdapter.search(QUERY, new AbortController().signal, {
        atsWatchlist: { ...CONTEXT.atsWatchlist, bamboohr: ["evil.com/x"] },
      })
    ).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("survives a non-OK status, a thrown request and an unparseable body", async () => {
    const signal = new AbortController().signal

    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 404) as never)
    expect(await bamboohrAdapter.search(QUERY, signal, CONTEXT)).toEqual([])

    clearFetchMemo()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"))
    expect(await bamboohrAdapter.search(QUERY, signal, CONTEXT)).toEqual([])

    clearFetchMemo()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>", { status: 200 }) as never)
    expect(await bamboohrAdapter.search(QUERY, signal, CONTEXT)).toEqual([])
  })

  it("caps what one query can return", async () => {
    const result = Array.from({ length: BAMBOOHR_RESULT_LIMIT + 10 }, (_, index) => ({
      id: String(index),
      jobOpeningName: "Business Development Associate",
      location: { city: "Makati" },
    }))
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ result }) as never)

    const postings = await bamboohrAdapter.search(QUERY, new AbortController().signal, CONTEXT)

    expect(postings).toHaveLength(BAMBOOHR_RESULT_LIMIT)
  })
})
