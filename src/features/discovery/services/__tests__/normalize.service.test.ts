import { describe, it, expect } from "vitest"

import type { RawPosting } from "../../types"
import {
  MAX_DESCRIPTION_LENGTH,
  canonicalizeUrl,
  dedupePostings,
  normalizeAndDedupe,
  normalizePosting,
  parseWorkType,
  stripHtml,
} from "../normalize.service"

function raw(overrides: Partial<RawPosting> = {}): RawPosting {
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

describe("canonicalizeUrl", () => {
  it("lowercases the host, drops www, the fragment and the trailing slash", () => {
    expect(canonicalizeUrl("https://WWW.Example.COM/Jobs/1/#apply")).toBe(
      "https://example.com/Jobs/1"
    )
  })

  it("strips utm_* params but keeps the rest, sorted", () => {
    expect(
      canonicalizeUrl("https://example.com/jobs?utm_source=x&b=2&utm_medium=y&a=1")
    ).toBe("https://example.com/jobs?a=1&b=2")
  })

  it("adds a missing protocol, matching normalizeUrl", () => {
    expect(canonicalizeUrl("example.com/jobs/1")).toBe("https://example.com/jobs/1")
  })

  it("returns an empty string for empty or unparseable input", () => {
    expect(canonicalizeUrl("")).toBe("")
    expect(canonicalizeUrl(null)).toBe("")
    expect(canonicalizeUrl("   ")).toBe("")
    expect(canonicalizeUrl("https://")).toBe("")
  })

  it("strips ad-network click ids on any host", () => {
    expect(
      canonicalizeUrl("https://example.com/jobs/1?gclid=x&fbclid=y&trk=z&_ga=1&a=1")
    ).toBe("https://example.com/jobs/1?a=1")
  })

  it("keeps board-shaped params on a host it has no rule for", () => {
    // `ref` selects the posting on some boards, so guessing merges real jobs.
    expect(canonicalizeUrl("https://unknown-board.example/jobs?ref=x")).toBe(
      "https://unknown-board.example/jobs?ref=x"
    )
    expect(
      canonicalizeUrl("https://unknown-board.example/jobs?origin=a&src=b&from=c")
    ).toBe("https://unknown-board.example/jobs?from=c&origin=a&src=b")
  })

  it("collapses every JobStreet spelling of one posting onto a single key", () => {
    // The three links the duplicate slipped through on: from a card, from a
    // title, and typed by hand.
    const fromCard =
      "https://ph.jobstreet.com/job/94508928?type=standard&ref=search-standalone&origin=jobCard#sol=2bae400ae3f48ed523b4b4ea87c0b106753b0074"
    const fromTitle =
      "https://ph.jobstreet.com/job/94508928?ref=search-standalone&type=standard&origin=jobTitle#sol=54744f25a8763d211cfa05feb5a44510b2f98544"
    const typed = "https://ph.jobstreet.com/job/94508928"

    expect(canonicalizeUrl(fromCard)).toBe("https://ph.jobstreet.com/job/94508928")
    expect(canonicalizeUrl(fromTitle)).toBe("https://ph.jobstreet.com/job/94508928")
    expect(canonicalizeUrl(typed)).toBe("https://ph.jobstreet.com/job/94508928")
  })

  it("drops the whole query on the other boards that key postings by path", () => {
    expect(canonicalizeUrl("https://bossjob.ph/jobs/12345?utm_source=x&type=standard")).toBe(
      "https://bossjob.ph/jobs/12345"
    )
    expect(canonicalizeUrl("https://www.kalibrr.com/c/acme/jobs/999?source=feed")).toBe(
      "https://kalibrr.com/c/acme/jobs/999"
    )
    expect(canonicalizeUrl("https://jobs.lever.co/acme/abc-123?lever-origin=applied")).toBe(
      "https://jobs.lever.co/acme/abc-123"
    )
    expect(canonicalizeUrl("https://jobs.ashbyhq.com/acme/abc-123?utm_source=x")).toBe(
      "https://jobs.ashbyhq.com/acme/abc-123"
    )
    expect(
      canonicalizeUrl("https://www.linkedin.com/jobs/view/4123456789/?trk=flagship&refId=z")
    ).toBe("https://linkedin.com/jobs/view/4123456789")
    expect(canonicalizeUrl("https://job-boards.greenhouse.io/acme/jobs/8503792002?gh_src=x")).toBe(
      "https://job-boards.greenhouse.io/acme/jobs/8503792002"
    )
    expect(canonicalizeUrl("https://remotive.com/remote-jobs/dev/role-123?ref=feed")).toBe(
      "https://remotive.com/remote-jobs/dev/role-123"
    )
    expect(canonicalizeUrl("https://www.arbeitnow.com/jobs/companies/acme/role-123?source=x")).toBe(
      "https://arbeitnow.com/jobs/companies/acme/role-123"
    )
    expect(canonicalizeUrl("https://www.onlinejobs.ph/jobseekers/job/role-123?src=list")).toBe(
      "https://onlinejobs.ph/jobseekers/job/role-123"
    )
  })

  it("drops the whole query on the per-company-subdomain ATSs", () => {
    // BambooHR, Freshteam and Workday all carry the posting id in the path, so
    // every company subdomain of theirs is covered, not a fixed host list.
    expect(canonicalizeUrl("https://kumu.bamboohr.com/careers/336?utm_source=x")).toBe(
      "https://kumu.bamboohr.com/careers/336"
    )
    expect(
      canonicalizeUrl("https://thinkingmachines.freshteam.com/jobs/aa/ph-cloud-engineer?source=x")
    ).toBe("https://thinkingmachines.freshteam.com/jobs/aa/ph-cloud-engineer")
    expect(
      canonicalizeUrl(
        "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/Tower/AI-Engineer_R1?source=Careers_Site"
      )
    ).toBe("https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/Tower/AI-Engineer_R1")
  })

  it("does not apply those rules to a look-alike host", () => {
    expect(canonicalizeUrl("https://bamboohr.com.evil.example/careers/336?source=x")).toBe(
      "https://bamboohr.com.evil.example/careers/336?source=x"
    )
  })

  it("keeps only the id param on the boards that key postings by param", () => {
    // Indeed keys on `jk`; everything alongside it is decoration.
    expect(canonicalizeUrl("https://www.indeed.com/viewjob?jk=abc123&from=serp")).toBe(
      "https://indeed.com/viewjob?jk=abc123"
    )
    expect(canonicalizeUrl("https://ph.indeed.com/viewjob?jk=abc123&vjs=3")).toBe(
      "https://ph.indeed.com/viewjob?jk=abc123"
    )
  })

  it("folds a LinkedIn search URL onto the permalink of the job it names", () => {
    expect(
      canonicalizeUrl(
        "https://www.linkedin.com/jobs/search/?currentJobId=4123456789&origin=JOBS_HOME"
      )
    ).toBe("https://linkedin.com/jobs/view/4123456789")
    // The whole point: both ways of reaching one posting produce one key.
    expect(
      canonicalizeUrl("https://www.linkedin.com/jobs/search/?currentJobId=4123456789")
    ).toBe(canonicalizeUrl("https://www.linkedin.com/jobs/view/4123456789/?trk=flagship"))
    // `/jobs/search-results` is folded too — it is the same page, renamed.
    expect(
      canonicalizeUrl("https://linkedin.com/jobs/search-results/?currentJobId=4123456789")
    ).toBe("https://linkedin.com/jobs/view/4123456789")
  })

  it("leaves a LinkedIn search URL alone when it names no id we recognise", () => {
    // A non-numeric id is not a LinkedIn job id, and turning it into a
    // permalink would merge postings that are not the same.
    expect(canonicalizeUrl("https://www.linkedin.com/jobs/search/?currentJobId=abc")).toBe(
      "https://linkedin.com/jobs/search?currentJobId=abc"
    )
    expect(canonicalizeUrl("https://www.linkedin.com/jobs/search/?keywords=react")).toBe(
      "https://linkedin.com/jobs/search"
    )
  })

  it("keeps gh_jid on an embedded careers page, which has no host rule", () => {
    expect(
      canonicalizeUrl("https://boards.acme.com/careers?gh_jid=7788&utm_source=x")
    ).toBe("https://boards.acme.com/careers?gh_jid=7788")
  })

  it("keeps `type` off the generic strip list", () => {
    expect(canonicalizeUrl("https://example.com/jobs?type=standard")).toBe(
      "https://example.com/jobs?type=standard"
    )
  })
})

describe("stripHtml", () => {
  it("removes tags and decodes the entities providers actually emit", () => {
    expect(stripHtml("<p>Build <strong>things</strong> with R&amp;D</p>")).toBe(
      "Build things with R&D"
    )
  })

  it("turns block ends into newlines instead of running words together", () => {
    expect(stripHtml("<li>One</li><li>Two</li>")).toBe("One\nTwo")
  })

  it("drops script and style bodies entirely", () => {
    expect(stripHtml("<script>alert(1)</script>Real text")).toBe("Real text")
  })
})

describe("parseWorkType", () => {
  it.each([
    ["remote", "REMOTE"],
    ["Hybrid — 2 days onsite", "HYBRID"],
    ["On-site", "ONSITE"],
  ])("maps %s", (hint, expected) => {
    expect(parseWorkType(hint)).toBe(expected)
  })

  it("leaves an unrecognised hint undefined rather than guessing", () => {
    expect(parseWorkType("flexible")).toBeUndefined()
    expect(parseWorkType(undefined)).toBeUndefined()
  })
})

describe("normalizePosting", () => {
  it("maps a posting and derives the canonical URL", () => {
    const result = normalizePosting(
      raw({
        url: "https://example.com/jobs/1?utm_campaign=z",
        location: "Worldwide",
        workTypeHint: "remote",
        salaryText: "$80k - $100k",
        description: "<p>Ship <em>React</em></p>",
        postedAt: "2026-08-27T14:36:09",
      })
    )

    expect(result).toMatchObject({
      provider: "remotive",
      externalId: "1",
      title: "Frontend Engineer",
      companyName: "Acme",
      url: "https://example.com/jobs/1?utm_campaign=z",
      canonicalUrl: "https://example.com/jobs/1",
      location: "Worldwide",
      workType: "REMOTE",
      salaryText: "$80k - $100k",
      description: "Ship React",
    })
    // A zone-less provider timestamp is read as UTC, not as local time.
    expect(result?.postedAt?.toISOString()).toBe("2026-08-27T14:36:09.000Z")
  })

  it("returns null when a required field is missing", () => {
    expect(normalizePosting(raw({ title: "  " }))).toBeNull()
    expect(normalizePosting(raw({ companyName: "" }))).toBeNull()
    expect(normalizePosting(raw({ url: "" }))).toBeNull()
  })

  it("truncates the description to the extension's cap", () => {
    const result = normalizePosting(raw({ description: "x".repeat(MAX_DESCRIPTION_LENGTH + 500) }))

    expect(result?.description).toHaveLength(MAX_DESCRIPTION_LENGTH)
  })

  it("leaves an unparseable posted date undefined", () => {
    expect(normalizePosting(raw({ postedAt: "not a date" }))?.postedAt).toBeUndefined()
  })
})

describe("dedupePostings", () => {
  it("collapses the same URL carrying different utm params", () => {
    const result = normalizeAndDedupe([
      raw({ externalId: "1", url: "https://example.com/jobs/1?utm_source=a" }),
      raw({ externalId: "2", url: "https://example.com/jobs/1?utm_source=b" }),
    ])

    expect(result).toHaveLength(1)
    // The first occurrence wins, link and all.
    expect(result[0].url).toBe("https://example.com/jobs/1?utm_source=a")
  })

  it("keeps distinct postings", () => {
    const result = normalizeAndDedupe([
      raw({ externalId: "1", url: "https://example.com/jobs/1" }),
      raw({ externalId: "2", url: "https://example.com/jobs/2" }),
    ])

    expect(result).toHaveLength(2)
  })

  it("falls back to provider+externalId when there is no canonical URL", () => {
    const withoutCanonical = [
      { ...normalizePosting(raw({ externalId: "1" }))!, canonicalUrl: "" },
      { ...normalizePosting(raw({ externalId: "1" }))!, canonicalUrl: "" },
      { ...normalizePosting(raw({ externalId: "2" }))!, canonicalUrl: "" },
    ]

    const result = dedupePostings(withoutCanonical)

    expect(result.map((posting) => posting.externalId)).toEqual(["1", "2"])
  })

  it("drops postings that cannot be normalized", () => {
    expect(normalizeAndDedupe([raw({ title: "" })])).toEqual([])
  })
})
