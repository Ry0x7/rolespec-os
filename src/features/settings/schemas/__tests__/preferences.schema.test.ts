import { describe, it, expect } from "vitest"
import { DEFAULT_ATS_COMPANY_WATCHLIST } from "@/config/discovery"
import {
  DEFAULT_PREFERENCES,
  MAX_ATS_SLUGS,
  atsWatchlistSchema,
  parsePreferences,
} from "../preferences.schema"

describe("parsePreferences", () => {
  it("defaults preferredCurrency to PHP on rows saved before the field existed", () => {
    expect(
      parsePreferences({ defaultAiInstructions: "be brief", emailNotifications: false })
    ).toEqual({
      defaultAiInstructions: "be brief",
      emailNotifications: false,
      preferredCurrency: "PHP",
      atsWatchlist: DEFAULT_ATS_COMPANY_WATCHLIST,
    })
  })

  it("keeps a stored preferredCurrency", () => {
    expect(parsePreferences({ preferredCurrency: "USD" }).preferredCurrency).toBe("USD")
  })

  it("falls back to every default for a null or malformed column", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences("nonsense")).toEqual(DEFAULT_PREFERENCES)
  })

  it("drops an unknown currency back to the default", () => {
    expect(parsePreferences({ preferredCurrency: "EUR" })).toEqual(DEFAULT_PREFERENCES)
  })

  it("defaults the ATS watchlist on rows saved before the field existed", () => {
    expect(parsePreferences({ preferredCurrency: "USD" }).atsWatchlist).toEqual(
      DEFAULT_ATS_COMPANY_WATCHLIST
    )
  })

  it("keeps a stored ATS watchlist", () => {
    expect(
      parsePreferences({
        atsWatchlist: { greenhouse: ["figma"], lever: [], ashby: ["linear"] },
      }).atsWatchlist
    ).toEqual({ greenhouse: ["figma"], lever: [], ashby: ["linear"], bamboohr: [], freshteam: [], workday: [] })
  })

  it("keeps a stored empty watchlist rather than restoring the defaults", () => {
    expect(
      parsePreferences({ atsWatchlist: { greenhouse: [], lever: [], ashby: [] } }).atsWatchlist
    ).toEqual({ greenhouse: [], lever: [], ashby: [], bamboohr: [], freshteam: [], workday: [] })
  })

  it("parses a watchlist stored before Ashby existed, without restoring the defaults", () => {
    const watchlist = parsePreferences({
      atsWatchlist: { greenhouse: ["figma"], lever: ["spotify"] },
    }).atsWatchlist

    expect(watchlist).toEqual({
      greenhouse: ["figma"],
      lever: ["spotify"],
      ashby: [],
      bamboohr: [], freshteam: [], workday: [],
    })
  })

  it("gives a watchlist stored before BambooHR/Freshteam/Workday empty sections, not the defaults", () => {
    const watchlist = parsePreferences({
      atsWatchlist: { greenhouse: ["figma"], lever: [], ashby: ["linear"] },
    }).atsWatchlist

    expect(watchlist.bamboohr).toEqual([])
    expect(watchlist.freshteam).toEqual([])
    expect(watchlist.workday).toEqual([])
    // The defaults ship with these, so an existing user must not inherit them.
    expect(DEFAULT_ATS_COMPANY_WATCHLIST.bamboohr).toEqual(["kumu"])
    expect(DEFAULT_ATS_COMPANY_WATCHLIST.freshteam).toEqual(["thinkingmachines"])
  })

  it("falls back to every default when the stored watchlist is malformed", () => {
    expect(parsePreferences({ atsWatchlist: { greenhouse: "figma" } })).toEqual(
      DEFAULT_PREFERENCES
    )
  })

  it("hands out a fresh watchlist each call, so a caller cannot edit the default", () => {
    const first = parsePreferences(null)
    first.atsWatchlist.greenhouse.push("intruder")

    expect(parsePreferences(null).atsWatchlist.greenhouse).not.toContain("intruder")
    expect(DEFAULT_ATS_COMPANY_WATCHLIST.greenhouse).not.toContain("intruder")
  })
})

describe("atsWatchlistSchema", () => {
  it("trims and lowercases each slug", () => {
    expect(
      atsWatchlistSchema.parse({ greenhouse: ["  GitLab "], lever: ["Spotify"], ashby: ["Linear"] })
    ).toEqual({
      greenhouse: ["gitlab"],
      lever: ["spotify"],
      ashby: ["linear"],
      bamboohr: [], freshteam: [], workday: [],
    })
  })

  it("normalizes a Workday board URL to its canonical board form", () => {
    expect(
      atsWatchlistSchema.parse({
        greenhouse: [],
        lever: [],
        workday: [
          "https://globe.wd3.myworkdayjobs.com/en-US/GLB_Careers/job/26F-The-Globe-Tower/AI-Engineer_R0000021435",
          "https://globe.wd3.myworkdayjobs.com/GLB_Careers",
        ],
      }).workday
    ).toEqual(["https://globe.wd3.myworkdayjobs.com/GLB_Careers"])
  })

  it("rejects a Workday entry that is not a myworkdayjobs board URL", () => {
    const result = atsWatchlistSchema.safeParse({
      greenhouse: [],
      lever: [],
      workday: ["https://example.com/careers"],
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain("myworkdayjobs.com")
  })

  it("rejects a slug in the Workday section", () => {
    expect(
      atsWatchlistSchema.safeParse({ greenhouse: [], lever: [], workday: ["globe"] }).success
    ).toBe(false)
  })

  it("dedupes slugs that only differ by case or padding", () => {
    expect(
      atsWatchlistSchema.parse({ greenhouse: ["gitlab", "GITLAB", " gitlab "], lever: [] })
        .greenhouse
    ).toEqual(["gitlab"])
  })

  it("rejects a slug with characters a URL path segment cannot hold", () => {
    for (const slug of ["git lab", "gitlab/jobs", "-gitlab", "git.lab", ""]) {
      expect(atsWatchlistSchema.safeParse({ greenhouse: [slug], lever: [] }).success).toBe(false)
    }
  })

  it("rejects a slug longer than the cap", () => {
    expect(
      atsWatchlistSchema.safeParse({ greenhouse: ["a".repeat(101)], lever: [] }).success
    ).toBe(false)
    expect(
      atsWatchlistSchema.safeParse({ greenhouse: ["a".repeat(100)], lever: [] }).success
    ).toBe(true)
  })

  it("rejects more than the per-source ceiling, counted after dedupe", () => {
    const tooMany = Array.from({ length: MAX_ATS_SLUGS + 1 }, (_unused, i) => `board-${i}`)

    expect(atsWatchlistSchema.safeParse({ greenhouse: tooMany, lever: [] }).success).toBe(false)
    // The same slug repeated collapses to one, so it is under the ceiling.
    expect(
      atsWatchlistSchema.safeParse({ greenhouse: tooMany.map(() => "gitlab"), lever: [] })
        .success
    ).toBe(true)
  })

  it("requires the sources that predate Ashby to be present", () => {
    expect(atsWatchlistSchema.safeParse({ greenhouse: [] }).success).toBe(false)
  })

  it("defaults a missing ashby list, so a watchlist saved before it existed still parses", () => {
    const parsed = atsWatchlistSchema.safeParse({ greenhouse: ["gitlab"], lever: ["ro"] })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.ashby).toEqual([])
  })
})
