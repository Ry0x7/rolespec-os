/**
 * Which job boards get an in-page fit badge, and where on each board the badge goes.
 *
 * Pure on purpose: no `chrome` globals, so the selectors are unit-testable against the
 * captured markup in `src/__fixtures__/badge-*.html`. Read-only towards the page: every
 * function here only queries the DOM, it never writes to it.
 */

export type BadgeSite = "jobstreet" | "indeed" | "linkedin"

/** One job card in a search-result list. */
export interface BadgeCard {
  card: Element
  /**
   * Canonical job URL built from the job id on the card's link. Doubles as the stable
   * identity of the posting: a virtualised list that re-renders the card yields the
   * same key, and a card and the detail page of the same job share one.
   */
  key: string
  title: string
  companyName?: string
  location?: string
  /** The element the badge is inserted directly after. */
  mount: Element
}

export interface SiteAdapter {
  /**
   * The canonical key when `url` is a single-job detail page, else null. Search pages
   * that show a job in a side pane are lists here: the selected card carries the badge,
   * and the page-level extractor would read the search page, not the pane.
   */
  detailKey(url: string): string | null
  /** The detail page's job title element, or null when it is not on the page. */
  detailTitleAnchor(doc: Document): Element | null
  /** Every rendered job card. `pageUrl` resolves relative links (defaults to doc.URL). */
  listCards(doc: Document, pageUrl?: string): BadgeCard[]
}

const JOBSTREET_HOST = /(^|\.)(jobstreet\.com(\.[a-z]{2})?|seek\.com(\.[a-z]{2})?|seek\.co\.nz)$/i
// indeed.com, www./ph./uk.indeed.com, indeed.com.ph, indeed.co.uk, indeed.de, ...
const INDEED_HOST = /(^|\.)indeed\.(com|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2})$/i
// www.linkedin.com and the country hosts guest pages are served from (ph., uk., ...).
const LINKEDIN_HOST = /(^|\.)linkedin\.com$/i

function parseUrl(url: string | null | undefined, base?: string): URL | null {
  if (!url) return null
  try {
    const parsed = base ? new URL(url, base) : new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null
  } catch {
    return null
  }
}

export function siteFor(url: string | null | undefined): BadgeSite | null {
  const parsed = parseUrl(url)
  if (!parsed) return null
  const host = parsed.hostname
  if (JOBSTREET_HOST.test(host)) return "jobstreet"
  if (INDEED_HOST.test(host)) return "indeed"
  if (LINKEDIN_HOST.test(host)) return "linkedin"
  return null
}

/**
 * True for a single-origin grant (`https://ph.jobstreet.com/*`, as `originPatternFor`
 * builds them) on a supported board. Wildcard hosts are refused: a broad grant must
 * never turn into a content script registered across the whole web.
 */
export function isSupportedOriginPattern(pattern: string | null | undefined): boolean {
  if (!pattern || !pattern.endsWith("/*")) return false
  const origin = pattern.slice(0, -2)
  if (origin.includes("*")) return false
  const parsed = parseUrl(`${origin}/`)
  if (!parsed || `${parsed.protocol}//${parsed.host}` !== origin.toLowerCase()) return false
  return siteFor(parsed.href) !== null
}

function clean(value: string | null | undefined): string | undefined {
  const text = (value ?? "").replace(/\s+/g, " ").trim()
  return text.length > 0 ? text : undefined
}

function textOf(root: ParentNode, selector: string): string | undefined {
  return clean(root.querySelector(selector)?.textContent)
}

function originOf(pageUrl: string | undefined, fallback: string): string {
  const parsed = parseUrl(pageUrl)
  return parsed ? parsed.origin : fallback
}

/** Drops cards whose key repeats (the same job rendered twice) or that have no title. */
function dedupe(cards: BadgeCard[]): BadgeCard[] {
  const seen = new Set<string>()
  return cards.filter((card) => {
    if (!card.title || seen.has(card.key)) return false
    seen.add(card.key)
    return true
  })
}

/**
 * JobStreet / SEEK (one codebase). Verified against ph.jobstreet.com markup, 2026-10-14:
 * cards are `article[data-testid="job-card"][data-job-id]`, the title link is
 * `a[data-automation="jobTitle"]` with href `/job/<id>?...`, and the detail page title is
 * `h1[data-automation="job-detail-title"]`. Class names are hashed and never used.
 */
const jobstreet: SiteAdapter = {
  detailKey(url) {
    const parsed = parseUrl(url)
    const id = parsed?.pathname.match(/^\/job\/(\d+)/)?.[1]
    return parsed && id ? `${parsed.origin}/job/${id}` : null
  },
  detailTitleAnchor(doc) {
    return doc.querySelector('h1[data-automation="job-detail-title"]')
  },
  listCards(doc, pageUrl = doc.URL) {
    const origin = originOf(pageUrl, "https://www.jobstreet.com")
    const cards: BadgeCard[] = []
    for (const card of doc.querySelectorAll('article[data-testid="job-card"], article[data-job-id]')) {
      const link = card.querySelector('a[data-automation="jobTitle"]')
      if (!link) continue
      const id =
        parseUrl(link.getAttribute("href"), origin)?.pathname.match(/^\/job\/(\d+)/)?.[1] ??
        card.getAttribute("data-job-id")?.match(/^\d+$/)?.[0]
      if (!id) continue
      cards.push({
        card,
        key: `${origin}/job/${id}`,
        title: clean(link.textContent) ?? "",
        companyName: textOf(card, '[data-automation="jobCompany"]'),
        location:
          textOf(card, '[data-automation="jobCardLocation"]') ??
          textOf(card, '[data-automation="jobLocation"]'),
        mount: link,
      })
    }
    return dedupe(cards)
  },
}

/**
 * Indeed. The search page was verified against ph.indeed.com markup, 2026-10-14: each card
 * link is `a.jcs-JobTitle[data-jk]` (its href is a tracking redirect, so the job id comes
 * from `data-jk`), the title is `span[id^="jobTitle-"]`, company and location carry
 * `data-testid="company-name"` / `"text-location"`. The `/viewjob` page itself answered a
 * bot-detection redirect, so its title selector comes from the search page's job pane
 * (`[data-testid="vj-job-title"]`) plus Indeed's long-standing
 * `jobsearch-JobInfoHeader-title` hook (UNVERIFIED on the live /viewjob page).
 */
const indeed: SiteAdapter = {
  detailKey(url) {
    const parsed = parseUrl(url)
    if (!parsed || !/^\/(m\/)?viewjob\/?$/.test(parsed.pathname)) return null
    const jk = parsed.searchParams.get("jk")
    return jk && /^[a-z0-9]+$/i.test(jk) ? `${parsed.origin}/viewjob?jk=${jk}` : null
  },
  detailTitleAnchor(doc) {
    return doc.querySelector(
      '[data-testid="jobsearch-JobInfoHeader-title"], h1.jobsearch-JobInfoHeader-title, [data-testid="vj-job-title"]',
    )
  },
  listCards(doc, pageUrl = doc.URL) {
    const origin = originOf(pageUrl, "https://www.indeed.com")
    const cards: BadgeCard[] = []
    for (const link of doc.querySelectorAll("a[data-jk]")) {
      const jk =
        link.getAttribute("data-jk") ??
        parseUrl(link.getAttribute("href"), origin)?.searchParams.get("jk") ??
        ""
      if (!/^[a-z0-9]+$/i.test(jk)) continue
      const card = link.closest(".cardOutline, .job_seen_beacon, li") ?? link
      cards.push({
        card,
        key: `${origin}/viewjob?jk=${jk}`,
        title: clean(link.querySelector('span[id^="jobTitle-"], span[title]')?.textContent) ?? clean(link.textContent) ?? "",
        companyName: textOf(card, '[data-testid="company-name"]'),
        location: textOf(card, '[data-testid="text-location"]'),
        mount: link,
      })
    }
    return dedupe(cards)
  },
}

const LINKEDIN_JOB_ID = /\/jobs\/view\/(?:[^/?#]*-)?(\d+)/

/**
 * LinkedIn, on www.linkedin.com and every country host (ph., uk., ...). The guest
 * (logged-out) markup was verified against ph.linkedin.com, 2026-10-14 (www.linkedin.com
 * answered an authwall to the capturing browser): cards are `.base-search-card[data-entity-urn]` with title
 * `h3.base-search-card__title`, detail title `h1.top-card-layout__title`. The logged-in
 * app's selectors (`[data-occludable-job-id]`, `.job-card-container`,
 * `.job-details-jobs-unified-top-card__job-title`) are UNVERIFIED: no logged-in capture.
 */
const linkedin: SiteAdapter = {
  detailKey(url) {
    const parsed = parseUrl(url)
    const id = parsed?.pathname.match(LINKEDIN_JOB_ID)?.[1]
    return id ? `https://www.linkedin.com/jobs/view/${id}` : null
  },
  detailTitleAnchor(doc) {
    return doc.querySelector(
      [
        "h1.top-card-layout__title",
        ".job-details-jobs-unified-top-card__job-title h1",
        "h1.job-details-jobs-unified-top-card__job-title",
        "h1.jobs-unified-top-card__job-title",
      ].join(", "),
    )
  },
  listCards(doc, pageUrl = doc.URL) {
    const origin = originOf(pageUrl, "https://www.linkedin.com")
    const cards: BadgeCard[] = []
    const idFrom = (link: Element | null, fallback: string | null): string | undefined =>
      parseUrl(link?.getAttribute("href"), origin)?.pathname.match(LINKEDIN_JOB_ID)?.[1] ??
      fallback?.match(/(\d+)$/)?.[1]

    // Guest search page (verified).
    for (const card of doc.querySelectorAll(".base-search-card[data-entity-urn], .job-search-card[data-entity-urn]")) {
      const titleEl = card.querySelector(".base-search-card__title")
      const link = card.matches("a") ? card : card.querySelector('a.base-card__full-link, a[href*="/jobs/view/"]')
      const id = idFrom(link, card.getAttribute("data-entity-urn"))
      if (!titleEl || !id) continue
      cards.push({
        card,
        key: `https://www.linkedin.com/jobs/view/${id}`,
        title: clean(titleEl.textContent) ?? "",
        companyName: textOf(card, ".base-search-card__subtitle"),
        location: textOf(card, ".job-search-card__location"),
        mount: titleEl,
      })
    }

    // Logged-in app (UNVERIFIED). Virtualised: off-screen `li`s are empty shells until
    // scrolled to, and are skipped here because they have no title link yet.
    for (const card of doc.querySelectorAll(".job-card-container[data-job-id], [data-occludable-job-id]")) {
      if (card.matches("[data-occludable-job-id]") && card.querySelector(".job-card-container[data-job-id]")) continue
      const link = card.querySelector("a.job-card-list__title--link, a.job-card-container__link")
      const id = idFrom(link, card.getAttribute("data-job-id") ?? card.getAttribute("data-occludable-job-id"))
      if (!link || !id) continue
      cards.push({
        card,
        key: `https://www.linkedin.com/jobs/view/${id}`,
        title: clean(link.querySelector("strong")?.textContent) ?? clean(link.getAttribute("aria-label")) ?? clean(link.textContent) ?? "",
        companyName: textOf(card, ".artdeco-entity-lockup__subtitle"),
        location: textOf(card, ".job-card-container__metadata-wrapper li, .artdeco-entity-lockup__caption"),
        mount: link,
      })
    }
    return dedupe(cards)
  },
}

const ADAPTERS: Record<BadgeSite, SiteAdapter> = { jobstreet, indeed, linkedin }

export function adapterFor(site: BadgeSite): SiteAdapter {
  return ADAPTERS[site]
}
