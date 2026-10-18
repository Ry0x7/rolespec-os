import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, it, expect } from "vitest"

import {
  detectListing,
  extractAllJobPostings,
  extractJobLinks,
  MAX_JOB_LINKS,
} from "../careers-listing.service"

/**
 * The three fixtures are trimmed captures of real careers index pages (fetched
 * 2026-09-14): every `<a>` open tag in document order, the real `<title>`, and
 * the anchor text. Nothing about the anchors was edited — the nav, language
 * switcher and footer links are there precisely because they are what a naive
 * extractor gets wrong.
 */
function fixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf8")
}

const FRESHTEAM_URL = "https://thinkingmachines.freshteam.com/jobs"
const MOZILLA_URL = "https://www.mozilla.org/en-US/careers/listings/"
const CANVA_URL = "https://www.lifeatcanva.com/en/jobs/"

describe("extractJobLinks", () => {
  it("reads every Freshteam posting and nothing else", () => {
    const links = extractJobLinks(fixture("careers-freshteam.html"), FRESHTEAM_URL)

    expect(links).toEqual([
      "https://thinkingmachines.freshteam.com/jobs/hlJrAwsfhoF2/ph-business-intelligence-analyst",
      "https://thinkingmachines.freshteam.com/jobs/OtHYoqd2eSo1/ph-lead-business-intelligence-analyst",
      "https://thinkingmachines.freshteam.com/jobs/TOUqBkA4k07O/ph-data-strategy-consultant",
      "https://thinkingmachines.freshteam.com/jobs/feW9IyawTFI7/ph-cloud-engineer",
      "https://thinkingmachines.freshteam.com/jobs/qHDogHkvICQ_/ph-genai-engineer",
    ])
  })

  it("reads Mozilla's 21 positions out of 86 anchors, in page order", () => {
    const links = extractJobLinks(fixture("careers-mozilla.html"), MOZILLA_URL)

    expect(links).toHaveLength(21)
    expect(links[0]).toBe("https://mozilla.org/en-US/careers/position/gh/7137777")
    expect(links.at(-1)).toBe("https://mozilla.org/en-US/careers/position/gh/8180983")
    expect(links.every((link) => /\/careers\/position\/gh\/\d+$/.test(link))).toBe(true)
  })

  it("reads Canva's postings and drops the saved-jobs index that looks like one", () => {
    const links = extractJobLinks(fixture("careers-canva.html"), CANVA_URL)

    expect(links).toHaveLength(20)
    expect(links[0]).toBe(
      "https://lifeatcanva.com/en/jobs/6000000001400037/account-executive-canadian-market"
    )
    // `/en/jobs/saved-jobs/` has the posting-noun shape but no id-like token.
    expect(links.some((link) => link.includes("saved-jobs"))).toBe(false)
    expect(links.some((link) => link.includes("/xml/"))).toBe(false)
  })

  it("resolves relative hrefs, strips fragments and dedupes", () => {
    const html = `
      <a href="/careers/jobs/1234/engineer#apply">One</a>
      <a href='https://acme.test/careers/jobs/1234/engineer'>Same one</a>
      <a href="jobs/5678/designer">Two</a>
    `

    expect(extractJobLinks(html, "https://acme.test/careers/")).toEqual([
      "https://acme.test/careers/jobs/1234/engineer",
      "https://acme.test/careers/jobs/5678/designer",
    ])
  })

  it("drops non-fetchable schemes, the page itself, categories and pagination", () => {
    const html = `
      <a href="mailto:jobs@acme.test">Email</a>
      <a href="tel:+63000">Call</a>
      <a href="javascript:void(0)">Menu</a>
      <a href="#main">Skip</a>
      <a href="/careers/">This page</a>
      <a href="/careers/department/engineering">Engineering</a>
      <a href="/careers/jobs/1234/engineer?page=2">Page two</a>
      <a href="https://other-site.test/careers/jobs/9999/engineer">Someone else</a>
      <a href="/careers/jobs/1234/engineer">Real</a>
    `

    expect(extractJobLinks(html, "https://acme.test/careers/")).toEqual([
      "https://acme.test/careers/jobs/1234/engineer",
    ])
  })

  it("keeps ATS link-outs to another host", () => {
    const html = `
      <a href="https://kumu.bamboohr.com/careers/42">BambooHR role</a>
      <a href="https://jobs.lever.co/acme/6f1c2d3e-aaaa">Lever role</a>
      <a href="https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/Taguig/Engineer_R-1">Workday role</a>
      <a href="https://cdn.example.com/logo.png">Logo</a>
    `

    expect(extractJobLinks(html, "https://acme.test/careers/")).toEqual([
      "https://kumu.bamboohr.com/careers/42",
      "https://jobs.lever.co/acme/6f1c2d3e-aaaa",
      "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/Taguig/Engineer_R-1",
    ])
  })

  it("keeps an unbroken alphanumeric hash id and still drops a word slug", () => {
    const html = `
      <a href="/jobs/a7f3c9e1b2/">Hash id</a>
      <a href="/jobs/saved-jobs/">Saved jobs</a>
      <a href="/jobs/engineering/">Engineering</a>
      <a href="/jobs/senior-backend/">Word slug</a>
    `

    expect(extractJobLinks(html, "https://acme.test/careers/")).toEqual([
      "https://acme.test/jobs/a7f3c9e1b2",
    ])
  })

  it("caps the result", () => {
    const html = Array.from(
      { length: MAX_JOB_LINKS + 15 },
      (_, index) => `<a href="/careers/jobs/${1000 + index}/role">Role</a>`
    ).join("")

    expect(extractJobLinks(html, "https://acme.test/careers/")).toHaveLength(MAX_JOB_LINKS)
  })

  it("returns nothing for an unparseable base URL", () => {
    expect(extractJobLinks('<a href="/careers/jobs/1234/x">x</a>', "not a url")).toEqual([])
  })
})

describe("extractAllJobPostings", () => {
  const threeInAGraph = `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", "name": "Acme Careers" },
        { "@type": "JobPosting", "title": "Backend Engineer", "url": "https://acme.test/jobs/1" },
        { "@type": ["JobPosting"], "title": "Data Engineer", "url": "https://acme.test/jobs/2" },
        { "@type": "JobPosting", "title": "Designer", "url": "https://acme.test/jobs/3" }
      ]
    }
    </script>
  `

  it("returns every JobPosting in one @graph", () => {
    const found = extractAllJobPostings(threeInAGraph)

    expect(found.map((node) => node.title)).toEqual([
      "Backend Engineer",
      "Data Engineer",
      "Designer",
    ])
  })

  it("walks arrays across blocks and skips malformed JSON", () => {
    const html = `
      <script type="application/ld+json">{ not json </script>
      <script type="application/ld+json">
        [{ "@type": "JobPosting", "title": "One" }, { "@type": "Organization" }]
      </script>
      <script type="application/ld+json">{ "@type": "JobPosting", "title": "Two" }</script>
    `

    expect(extractAllJobPostings(html).map((node) => node.title)).toEqual(["One", "Two"])
  })

  it("finds nothing on a page with no JSON-LD", () => {
    expect(extractAllJobPostings(fixture("careers-mozilla.html"))).toEqual([])
  })
})

describe("detectListing", () => {
  it("calls each real careers index a listing", () => {
    expect(detectListing({ html: fixture("careers-freshteam.html"), url: FRESHTEAM_URL })).toEqual({
      kind: "listing",
      links: expect.arrayContaining([expect.stringContaining("/jobs/feW9IyawTFI7/")]),
      jsonLdPostings: 0,
    })
    expect(detectListing({ html: fixture("careers-mozilla.html"), url: MOZILLA_URL }).kind).toBe(
      "listing"
    )
    expect(detectListing({ html: fixture("careers-canva.html"), url: CANVA_URL }).kind).toBe(
      "listing"
    )
  })

  it("is a listing when two or more JobPosting nodes are present", () => {
    const html = `
      <script type="application/ld+json">
        [{ "@type": "JobPosting", "title": "One" }, { "@type": "JobPosting", "title": "Two" }]
      </script>
    `

    expect(detectListing({ html, url: "https://acme.test/careers/" })).toEqual({
      kind: "listing",
      links: [],
      jsonLdPostings: 2,
    })
  })

  it("is single when exactly one JobPosting is present, however many links there are", () => {
    const html = `
      <script type="application/ld+json">{ "@type": "JobPosting", "title": "One" }</script>
      <a href="/careers/jobs/1/a">a</a>
      <a href="/careers/jobs/2/b">b</a>
      <a href="/careers/jobs/3/c">c</a>
      <a href="/careers/jobs/4/d">d</a>
    `

    expect(detectListing({ html, url: "https://acme.test/careers/engineer" })).toEqual({
      kind: "single",
    })
  })

  it("is single when there is no structured data and fewer than three links", () => {
    const html = `
      <a href="/careers/jobs/1/a">a</a>
      <a href="/careers/jobs/2/b">b</a>
    `

    expect(detectListing({ html, url: "https://acme.test/careers/" })).toEqual({ kind: "single" })
  })
})
