import { describe, it, expect } from "vitest"

import {
  MAX_BOARD_KEYWORDS,
  buildBoardSearchLinks,
  type BoardSearchInput,
  type BoardSearchLink,
} from "../board-search-links.service"

function input(overrides: Partial<BoardSearchInput> = {}): BoardSearchInput {
  return {
    role: "Software Engineer",
    keywords: [],
    locations: ["Philippines"],
    workModes: [],
    experienceLevel: null,
    ...overrides,
  }
}

function link(links: BoardSearchLink[], board: BoardSearchLink["board"]): BoardSearchLink {
  const found = links.find((l) => l.board === board)
  if (!found) throw new Error(`no ${board} link`)
  return found
}

function params(url: string): URLSearchParams {
  return new URL(url).searchParams
}

describe("buildBoardSearchLinks", () => {
  it("returns nothing for a blank role", () => {
    expect(buildBoardSearchLinks(input({ role: "" }))).toEqual([])
    expect(buildBoardSearchLinks(input({ role: "   " }))).toEqual([])
  })

  it("builds LinkedIn, Indeed and JobStreet links for a Philippines profile", () => {
    const links = buildBoardSearchLinks(
      input({ keywords: ["React", "Node.js", "TypeScript"], workModes: ["HYBRID"], experienceLevel: "MID" })
    )
    const expectedQuery = '"Software Engineer" AND (React OR "Node.js" OR TypeScript)'

    expect(links.map((l) => l.board)).toEqual(["LINKEDIN", "INDEED", "JOBSTREET"])

    const linkedIn = link(links, "LINKEDIN")
    expect(linkedIn.label).toBe("LinkedIn")
    expect(linkedIn.query).toBe(expectedQuery)
    expect(linkedIn.location).toBe("Philippines")
    expect(new URL(linkedIn.url).origin + new URL(linkedIn.url).pathname).toBe("https://www.linkedin.com/jobs/search/")
    expect(params(linkedIn.url).get("keywords")).toBe(expectedQuery)
    expect(params(linkedIn.url).get("location")).toBe("Philippines")
    expect(params(linkedIn.url).get("f_WT")).toBe("3")
    expect(params(linkedIn.url).get("f_E")).toBe("4")
    expect(params(linkedIn.url).has("geoId")).toBe(false)
    // Encoded by URLSearchParams, not hand-escaped.
    expect(linkedIn.url).toContain("keywords=%22Software+Engineer%22+AND+%28React+OR+%22Node.js%22+OR+TypeScript%29")

    const indeed = link(links, "INDEED")
    expect(indeed.label).toBe("Indeed (PH)")
    expect(new URL(indeed.url).host).toBe("ph.indeed.com")
    expect(new URL(indeed.url).pathname).toBe("/jobs")
    expect(params(indeed.url).get("q")).toBe(expectedQuery)
    expect(params(indeed.url).get("l")).toBe("Philippines")
    expect(params(indeed.url).get("explvl")).toBe("mid_level")
    expect(indeed.location).toBe("Philippines")

    const jobStreet = link(links, "JOBSTREET")
    expect(jobStreet.label).toBe("JobStreet (PH)")
    expect(jobStreet.query).toBe("Software Engineer")
    expect(jobStreet.location).toBeNull()
    expect(jobStreet.url).toBe("https://ph.jobstreet.com/jobs?keywords=Software+Engineer")
  })

  it("uses the role alone when there are no keywords, unquoted when it is one word", () => {
    expect(link(buildBoardSearchLinks(input()), "LINKEDIN").query).toBe('"Software Engineer"')
    expect(link(buildBoardSearchLinks(input({ role: "Nurse" })), "INDEED").query).toBe("Nurse")
  })

  it("omits JobStreet and uses www.indeed.com outside its countries", () => {
    const links = buildBoardSearchLinks(input({ locations: ["United States"] }))

    expect(links.map((l) => l.board)).toEqual(["LINKEDIN", "INDEED"])
    const indeed = link(links, "INDEED")
    expect(indeed.label).toBe("Indeed")
    expect(new URL(indeed.url).host).toBe("www.indeed.com")
    expect(params(indeed.url).get("l")).toBe("United States")
  })

  it("maps each supported country to its Indeed and JobStreet hosts", () => {
    const cases: Array<[string, string, string | null]> = [
      ["Singapore", "sg.indeed.com", "sg.jobstreet.com"],
      ["Malaysia", "malaysia.indeed.com", "my.jobstreet.com"],
      ["Indonesia", "id.indeed.com", "id.jobstreet.com"],
      ["Australia", "au.indeed.com", null],
      ["United Kingdom", "uk.indeed.com", null],
      ["Canada", "ca.indeed.com", null],
      ["India", "in.indeed.com", null],
      ["Germany", "de.indeed.com", null],
    ]
    for (const [country, indeedHost, jobStreetHost] of cases) {
      const links = buildBoardSearchLinks(input({ locations: [country] }))
      expect(new URL(link(links, "INDEED").url).host).toBe(indeedHost)
      const jobStreet = links.find((l) => l.board === "JOBSTREET")
      expect(jobStreet ? new URL(jobStreet.url).host : null).toBe(jobStreetHost)
    }
  })

  it("searches Worldwide on LinkedIn and Remote on Indeed for a remote-anywhere profile", () => {
    const links = buildBoardSearchLinks(input({ locations: ["Remote (anywhere)"] }))

    const linkedIn = link(links, "LINKEDIN")
    expect(linkedIn.location).toBe("Worldwide")
    expect(params(linkedIn.url).get("location")).toBe("Worldwide")
    expect(params(linkedIn.url).get("geoId")).toBe("92000000")

    const indeed = link(links, "INDEED")
    expect(new URL(indeed.url).host).toBe("www.indeed.com")
    expect(params(indeed.url).get("l")).toBe("Remote")
    expect(indeed.location).toBe("Remote")

    expect(links.some((l) => l.board === "JOBSTREET")).toBe(false)
  })

  it("keeps the country on LinkedIn for a REMOTE-only work mode when a country is set", () => {
    const links = buildBoardSearchLinks(input({ locations: ["remote (ANYWHERE) ", "Philippines"], workModes: ["REMOTE"] }))

    const linkedIn = link(links, "LINKEDIN")
    expect(linkedIn.location).toBe("Philippines")
    expect(params(linkedIn.url).get("location")).toBe("Philippines")
    expect(params(linkedIn.url).has("geoId")).toBe(false)
    expect(params(linkedIn.url).get("f_WT")).toBe("2")

    const indeed = link(links, "INDEED")
    expect(new URL(indeed.url).host).toBe("ph.indeed.com")
    expect(params(indeed.url).get("l")).toBe("Philippines")
    expect(link(links, "JOBSTREET").url).toBe("https://ph.jobstreet.com/jobs?keywords=Software+Engineer")
  })

  it("sends the country plus f_WT=2 for a REMOTE-only work mode with a Philippines location", () => {
    const links = buildBoardSearchLinks(input({ locations: ["Philippines"], workModes: ["REMOTE"] }))

    const linkedIn = params(link(links, "LINKEDIN").url)
    expect(linkedIn.get("location")).toBe("Philippines")
    expect(linkedIn.get("f_WT")).toBe("2")
    expect(linkedIn.has("geoId")).toBe(false)

    expect(params(link(links, "INDEED").url).get("l")).toBe("Philippines")
  })

  it("searches Worldwide for a REMOTE-only work mode when no location is set", () => {
    const links = buildBoardSearchLinks(input({ locations: [], workModes: ["REMOTE"] }))

    const linkedIn = params(link(links, "LINKEDIN").url)
    expect(linkedIn.get("location")).toBe("Worldwide")
    expect(linkedIn.get("geoId")).toBe("92000000")
    expect(linkedIn.get("f_WT")).toBe("2")
    expect(params(link(links, "INDEED").url).get("l")).toBe("Remote")
  })

  it("comma-joins LinkedIn work-type codes and omits f_WT when there are no work modes", () => {
    const all = buildBoardSearchLinks(input({ workModes: ["REMOTE", "HYBRID", "ONSITE"] }))
    expect(params(link(all, "LINKEDIN").url).get("f_WT")).toBe("1,2,3")
    expect(params(link(all, "LINKEDIN").url).get("location")).toBe("Philippines")

    const none = buildBoardSearchLinks(input())
    expect(params(link(none, "LINKEDIN").url).has("f_WT")).toBe(false)
  })

  it("maps experience level to LinkedIn f_E and Indeed explvl, omitting both when null", () => {
    const cases: Array<[BoardSearchInput["experienceLevel"], string, string]> = [
      ["JUNIOR", "2,3", "entry_level"],
      ["MID", "4", "mid_level"],
      ["SENIOR", "4", "senior_level"],
      ["LEAD", "5", "senior_level"],
      ["EXECUTIVE", "6", "senior_level"],
    ]
    for (const [level, fE, explvl] of cases) {
      const links = buildBoardSearchLinks(input({ experienceLevel: level }))
      expect(params(link(links, "LINKEDIN").url).get("f_E")).toBe(fE)
      expect(params(link(links, "INDEED").url).get("explvl")).toBe(explvl)
    }

    const none = buildBoardSearchLinks(input())
    expect(params(link(none, "LINKEDIN").url).has("f_E")).toBe(false)
    expect(params(link(none, "INDEED").url).has("explvl")).toBe(false)
  })

  it("caps keywords at four", () => {
    expect(MAX_BOARD_KEYWORDS).toBe(4)
    const links = buildBoardSearchLinks(input({ role: "Engineer", keywords: ["A1", "B2", "C3", "D4", "E5", "F6"] }))
    expect(link(links, "LINKEDIN").query).toBe("Engineer AND (A1 OR B2 OR C3 OR D4)")
    expect(link(links, "INDEED").query).toBe("Engineer AND (A1 OR B2 OR C3 OR D4)")
  })

  it("dedupes keywords case-insensitively and drops one equal to the role title", () => {
    const links = buildBoardSearchLinks(
      input({ role: "Data  Analyst", keywords: ["SQL", "sql", "data analyst", " Excel ", "EXCEL", "Python", "Tableau", "R"] })
    )
    expect(link(links, "LINKEDIN").query).toBe('"Data Analyst" AND (SQL OR Excel OR Python OR Tableau)')
    expect(link(links, "INDEED").query).toBe('"Data Analyst" AND (SQL OR Excel OR Python OR Tableau)')
  })

  it("quotes multi-word terms and keeps JobStreet free of quotes and boolean syntax", () => {
    const links = buildBoardSearchLinks(
      input({ role: "Data Analyst", keywords: ["Machine Learning", "SQL", "Power BI"] })
    )
    const expected = '"Data Analyst" AND ("Machine Learning" OR SQL OR "Power BI")'
    expect(link(links, "LINKEDIN").query).toBe(expected)
    expect(link(links, "INDEED").query).toBe(expected)

    const jobStreet = link(links, "JOBSTREET")
    expect(jobStreet.query).toBe("Data Analyst")
    expect(params(jobStreet.url).get("keywords")).toBe("Data Analyst")
  })

  it("sends a free-text legacy location as-is, with Indeed on www and no JobStreet", () => {
    const links = buildBoardSearchLinks(input({ locations: ["Makati City"] }))

    expect(links.map((l) => l.board)).toEqual(["LINKEDIN", "INDEED"])
    const linkedIn = link(links, "LINKEDIN")
    expect(linkedIn.location).toBe("Makati City")
    expect(params(linkedIn.url).get("location")).toBe("Makati City")

    const indeed = link(links, "INDEED")
    expect(new URL(indeed.url).host).toBe("www.indeed.com")
    expect(params(indeed.url).get("l")).toBe("Makati City")
    expect(indeed.location).toBe("Makati City")
  })

  it("sends no location when the profile has none", () => {
    const links = buildBoardSearchLinks(input({ locations: [] }))
    expect(link(links, "LINKEDIN").location).toBeNull()
    expect(params(link(links, "LINKEDIN").url).has("location")).toBe(false)
    expect(params(link(links, "INDEED").url).has("l")).toBe(false)
  })

  it("returns only absolute https URLs", () => {
    const links = buildBoardSearchLinks(input({ keywords: ["React"], workModes: ["ONSITE"], experienceLevel: "LEAD" }))
    for (const l of links) expect(new URL(l.url).protocol).toBe("https:")
  })
})
