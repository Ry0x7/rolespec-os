import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  mockAuth,
  mockPrisma,
  mockConsumeRateLimit,
  mockLoadCareerProfile,
  mockSearch,
  mockRevalidatePath,
  mockFetchPosting,
  mockProbeBoards,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    jobApplication: { create: vi.fn() },
    interviewQuestion: { createMany: vi.fn() },
    job: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    careerProfile: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  mockConsumeRateLimit: vi.fn(),
  mockLoadCareerProfile: vi.fn(),
  mockSearch: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockFetchPosting: vi.fn(),
  mockProbeBoards: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { DISCOVERY_RUN: "discovery:run", DISCOVERY_ADD_URL: "discovery:add-url" },
  RATE_LIMIT_MESSAGE: "Too many attempts. Please try again later.",
  consumeRateLimit: mockConsumeRateLimit,
}))
vi.mock("@/features/career-profile/services/career-profile.service", () => ({
  loadCareerProfile: mockLoadCareerProfile,
}))
vi.mock("../../services/adapters", () => ({
  SOURCE_ADAPTERS: [{ id: "remotive", label: "Remotive", search: mockSearch }],
}))
/**
 * `addJobByUrl` fetches the page and extracts from it in two steps now, so a
 * careers index can be told apart from a posting in between. Both halves are
 * driven by the same `mockFetchPosting` value every case below already sets:
 * a failure short-circuits at the fetch, and a success becomes a page whose
 * extraction returns that posting. `detectListing` is NOT mocked — it runs for
 * real against this stand-in HTML, which has no JSON-LD and no links, so it
 * says "single" exactly as a real posting page would.
 */
const { SINGLE_POSTING_HTML, pageState } = vi.hoisted(() => ({
  SINGLE_POSTING_HTML: "<html><head><title>Frontend Engineer at Acme</title></head></html>",
  pageState: { last: undefined as unknown },
}))

vi.mock("../../services/fetch-posting.service", async (importOriginal) => ({
  // The pure helpers stay real — `careers-listing.service` reads the page's
  // JSON-LD through them, and mocking them would mock the detector out too.
  ...(await importOriginal<typeof import("../../services/fetch-posting.service")>()),
  POSTING_FETCH_TIMEOUT_MS: 10_000,
  fetchPostingFromUrl: mockFetchPosting,
  fetchPostingPage: async (url: string) => {
    const result = await mockFetchPosting(url)
    if (!result.ok) return result
    pageState.last = result
    // A case that wants the careers-index path puts the page's HTML on the
    // mocked result; everything else gets the inert single-posting page.
    const html = typeof result.pageHtml === "string" ? result.pageHtml : SINGLE_POSTING_HTML
    return { ok: true, kind: "html", html, finalUrl: new URL(url) }
  },
  extractPostingFromHtml: () => pageState.last,
  jobPostingToRaw: () => null,
}))
// Only the network half is replaced: slug derivation is the part of this action
// worth asserting end to end, so it runs for real.
vi.mock("../../services/company-board-probe.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/company-board-probe.service")>()),
  probeBoards: mockProbeBoards,
}))

import { DEFAULT_PREFERENCES } from "@/features/settings/schemas/preferences.schema"
import { SOURCE_ADAPTERS } from "../../services/adapters"
import {
  addJobByUrl,
  probeCompanyBoards,
  runDiscovery,
  saveDiscoveredJob,
} from "../discovery.actions"

function rawPosting(overrides: Record<string, unknown> = {}) {
  return {
    provider: "remotive",
    externalId: "1",
    title: "Frontend Engineer",
    companyName: "Acme",
    url: "https://example.com/jobs/1",
    raw: {},
    ...overrides,
  }
}

const SAVE_INPUT = {
  provider: "remotive",
  externalId: "1",
  title: "Frontend Engineer",
  companyName: "Acme",
  url: "https://example.com/jobs/1?utm_source=x",
  location: "Worldwide",
  description: "Ship React features. Why do you want to join Acme?",
  postedAt: "2026-08-27T14:36:09.000Z",
}

beforeEach(() => {
  // The ingest helper writes the Job and the JobApplication in one
  // transaction; running the callback against the same mock keeps every
  // assertion below pointed at the real create call.
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma))
  mockPrisma.job.create.mockResolvedValue({ id: "job-row-1" })
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})

  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockConsumeRateLimit.mockResolvedValue(true)
  mockLoadCareerProfile.mockResolvedValue({
    targetRoles: [{ title: "Frontend Engineer", priority: 0, active: true }],
  })
  mockSearch.mockResolvedValue([rawPosting()])
  mockPrisma.job.findMany.mockResolvedValue([])
  mockPrisma.user.findUnique.mockResolvedValue({
    preferences: { atsWatchlist: { greenhouse: ["gitlab"], lever: [] } },
  })
  mockPrisma.job.findFirst.mockResolvedValue(null)
  mockPrisma.jobApplication.create.mockResolvedValue({ id: "job-1" })
  mockPrisma.job.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.careerProfile.findUnique.mockResolvedValue({
    locations: [],
    openToRelocation: false,
    workModes: ["REMOTE"],
    requiresSponsorship: false,
    experienceLevel: null,
    targetRoles: [{ title: "Frontend Engineer", active: true }],
    capabilities: [{ name: "React", confirmed: true }],
  })
  mockPrisma.interviewQuestion.createMany.mockResolvedValue({ count: 1 })
  mockProbeBoards.mockResolvedValue([])
  mockFetchPosting.mockResolvedValue({
    ok: true,
    extractionMethod: "json-ld",
    posting: {
      provider: "web",
      externalId: "https://acme.com/careers/1",
      title: "Frontend Engineer",
      companyName: "Acme",
      url: "https://acme.com/careers/1",
      canonicalUrl: "https://acme.com/careers/1",
      location: "Remote",
      description: "Ship React features.",
      postedAt: new Date("2026-08-20T00:00:00.000Z"),
    },
  })
})

describe("runDiscovery", () => {
  it("refuses without a session and never touches a source", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await runDiscovery()).toEqual({ error: "Unauthorized" })
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it("refuses when the run limit is spent", async () => {
    mockConsumeRateLimit.mockResolvedValue(false)

    const result = await runDiscovery()

    expect(result).toEqual({ error: "Too many attempts. Please try again later." })
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it("returns no queries and runs nothing when the profile has no active roles", async () => {
    mockLoadCareerProfile.mockResolvedValue({
      targetRoles: [{ title: "Paused", priority: 0, active: false }],
    })

    expect(await runDiscovery()).toEqual({ queries: [], candidates: [], sources: [] })
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it("runs one search per derived query and returns normalized candidates", async () => {
    mockLoadCareerProfile.mockResolvedValue({
      targetRoles: [
        { title: "Frontend Engineer", priority: 0, active: true },
        { title: "Product Designer", priority: 1, active: true },
      ],
    })
    mockSearch
      .mockResolvedValueOnce([rawPosting({ externalId: "1", url: "https://example.com/jobs/1" })])
      .mockResolvedValueOnce([rawPosting({ externalId: "2", url: "https://example.com/jobs/2" })])

    const result = await runDiscovery()

    expect(mockSearch).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ queries: ["Frontend Engineer", "Product Designer"] })
    expect("candidates" in result && result.candidates.map((c) => c.externalId)).toEqual([
      "1",
      "2",
    ])
  })

  it("reports each source's postings, timing and status", async () => {
    const result = await runDiscovery()

    expect("sources" in result && result.sources).toEqual([
      { provider: "remotive", label: "Remotive", count: 1, ms: expect.any(Number), status: "ok" },
    ])
  })

  it("reports a source that broke its resolve contract as failed", async () => {
    mockSearch.mockRejectedValue(new Error("adapter blew up"))

    const result = await runDiscovery()

    expect("sources" in result && result.sources[0]).toMatchObject({
      provider: "remotive",
      count: 0,
      status: "error",
    })
  })

  it("reports a source whose own budget ran out as timed out, not as empty", async () => {
    // The per-adapter budget, already spent: adapters swallow the abort and
    // resolve empty, so the signal is the only thing that knows what happened.
    const budget = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort())
    mockSearch.mockResolvedValue([])

    const result = await runDiscovery()
    budget.mockRestore()

    expect("sources" in result && result.sources[0]).toMatchObject({
      provider: "remotive",
      count: 0,
      status: "timeout",
    })
  })

  it("reports an abort inherited from a memo-shared request as a timeout", async () => {
    // The call's own signal never fired: the rejection came from a request
    // another query started and whose budget ran out. That is a slow source,
    // not a broken one.
    mockSearch.mockRejectedValue(new DOMException("This operation was aborted", "AbortError"))

    const result = await runDiscovery()

    expect("sources" in result && result.sources[0]).toMatchObject({
      provider: "remotive",
      count: 0,
      status: "timeout",
    })
  })

  it("skips an adapter with nothing configured and never calls it", async () => {
    const adapter = SOURCE_ADAPTERS[0]
    if (!adapter) throw new Error("the mocked registry lost its adapter")
    adapter.isConfigured = () => false

    const result = await runDiscovery()

    expect(mockSearch).not.toHaveBeenCalled()
    expect("sources" in result && result.sources[0]).toMatchObject({
      provider: "remotive",
      count: 0,
      ms: 0,
      status: "skipped",
    })
    delete adapter.isConfigured
  })

  it("hands every adapter the user's own ATS watchlist", async () => {
    await runDiscovery()

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { preferences: true },
    })
    expect(mockSearch.mock.calls[0]?.[2]).toEqual({
      // The stored row predates Ashby, so that list arrives empty.
      atsWatchlist: { greenhouse: ["gitlab"], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] },
    })
  })

  it("falls back to the default watchlist when the preferences read fails", async () => {
    mockPrisma.user.findUnique.mockRejectedValue(new Error("db down"))

    const result = await runDiscovery()

    expect("candidates" in result).toBe(true)
    expect(mockSearch.mock.calls[0]?.[2]).toEqual({
      atsWatchlist: DEFAULT_PREFERENCES.atsWatchlist,
    })
  })

  it("dedupes the same posting returned by two queries", async () => {
    mockLoadCareerProfile.mockResolvedValue({
      targetRoles: [
        { title: "Frontend Engineer", priority: 0, active: true },
        { title: "React Engineer", priority: 1, active: true },
      ],
    })
    mockSearch
      .mockResolvedValueOnce([rawPosting({ url: "https://example.com/jobs/1?utm_source=a" })])
      .mockResolvedValueOnce([rawPosting({ url: "https://example.com/jobs/1?utm_source=b" })])

    const result = await runDiscovery()

    expect("candidates" in result && result.candidates).toHaveLength(1)
  })

  it("survives one source rejecting", async () => {
    mockLoadCareerProfile.mockResolvedValue({
      targetRoles: [
        { title: "A", priority: 0, active: true },
        { title: "B", priority: 1, active: true },
      ],
    })
    mockSearch
      .mockRejectedValueOnce(new Error("adapter broke its contract"))
      .mockResolvedValueOnce([rawPosting()])

    const result = await runDiscovery()

    expect("candidates" in result && result.candidates).toHaveLength(1)
  })

  it("hands every adapter the profile's confirmed capabilities as keywords", async () => {
    mockLoadCareerProfile.mockResolvedValue({
      targetRoles: [{ title: "Frontend Engineer", priority: 0, active: true }],
      capabilities: [
        { name: "React", confirmed: true },
        { name: "Kubernetes", confirmed: false },
      ],
    })

    await runDiscovery()

    expect(mockSearch.mock.calls[0]?.[0]).toEqual({
      role: "Frontend Engineer",
      keywords: ["React"],
    })
  })

  it("ranks a keyword match above an equal posting, without dropping either", async () => {
    mockLoadCareerProfile.mockResolvedValue({
      targetRoles: [{ title: "Frontend Engineer", priority: 0, active: true }],
      capabilities: [{ name: "React", confirmed: true }],
    })
    mockSearch.mockResolvedValue([
      rawPosting({ externalId: "1", url: "https://example.com/jobs/1" }),
      rawPosting({
        externalId: "2",
        url: "https://example.com/jobs/2",
        title: "React Frontend Engineer",
      }),
    ])

    const result = await runDiscovery()
    const candidates = "candidates" in result ? result.candidates : []

    // Same verdict for both, so only the keyword hit can have reordered them —
    // and the posting that misses the keyword is still on the list.
    expect(candidates.map((c) => c.externalId)).toEqual(["2", "1"])
    expect(new Set(candidates.map((c) => c.qualification.verdict)).size).toBe(1)
  })

  it("marks a posting the user already saved, by canonical URL or raw link", async () => {
    mockSearch.mockResolvedValue([
      rawPosting({ externalId: "1", url: "https://example.com/jobs/1" }),
      rawPosting({ externalId: "2", url: "https://example.com/jobs/2" }),
      rawPosting({ externalId: "3", url: "https://example.com/jobs/3" }),
    ])
    mockPrisma.job.findMany.mockResolvedValue([
      {
        canonicalUrl: "https://example.com/jobs/1",
        url: null,
        applications: [{ id: "job-a" }],
      },
      {
        canonicalUrl: null,
        url: "https://example.com/jobs/2?utm_source=old",
        applications: [{ id: "job-b" }],
      },
      // A posting whose application was deleted must not read as saved.
      { canonicalUrl: "https://example.com/jobs/3", url: null, applications: [] },
    ])

    const result = await runDiscovery()
    const candidates = "candidates" in result ? result.candidates : []

    expect(candidates.map((c) => [c.externalId, c.alreadySaved, c.savedJobId])).toEqual([
      ["1", true, "job-a"],
      ["2", true, "job-b"],
      ["3", false, undefined],
    ])
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1" }),
      })
    )
  })

  it("qualifies every candidate against the profile without a second read", async () => {
    mockLoadCareerProfile.mockResolvedValue({
      targetRoles: [{ title: "Frontend Engineer", priority: 0, active: true }],
      workModes: ["REMOTE"],
      requiresSponsorship: false,
      capabilities: [{ name: "React", confirmed: true }],
    })
    mockSearch.mockResolvedValue([
      rawPosting({ description: "Ship React features.", workTypeHint: "remote" }),
    ])

    const result = await runDiscovery()
    const candidate = "candidates" in result ? result.candidates[0] : null

    expect(candidate?.qualification.match.matched).toEqual(["React"])
    expect(candidate?.qualification.verdict).toBeDefined()
    expect(candidate?.qualification.nextAction).toBeTruthy()
    expect(mockLoadCareerProfile).toHaveBeenCalledTimes(1)
  })

  it("orders candidates by verdict, ruled-out last", async () => {
    mockLoadCareerProfile.mockResolvedValue({
      targetRoles: [{ title: "Frontend Engineer", priority: 0, active: true }],
      requiresSponsorship: true,
    })
    mockSearch.mockResolvedValue([
      rawPosting({
        externalId: "blocked",
        url: "https://example.com/jobs/blocked",
        description: "We are unable to offer visa sponsorship for this role.",
      }),
      rawPosting({
        externalId: "open",
        url: "https://example.com/jobs/open",
        description: "Ship React features with a small team.",
      }),
    ])

    const result = await runDiscovery()
    const candidates = "candidates" in result ? result.candidates : []

    expect(candidates.map((c) => c.externalId)).toEqual(["open", "blocked"])
    expect(candidates[1].qualification.verdict).toBe("BLOCKED")
  })

  it("lets Low confidence cost a Strong fit its place at the top", async () => {
    mockLoadCareerProfile.mockResolvedValue({
      targetRoles: [{ title: "Frontend Engineer", priority: 0, active: true }],
      workModes: ["REMOTE"],
      capabilities: [{ name: "React", confirmed: true }],
    })
    // Long enough to read as a detailed posting, which is part of what earns
    // the two rivals their High confidence.
    const detailed = `${"You will work with a small product team and own delivery end to end. ".repeat(
      12
    )}`
    const fresh = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const stale = new Date(Date.now() - 200 * 86_400_000).toISOString()

    mockSearch.mockResolvedValue([
      // STRONG, but a 200-day-old listing with no body: Low confidence.
      rawPosting({
        externalId: "strong-low",
        url: "https://example.com/jobs/strong-low",
        title: "Frontend Engineer",
        location: "Worldwide",
        workTypeHint: "remote",
        postedAt: stale,
      }),
      // WORTH_A_LOOK on the fit — the posting names none of the user's
      // capabilities — but fresh, named and detailed: High confidence.
      rawPosting({
        externalId: "worth-high",
        url: "https://example.com/jobs/worth-high",
        title: "Frontend Engineer",
        location: "Worldwide",
        workTypeHint: "remote",
        postedAt: fresh,
        description: detailed,
      }),
      // WEAK on the fit, however good the posting itself is.
      rawPosting({
        externalId: "weak-high",
        url: "https://example.com/jobs/weak-high",
        title: "Bookkeeper",
        location: "Worldwide",
        workTypeHint: "remote",
        postedAt: fresh,
        description: detailed,
      }),
    ])

    const result = await runDiscovery()
    const candidates = "candidates" in result ? result.candidates : []

    expect(
      candidates.map((c) => [
        c.externalId,
        c.qualification.verdict,
        c.confidence.level,
      ])
    ).toEqual([
      ["worth-high", "WORTH_A_LOOK", "HIGH"],
      ["strong-low", "STRONG", "LOW"],
      ["weak-high", "WEAK", "HIGH"],
    ])
  })

  it("persists nothing during a run", async () => {
    await runDiscovery()

    expect(mockPrisma.jobApplication.create).not.toHaveBeenCalled()
  })

  it("errors instead of searching when the profile cannot be read", async () => {
    mockLoadCareerProfile.mockRejectedValue(new Error("db down"))

    const result = await runDiscovery()

    expect(result).toEqual({ error: "Could not read your career profile. Please try again." })
    expect(mockSearch).not.toHaveBeenCalled()
  })
})

describe("addJobByUrl", () => {
  const URL_UNDER_TEST = "https://acme.com/careers/1"

  it("refuses without a session and never fetches the page", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await addJobByUrl(URL_UNDER_TEST)).toMatchObject({ error: "Unauthorized" })
    expect(mockFetchPosting).not.toHaveBeenCalled()
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
  })

  it("refuses on an empty URL before spending the limit", async () => {
    expect(await addJobByUrl("   ".trim())).toMatchObject({ reason: "invalid-url" })
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
    expect(mockFetchPosting).not.toHaveBeenCalled()
  })

  it("refuses when its own limit is spent, on its own bucket", async () => {
    mockConsumeRateLimit.mockResolvedValue(false)

    const result = await addJobByUrl(URL_UNDER_TEST)

    expect(result).toMatchObject({ error: "Too many attempts. Please try again later." })
    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      "discovery:add-url",
      "user-1",
      expect.objectContaining({ max: expect.any(Number) })
    )
    expect(mockFetchPosting).not.toHaveBeenCalled()
  })

  it("returns a candidate in the same shape a run returns", async () => {
    const result = await addJobByUrl(URL_UNDER_TEST)

    expect("candidate" in result).toBe(true)
    if (!("candidate" in result)) return
    expect(result.extractionMethod).toBe("json-ld")
    expect(result.candidate).toMatchObject({
      provider: "web",
      title: "Frontend Engineer",
      companyName: "Acme",
      url: URL_UNDER_TEST,
      alreadySaved: false,
      // Serialised for the client, exactly as `runDiscovery` does.
      postedAt: "2026-08-20T00:00:00.000Z",
    })
    expect(result.candidate.qualification.verdict).toBeDefined()
    expect(result.candidate.qualification.nextAction).toBeTruthy()
  })

  it("passes the typed failure reason through", async () => {
    mockFetchPosting.mockResolvedValue({
      ok: false,
      reason: "blocked",
      message: "The page refused automated access.",
    })

    expect(await addJobByUrl(URL_UNDER_TEST)).toEqual({
      error: "The page refused automated access.",
      reason: "blocked",
    })
  })

  it("marks a posting the caller already has, scoped to that caller", async () => {
    mockPrisma.job.findMany.mockResolvedValue([{ applications: [{ id: "job-a" }] }])

    const result = await addJobByUrl(URL_UNDER_TEST)

    expect("candidate" in result && result.candidate).toMatchObject({
      alreadySaved: true,
      savedJobId: "job-a",
    })
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) })
    )
  })

  it("still returns the candidate when the already-saved read fails", async () => {
    mockPrisma.job.findMany.mockRejectedValue(new Error("db down"))

    const result = await addJobByUrl(URL_UNDER_TEST)

    expect("candidate" in result && result.candidate.alreadySaved).toBe(false)
  })

  it("persists nothing", async () => {
    await addJobByUrl(URL_UNDER_TEST)

    expect(mockPrisma.job.create).not.toHaveBeenCalled()
    expect(mockPrisma.jobApplication.create).not.toHaveBeenCalled()
  })

  describe("when the page is a careers listing", () => {
    const LISTING_URL = "https://acme.com/careers/"
    /** Ten postings, so one add-by-URL cannot reach the end of the list. */
    const LISTING_HTML = `<html><head><title>Careers at Acme</title></head><body>${Array.from(
      { length: 10 },
      (_, index) => `<a href="/careers/jobs/${1000 + index}/role">Role ${index}</a>`
    ).join("")}</body></html>`

    function postingFor(index: number) {
      return {
        ok: true,
        extractionMethod: "json-ld",
        posting: {
          provider: "web",
          externalId: `https://acme.com/careers/jobs/${1000 + index}/role`,
          title: `Role ${index}`,
          companyName: "Acme",
          url: `https://acme.com/careers/jobs/${1000 + index}/role`,
          canonicalUrl: `https://acme.com/careers/jobs/${1000 + index}/role`,
        },
      }
    }

    /** The page itself, then one posting per link the action goes on to fetch. */
    function serveListing(startIndex = 0) {
      mockFetchPosting.mockReset()
      mockFetchPosting.mockResolvedValueOnce({ ...postingFor(0), pageHtml: LISTING_HTML })
      for (let index = 0; index < 10; index += 1) {
        mockFetchPosting.mockResolvedValueOnce(postingFor(startIndex + index))
      }
    }

    it("returns every posting it could fetch, plus what is left", async () => {
      serveListing()

      const result = await addJobByUrl(LISTING_URL)

      expect("listing" in result).toBe(true)
      if (!("listing" in result)) return
      expect(result.listing).toMatchObject({
        host: "acme.com",
        pageTitle: "Careers at Acme",
        totalLinks: 10,
        fetched: 8,
        skipped: 0,
      })
      expect(result.listing.remaining).toHaveLength(2)
      expect(result.candidates).toHaveLength(8)
      expect(result.candidates[0]).toMatchObject({ title: "Role 0", alreadySaved: false })
      expect(result.candidates[0]?.qualification.verdict).toBeDefined()
      expect(result.candidates[0]?.confidence.level).toBeDefined()
    })

    it("takes the next slice when Fetch more passes an offset", async () => {
      serveListing(8)

      const result = await addJobByUrl(LISTING_URL, { offset: 8 })

      expect("listing" in result).toBe(true)
      if (!("listing" in result)) return
      expect(result.listing).toMatchObject({ totalLinks: 10, fetched: 10 })
      expect(result.listing.remaining).toEqual([])
      expect(result.candidates).toHaveLength(2)
    })

    it("says so when it is a listing whose postings cannot be read", async () => {
      mockFetchPosting.mockReset()
      mockFetchPosting.mockResolvedValueOnce({ ...postingFor(0), pageHtml: LISTING_HTML })
      mockFetchPosting.mockResolvedValue({
        ok: false,
        reason: "blocked",
        message: "The page refused automated access.",
      })

      const result = await addJobByUrl(LISTING_URL)

      expect(result).toMatchObject({ reason: "no-posting" })
      expect("error" in result && result.error).toMatch(/looks like a careers listing/)
      expect("error" in result && result.error).toMatch(/Watched companies|browser extension/)
    })

    it("persists nothing", async () => {
      serveListing()

      await addJobByUrl(LISTING_URL)

      expect(mockPrisma.job.create).not.toHaveBeenCalled()
      expect(mockPrisma.jobApplication.create).not.toHaveBeenCalled()
    })
  })
})

describe("saveDiscoveredJob", () => {
  it("refuses without a session", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await saveDiscoveredJob(SAVE_INPUT)).toEqual({ error: "Unauthorized" })
    expect(mockPrisma.jobApplication.create).not.toHaveBeenCalled()
  })

  it("rejects an invalid payload before writing", async () => {
    const result = await saveDiscoveredJob({ ...SAVE_INPUT, url: "not-a-url" })

    expect(result).toEqual({ error: "Invalid input" })
    expect(mockPrisma.jobApplication.create).not.toHaveBeenCalled()
  })

  it("rejects an oversized description", async () => {
    const result = await saveDiscoveredJob({ ...SAVE_INPUT, description: "x".repeat(20001) })

    expect(result).toEqual({ error: "Invalid input" })
    expect(mockPrisma.jobApplication.create).not.toHaveBeenCalled()
  })

  it("creates an INTERESTED job stamped with its discovery provenance", async () => {
    const result = await saveDiscoveredJob(SAVE_INPUT)

    expect(result).toEqual({ success: true, id: "job-1", duplicate: false })

    // The posting and its provenance are written to `Job`; the application
    // keeps only the user's decision plus the link to it.
    const data = mockPrisma.job.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      userId: "user-1",
      companyName: "Acme",
      title: "Frontend Engineer",
      url: SAVE_INPUT.url,
      source: "DISCOVERY",
      sourceProvider: "remotive",
      externalId: "1",
      // Re-derived server side, not taken from the client.
      canonicalUrl: "https://example.com/jobs/1",
    })
    expect(data.discoveredAt).toBeInstanceOf(Date)
    expect(data.postedAt?.toISOString()).toBe("2026-08-27T14:36:09.000Z")
    expect(mockPrisma.jobApplication.create.mock.calls[0][0].data).toMatchObject({
      userId: "user-1",
      status: "INTERESTED",
      jobId: "job-row-1",
    })
    expect(mockRevalidatePath).toHaveBeenCalledWith("/jobs")
  })

  it("accepts a candidate added by URL under the web provider", async () => {
    const result = await saveDiscoveredJob({
      ...SAVE_INPUT,
      provider: "web",
      externalId: "https://acme.com/careers/1",
      url: "https://acme.com/careers/1",
    })

    expect(result).toEqual({ success: true, id: "job-1", duplicate: false })
    expect(mockPrisma.job.create.mock.calls[0][0].data).toMatchObject({
      sourceProvider: "web",
      source: "DISCOVERY",
      canonicalUrl: "https://acme.com/careers/1",
    })
  })

  it("returns the existing job instead of creating a duplicate", async () => {
    mockPrisma.job.findFirst.mockResolvedValue({
      id: "job-row-existing",
      applications: [{ id: "job-existing" }],
    })

    const result = await saveDiscoveredJob(SAVE_INPUT)

    expect(result).toEqual({ success: true, id: "job-existing", duplicate: true })
    expect(mockPrisma.jobApplication.create).not.toHaveBeenCalled()
  })

  it("scopes the duplicate check to the caller and matches URL or provider id", async () => {
    await saveDiscoveredJob(SAVE_INPUT)

    expect(mockPrisma.job.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          { canonicalUrl: "https://example.com/jobs/1" },
          { url: SAVE_INPUT.url },
          { sourceProvider: "remotive", externalId: "1" },
        ],
      },
      select: {
        id: true,
        applications: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
      },
    })
  })

  it("stores the questions the posting already asks", async () => {
    await saveDiscoveredJob(SAVE_INPUT)

    expect(mockPrisma.interviewQuestion.createMany).toHaveBeenCalledWith({
      data: [
        {
          jobApplicationId: "job-1",
          question: "Why do you want to join Acme?",
          source: "SCRAPED",
        },
      ],
    })
  })

  it("still succeeds when the question insert fails", async () => {
    mockPrisma.interviewQuestion.createMany.mockRejectedValue(new Error("connection lost"))

    expect(await saveDiscoveredJob(SAVE_INPUT)).toEqual({
      success: true,
      id: "job-1",
      duplicate: false,
    })
  })

  it("creates the posting already carrying its qualification snapshot", async () => {
    await saveDiscoveredJob(SAVE_INPUT)

    // One statement, not a create followed by an update: a crash between the
    // two used to leave a permanently null snapshot.
    expect(mockPrisma.job.updateMany).not.toHaveBeenCalled()

    const snapshot = mockPrisma.job.create.mock.calls[0][0].data.qualification
    expect(snapshot).toMatchObject({
      verdict: expect.any(String),
      nextAction: expect.any(String),
      worthIt: { signal: expect.any(String), reasons: expect.any(Array) },
      eligible: { signal: expect.any(String), reasons: expect.any(Array) },
      match: { matched: ["React"], confirmedCount: 1 },
      risk: { signal: expect.any(String), reasons: [] },
    })
    expect(() => new Date(snapshot.checkedAt).toISOString()).not.toThrow()
  })

  it("never lets a failed snapshot cost the user the save", async () => {
    mockPrisma.careerProfile.findUnique.mockRejectedValue(new Error("connection lost"))

    expect(await saveDiscoveredJob(SAVE_INPUT)).toEqual({
      success: true,
      id: "job-1",
      duplicate: false,
    })
    // `Prisma.DbNull` is what the create writes when there is no snapshot.
    expect(mockPrisma.job.create.mock.calls[0][0].data.qualification).not.toHaveProperty(
      "verdict"
    )
  })

  it("does not overwrite the snapshot on a posting the user already had", async () => {
    mockPrisma.job.findFirst.mockResolvedValue({
      id: "job-row-existing",
      applications: [{ id: "job-existing" }],
    })

    await saveDiscoveredJob(SAVE_INPUT)

    expect(mockPrisma.job.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.job.create).not.toHaveBeenCalled()
  })

  it("skips the snapshot when the user has no career profile row", async () => {
    mockPrisma.careerProfile.findUnique.mockResolvedValue(null)

    expect(await saveDiscoveredJob(SAVE_INPUT)).toEqual({
      success: true,
      id: "job-1",
      duplicate: false,
    })
    expect(mockPrisma.job.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.job.create.mock.calls[0][0].data.qualification).not.toHaveProperty(
      "verdict"
    )
  })

  it("keeps a free-text salary in the notes, since the column is numeric", async () => {
    await saveDiscoveredJob({ ...SAVE_INPUT, salaryText: "$80k - $100k" })

    expect(mockPrisma.jobApplication.create.mock.calls[0][0].data.notes).toBe(
      "Salary (as posted): $80k - $100k"
    )
  })

  it("reports a failed write instead of throwing", async () => {
    mockPrisma.jobApplication.create.mockRejectedValue(new Error("connection lost"))

    expect(await saveDiscoveredJob(SAVE_INPUT)).toEqual({
      error: "Something went wrong. Please try again.",
    })
  })
})

describe("probeCompanyBoards", () => {
  it("refuses without a session and probes nothing", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await probeCompanyBoards("GitLab")).toEqual({ error: "Unauthorized" })
    expect(mockProbeBoards).not.toHaveBeenCalled()
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
  })

  it("refuses an empty name before spending the limit", async () => {
    expect(await probeCompanyBoards("   ")).toEqual({ error: "Enter a company name" })
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
    expect(mockProbeBoards).not.toHaveBeenCalled()
  })

  it("refuses when its own limit is spent, on its own bucket", async () => {
    mockConsumeRateLimit.mockResolvedValue(false)

    expect(await probeCompanyBoards("GitLab")).toEqual({
      error: "Too many attempts. Please try again later.",
    })
    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      "discovery:probe-boards",
      "user-1",
      expect.objectContaining({ max: expect.any(Number) })
    )
    expect(mockProbeBoards).not.toHaveBeenCalled()
  })

  it("probes the slugs derived from the name and returns both", async () => {
    mockProbeBoards.mockResolvedValue([
      { provider: "greenhouse", slug: "gitlab", postingCount: 619 },
    ])

    const result = await probeCompanyBoards("GitLab")

    expect(mockProbeBoards).toHaveBeenCalledWith(["gitlab"], expect.anything())
    expect(result).toEqual({
      slugs: ["gitlab"],
      hits: [{ provider: "greenhouse", slug: "gitlab", postingCount: 619 }],
    })
  })

  it("returns an honest empty result rather than an error when nothing answers", async () => {
    expect(await probeCompanyBoards("Acme Corp")).toEqual({
      slugs: ["acmecorp", "acme-corp", "acme"],
      hits: [],
    })
  })

  it("makes no request for a name no slug can be derived from", async () => {
    expect(await probeCompanyBoards("!!!")).toEqual({ slugs: [], hits: [] })
    expect(mockProbeBoards).not.toHaveBeenCalled()
  })

  it("writes nothing", async () => {
    await probeCompanyBoards("GitLab")

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.job.create).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})
