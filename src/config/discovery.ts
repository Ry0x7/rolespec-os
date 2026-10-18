/**
 * Discovery source configuration.
 *
 * The ATS adapters (Greenhouse, Lever, Ashby, BambooHR, Freshteam, Workday) have
 * no cross-company search endpoint — every request is scoped to one company's
 * board — so they need a list of boards to scan. This is only the starting list: the effective watchlist is a
 * per-user setting (`preferences.atsWatchlist`) and this is what a user who has
 * never edited it gets. Slugs are the company's own board id in that ATS's URL
 * space; every one below returned HTTP 200 with a parseable jobs payload when
 * fetched live on 2026-09-07.
 *
 * Ashby is kept deliberately short. Its board endpoint always inlines every
 * description, so one big board is a multi-megabyte response where a Greenhouse
 * one is ~160KB; five boards is already the sensible ceiling for a default.
 *
 * The BambooHR and Freshteam defaults are two Philippine employers, which is the
 * point of having any: the PH-first pipeline should return something on a fresh
 * account. `workday` starts empty because a Workday entry is a full board URL
 * that only the user can know — see `parseWorkdayBoardUrl`.
 *
 * This list reaches a user exactly once, when they have no stored watchlist at
 * all. `atsWatchlistSchema` defaults every later-added source to `[]`, so
 * nothing here is ever merged into a watchlist somebody has already edited.
 */
export const DEFAULT_ATS_COMPANY_WATCHLIST: {
  greenhouse: string[]
  lever: string[]
  ashby: string[]
  bamboohr: string[]
  freshteam: string[]
  /** Board URLs, not slugs. */
  workday: string[]
} = {
  greenhouse: [
    "gitlab",
    "stripe",
    "airbnb",
    "dropbox",
    "coinbase",
    "robinhood",
    "figma",
    "databricks",
    "cloudflare",
    "reddit",
  ],
  // `veeva` was dropped on 2026-09-14: per-board timing showed it hanging until
  // the 7 s adapter budget killed it, returning 0 postings, on all three clean
  // runs measured — and the slowest board sets the whole Lever fan-out's wall
  // time. The other boards' latency moved run to run (`paytm` timed out twice
  // and then answered in 5.3 s with 40 postings), so only the consistently dead
  // one was removed.
  lever: [
    "ro",
    "spotify",
    "palantir",
    "gopuff",
    "binance",
    "toptal",
    "paytm",
    "ninjavan",
    "qonto",
  ],
  // Each returned HTTP 200 with a non-empty `jobs` array when fetched live on
  // 2026-09-09 (linear 29, clickup 63, ashby 71, vanta 112, ramp 145 postings).
  ashby: ["linear", "clickup", "ashby", "vanta", "ramp"],
  // Kumu (Makati) returned 7 postings from `/careers/list` live on 2026-09-14.
  bamboohr: ["kumu"],
  // Thinking Machines (Taguig) returned 5 postings from `/jobs` live on 2026-09-14.
  freshteam: ["thinkingmachines"],
  workday: [],
}
