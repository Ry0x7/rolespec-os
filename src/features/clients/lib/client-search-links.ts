import type { ClientService } from "../data/services"
import type { ClientArrangement } from "./lead-score"

/**
 * Ready-to-open searches for places clients post work. Nothing is fetched: the
 * user opens a link and searches there, signed in as themselves. Every URL is
 * built through `URL`/`URLSearchParams`, and only the service's own search
 * phrase and the user's chosen location are sent.
 *
 * The URL shapes were opened live on 2026-11-27: Upwork's `nx/search/jobs?q=`
 * and Freelancer's `/job-search/{slug}/` both return filtered results without
 * signing in. LinkedIn, X and Facebook need the user's own sign-in; the link
 * says so instead of pretending to be a public search.
 */

export type ClientLinkKind = "MARKETPLACE" | "HIRING_POSTS" | "LOCAL"

export const CLIENT_LINK_KIND_LABELS: Record<ClientLinkKind, string> = {
  MARKETPLACE: "Freelance marketplaces",
  HIRING_POSTS: "Hiring posts on social media",
  LOCAL: "Local businesses to pitch",
}

export interface ClientSearchLink {
  id: string
  kind: ClientLinkKind
  label: string
  /** One line on what the link finds. */
  hint: string
  url: string
  signInRequired: boolean
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function quoted(value: string): string {
  return `"${value.replace(/"/g, "").trim()}"`
}

export function buildClientSearchLinks(input: {
  service: ClientService
  arrangement: ClientArrangement
  location?: string
}): ClientSearchLink[] {
  const phrase = input.service.queries[0]?.trim()
  if (!phrase) return []
  const location = input.location?.replace(/\s+/g, " ").trim() || null
  const links: ClientSearchLink[] = []

  if (input.arrangement !== "ONSITE") {
    const upwork = new URL("https://www.upwork.com/nx/search/jobs/")
    upwork.searchParams.set("q", phrase)
    links.push({
      id: "upwork",
      kind: "MARKETPLACE",
      label: "Upwork",
      hint: `Open client jobs for “${phrase}”`,
      url: upwork.toString(),
      signInRequired: false,
    })

    const freelancerSlug = slug(phrase)
    if (freelancerSlug) {
      links.push({
        id: "freelancer",
        kind: "MARKETPLACE",
        label: "Freelancer.com",
        hint: `Open projects for “${phrase}”`,
        url: `https://www.freelancer.com/job-search/${freelancerSlug}/`,
        signInRequired: false,
      })
    }

    const onlinejobs = new URL("https://www.onlinejobs.ph/jobseekers/jobsearch")
    onlinejobs.searchParams.set("jobkeyword", phrase)
    links.push({
      id: "onlinejobsph",
      kind: "MARKETPLACE",
      label: "OnlineJobs.ph",
      hint: "Long-term remote roles from overseas employers, popular for virtual assistants",
      url: onlinejobs.toString(),
      signInRequired: false,
    })
  }

  // People announce they are hiring in posts long before a job ad exists.
  const hiringQuery = `${quoted(`hiring`)} ${quoted(phrase)}${location && input.arrangement === "ONSITE" ? ` ${quoted(location)}` : ""}`
  const linkedin = new URL("https://www.linkedin.com/search/results/content/")
  linkedin.searchParams.set("keywords", hiringQuery)
  linkedin.searchParams.set("sortBy", '"date_posted"')
  links.push({
    id: "linkedin-posts",
    kind: "HIRING_POSTS",
    label: "LinkedIn posts",
    hint: "Recent posts from people saying they are hiring",
    url: linkedin.toString(),
    signInRequired: true,
  })

  const x = new URL("https://x.com/search")
  x.searchParams.set("q", `${hiringQuery} -filter:replies`)
  x.searchParams.set("f", "live")
  links.push({
    id: "x-posts",
    kind: "HIRING_POSTS",
    label: "X (Twitter)",
    hint: "Latest hiring posts",
    url: x.toString(),
    signInRequired: true,
  })

  const reddit = new URL("https://www.reddit.com/r/forhire/search/")
  reddit.searchParams.set("q", `[Hiring] ${phrase}`)
  reddit.searchParams.set("restrict_sr", "1")
  reddit.searchParams.set("sort", "new")
  links.push({
    id: "reddit-forhire",
    kind: "HIRING_POSTS",
    label: "Reddit r/forhire",
    hint: "Newest [Hiring] posts",
    url: reddit.toString(),
    signInRequired: false,
  })

  if (input.arrangement !== "REMOTE") {
    const near = location ? ` near ${location}` : " near me"
    for (const prospect of input.service.localProspects.slice(0, 3)) {
      const maps = new URL("https://www.google.com/maps/search/")
      maps.searchParams.set("api", "1")
      maps.searchParams.set("query", `${prospect}${near}`)
      links.push({
        id: `maps-${slug(prospect)}`,
        kind: "LOCAL",
        label: `${prospect.charAt(0).toUpperCase()}${prospect.slice(1)}${near}`,
        hint: `Local businesses that often buy ${input.service.label.toLowerCase()}`,
        url: maps.toString(),
        signInRequired: false,
      })
    }

    const indeed = new URL("https://www.indeed.com/jobs")
    indeed.searchParams.set("q", `${phrase} part time OR contract`)
    if (location) indeed.searchParams.set("l", location)
    links.push({
      id: "indeed-local",
      kind: "LOCAL",
      label: "Indeed",
      hint: location ? `Part-time and contract work in ${location}` : "Part-time and contract work",
      url: indeed.toString(),
      signInRequired: false,
    })
  }

  return links
}
