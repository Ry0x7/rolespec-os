import { describe, expect, it } from "vitest"
import { adapterFor, isSupportedOriginPattern, siteFor, type BadgeSite } from "./badge-sites"
import jobstreetList from "./__fixtures__/badge-jobstreet-list.html?raw"
import jobstreetDetail from "./__fixtures__/badge-jobstreet-detail.html?raw"
import indeedList from "./__fixtures__/badge-indeed-list.html?raw"
import indeedDetail from "./__fixtures__/badge-indeed-detail.html?raw"
import linkedinList from "./__fixtures__/badge-linkedin-list.html?raw"
import linkedinDetail from "./__fixtures__/badge-linkedin-detail.html?raw"

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html")
}

describe("siteFor", () => {
  it.each([
    ["https://ph.jobstreet.com/nurse-jobs", "jobstreet"],
    ["https://www.jobstreet.com.my/job/123", "jobstreet"],
    ["https://jobstreet.com/", "jobstreet"],
    ["https://www.seek.com.au/job/123", "jobstreet"],
    ["https://www.seek.co.nz/jobs", "jobstreet"],
    ["https://ph.indeed.com/jobs?q=nurse", "indeed"],
    ["https://www.indeed.com/viewjob?jk=abc", "indeed"],
    ["https://indeed.com/", "indeed"],
    ["https://www.indeed.com.ph/", "indeed"],
    ["https://uk.indeed.com/", "indeed"],
    ["https://www.indeed.co.uk/", "indeed"],
    ["https://de.indeed.com/", "indeed"],
    ["https://www.linkedin.com/jobs/search?keywords=nurse", "linkedin"],
    ["https://ph.linkedin.com/jobs/search?keywords=nurse", "linkedin"],
    ["https://uk.linkedin.com/jobs/view/123", "linkedin"],
  ] as const)("%s → %s", (url, site) => {
    expect(siteFor(url)).toBe(site)
  })

  it.each([
    "https://example.com/jobs",
    "https://notjobstreet.com/",
    "https://jobstreet.com.evil.example/",
    "https://indeed.example.com/",
    "https://linkedin.com.evil.example/",
    "https://evil-linkedin.com/",
    "chrome://extensions",
    "file:///C:/jobs.html",
    "not a url",
    "",
    null,
  ])("%s → null", (url) => {
    expect(siteFor(url)).toBeNull()
  })
})

describe("isSupportedOriginPattern", () => {
  it("accepts single-origin grants on supported boards", () => {
    expect(isSupportedOriginPattern("https://ph.jobstreet.com/*")).toBe(true)
    expect(isSupportedOriginPattern("https://ph.indeed.com/*")).toBe(true)
    expect(isSupportedOriginPattern("https://www.linkedin.com/*")).toBe(true)
    expect(isSupportedOriginPattern("https://ph.linkedin.com/*")).toBe(true)
    expect(isSupportedOriginPattern("https://uk.linkedin.com/*")).toBe(true)
  })

  it("refuses wildcards, other sites and malformed patterns", () => {
    expect(isSupportedOriginPattern("https://*/*")).toBe(false)
    expect(isSupportedOriginPattern("http://*/*")).toBe(false)
    expect(isSupportedOriginPattern("https://*.indeed.com/*")).toBe(false)
    expect(isSupportedOriginPattern("https://*.linkedin.com/*")).toBe(false)
    expect(isSupportedOriginPattern("https://evil-linkedin.com/*")).toBe(false)
    expect(isSupportedOriginPattern("<all_urls>")).toBe(false)
    expect(isSupportedOriginPattern("https://example.com/*")).toBe(false)
    expect(isSupportedOriginPattern("https://ph.jobstreet.com/jobs/*")).toBe(false)
    expect(isSupportedOriginPattern("")).toBe(false)
  })
})

describe("detailKey", () => {
  it("builds canonical keys from detail URLs only", () => {
    expect(adapterFor("jobstreet").detailKey("https://ph.jobstreet.com/job/95217144?type=standard#sol=x")).toBe(
      "https://ph.jobstreet.com/job/95217144",
    )
    expect(adapterFor("jobstreet").detailKey("https://ph.jobstreet.com/nurse-jobs?jobId=95217144")).toBeNull()
    expect(adapterFor("indeed").detailKey("https://ph.indeed.com/viewjob?jk=9fb44fe333d0ba22&from=serp")).toBe(
      "https://ph.indeed.com/viewjob?jk=9fb44fe333d0ba22",
    )
    expect(adapterFor("indeed").detailKey("https://ph.indeed.com/jobs?q=nurse&vjk=9fb44fe333d0ba22")).toBeNull()
    expect(
      adapterFor("linkedin").detailKey("https://www.linkedin.com/jobs/view/nurse-at-the-medical-city-4469127735?trk=x"),
    ).toBe("https://www.linkedin.com/jobs/view/4469127735")
    expect(adapterFor("linkedin").detailKey("https://www.linkedin.com/jobs/view/4469127735/")).toBe(
      "https://www.linkedin.com/jobs/view/4469127735",
    )
    expect(adapterFor("linkedin").detailKey("https://www.linkedin.com/jobs/search/?currentJobId=4469127735")).toBeNull()
  })
})

const cases: Array<{
  site: BadgeSite
  list: string
  detail: string
  pageUrl: string
  count: number
  first: { key: string; title: string; companyName: string; location: string }
  detailTitle: string
}> = [
  {
    site: "jobstreet",
    list: jobstreetList,
    detail: jobstreetDetail,
    pageUrl: "https://ph.jobstreet.com/nurse-jobs",
    count: 20,
    first: {
      key: "https://ph.jobstreet.com/job/95217144",
      title: "Virtual Assistant - Intake Coordinator (Registered Nurse)",
      companyName: "Reproductive Sciences Management Company",
      location: "Cebu, Central Visayas",
    },
    detailTitle: "Virtual Assistant - Intake Coordinator (Registered Nurse)",
  },
  {
    site: "indeed",
    list: indeedList,
    detail: indeedDetail,
    pageUrl: "https://ph.indeed.com/jobs?q=nurse",
    count: 16,
    first: {
      key: "https://ph.indeed.com/viewjob?jk=9fb44fe333d0ba22",
      title: "Company Nurse",
      companyName: "Aprio",
      location: "Hybrid work in Clark Freeport Zone",
    },
    detailTitle: "Company Nurse",
  },
  {
    site: "linkedin",
    list: linkedinList,
    detail: linkedinDetail,
    pageUrl: "https://www.linkedin.com/jobs/search?keywords=nurse",
    count: 20,
    first: {
      key: "https://www.linkedin.com/jobs/view/4469127735",
      title: "Nurse",
      companyName: "The Medical City",
      location: "Muntinlupa City",
    },
    detailTitle: "Nurse",
  },
]

describe.each(cases)("$site adapter (captured markup)", ({ site, list, detail, pageUrl, count, first, detailTitle }) => {
  const adapter = adapterFor(site)

  it("finds every card with a unique, stable key and a title", () => {
    const cards = adapter.listCards(parse(list), pageUrl)
    expect(cards).toHaveLength(count)
    expect(new Set(cards.map((card) => card.key)).size).toBe(count)
    for (const card of cards) {
      expect(card.title.length).toBeGreaterThan(0)
      expect(card.card.contains(card.mount)).toBe(true)
    }
    const { key, title, companyName, location } = cards[0]
    expect({ key, title, companyName, location }).toEqual(first)
  })

  it("yields the same keys from a fresh parse (re-render)", () => {
    const a = adapter.listCards(parse(list), pageUrl).map((card) => card.key)
    const b = adapter.listCards(parse(list), pageUrl).map((card) => card.key)
    expect(b).toEqual(a)
  })

  it("finds the detail title anchor", () => {
    const anchor = adapter.detailTitleAnchor(parse(detail))
    expect(anchor?.textContent?.trim()).toBe(detailTitle)
  })
})

describe("LinkedIn country hosts (ph.linkedin.com, where the fixtures were captured)", () => {
  const adapter = adapterFor("linkedin")

  it("reads the list with ph.linkedin.com keys collapsing to the canonical www key", () => {
    const fromPh = adapter.listCards(parse(linkedinList), "https://ph.linkedin.com/jobs/search?keywords=nurse")
    const fromWww = adapter.listCards(parse(linkedinList), "https://www.linkedin.com/jobs/search?keywords=nurse")
    expect(fromPh).toHaveLength(20)
    expect(fromPh[0].key).toBe("https://www.linkedin.com/jobs/view/4469127735")
    expect(fromPh.map((card) => card.key)).toEqual(fromWww.map((card) => card.key))
  })

  it("treats a ph.linkedin.com job page as a detail page with the same key", () => {
    expect(siteFor("https://ph.linkedin.com/jobs/view/nurse-at-the-medical-city-4469127735")).toBe("linkedin")
    expect(adapter.detailKey("https://ph.linkedin.com/jobs/view/nurse-at-the-medical-city-4469127735")).toBe(
      "https://www.linkedin.com/jobs/view/4469127735",
    )
    expect(adapter.detailTitleAnchor(parse(linkedinDetail))?.textContent?.trim()).toBe("Nurse")
  })
})
