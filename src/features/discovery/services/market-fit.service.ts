import type { WorkType } from "@/generated/prisma/enums"

/**
 * Deterministic "can I even be considered from where I live?" for one posting.
 *
 * Providers publish location as free text — Remotive says "USA Only", an ATS
 * says "New York, NY", Arbeitnow says "Berlin". None of that is a structured
 * eligibility field, so this reads the string the way a person would: does it
 * name my market, my region, nowhere in particular, or somewhere else only.
 *
 * Two rules shape the file:
 *
 * - Being conservative costs less than being wrong. An unrecognized string is
 *   UNKNOWN, never RESTRICTED: hiding a job the user could have taken is the
 *   expensive mistake, and the recognition tables here are deliberately modest
 *   rather than exhaustive.
 * - A user who is open to relocation is never told a posting is out of reach.
 *   The same string that RESTRICTS a rooted profile only annotates theirs.
 *
 * Pure, offline and AI-free: it runs for every candidate of every discovery run.
 */

/** How the posting's stated location lines up with where the user can work. */
export type MarketFit = "IN_MARKET" | "REGION" | "OPEN" | "RESTRICTED" | "UNKNOWN"

export interface MarketFitResult {
  fit: MarketFit
  /** A plain sentence, already user-facing. */
  reason: string
  /** Three words or fewer, for the chip on a collapsed card. */
  label: string
  /**
   * The place a RESTRICTED posting limits itself to, as it should be said in a
   * sentence ("Hamburg", "US"). Absent for every other fit.
   */
  restrictedTo?: string
}

export interface MarketFitPosting {
  /** The provider's free-text location, exactly as published. */
  location: string | null
  /**
   * The normalized work mode, when the source published one.
   *
   * Deliberately not a rescue: a remote posting that says "USA Only" is still
   * restricted to the USA, which is the whole reason this service exists. It is
   * accepted so callers do not have to know that, and so the rule stays stated.
   */
  workTypeHint?: WorkType | null
  /**
   * The posting body, consulted only when the location string settled nothing,
   * and only for an explicit "<region> only" statement. Anything looser would
   * let an office address in a paragraph of prose rule the user out.
   */
  description?: string | null
  /**
   * The posting's own link, read only for its host and only as a last resort.
   * A posting with no usable location is common on PH-first boards, where the
   * board itself is the strongest thing left to say about the market.
   */
  url?: string | null
}

export interface MarketFitProfile {
  locations: string[]
  /**
   * Deliberately not read here. What a posting says about where it hires is a
   * fact about the posting; whether the user would move is a fact about the
   * user. Mixing them made a "USA Only" posting read as unrestricted, so the
   * willingness to relocate is applied later — it lifts the verdict cap in
   * `qualify.service`, and never rewrites what the posting said.
   */
  openToRelocation: boolean
}

/**
 * Country → the strings that mean "this posting is in that country".
 *
 * Data-driven so another country is a table entry rather than a code change.
 * Only PH is populated today: it is the only market the product currently
 * claims to put first, and a half-researched table for a country nobody in the
 * data lives in would be recognition the results cannot support.
 */
const COUNTRY_MARKETS: Record<
  string,
  {
    display: string
    /** The adjective a sentence needs for "a <x> job board". */
    boardDisplay: string
    markers: string[]
    initialisms: string[]
  }
> = {
  PH: {
    display: "the Philippines",
    boardDisplay: "Philippine",
    markers: [
      "philippines",
      "philippine",
      "pilipinas",
      "ph",
      "phl",
      "manila",
      "metro manila",
      "makati",
      "bgc",
      "taguig",
      "ortigas",
      "pasig",
      "quezon city",
      "cebu",
      "davao",
      "cagayan de oro",
      "mindanao",
      "iloilo",
      // "Clark" and "Laguna" are place names elsewhere too (Clark, NJ; Laguna
      // Beach, CA), and reading either as Philippine would promote a posting the
      // user cannot take. Only the qualified spellings count.
      "clark pampanga",
      "clark freeport",
      "pampanga",
      "laguna philippines",
      "laguna calabarzon",
      "calabarzon",
    ],
    /**
     * Matched case-sensitively against the posting's original text: "NCR" and
     * "CDO" are the Philippine regions, while "ncr" and "cdo" inside prose are
     * usually an abbreviation for something else entirely.
     */
    initialisms: ["NCR", "CDO"],
  },
}

/**
 * Job-board hosts that only publish for one country, and which country.
 *
 * A weak signal by design and used only where nothing stronger exists: a board
 * says where its audience is, not where a given role will consider candidates
 * from, so an explicit location or an explicit "<region> only" in the body
 * always outranks it. Hosts are listed exactly as the postings carry them; the
 * lookup also tries the `www.`-stripped form.
 */
const MARKET_HOSTS: Record<string, string> = {
  "bossjob.ph": "PH",
  "ph.jobstreet.com": "PH",
  "www.jobstreet.com.ph": "PH",
  "kalibrr.com": "PH",
  "www.kalibrr.com": "PH",
  "onlinejobs.ph": "PH",
  "ph.indeed.com": "PH",
}

/** Region bands that include the Philippines without naming it. */
const REGION_MARKERS = [
  "apac",
  "asia",
  "asia pacific",
  "asiapacific",
  "southeast asia",
  "south east asia",
  // "SEA" on its own is deliberately absent. A live run had Stripe publishing
  // "SEA, SF, NY, Toronto" — Seattle, not South East Asia — and an APAC chip on
  // a US-only posting is the exact mistake this service exists to stop.
  "asean",
  "gmt+8",
  "utc+8",
  "gmt 8",
  "utc 8",
  "asia manila",
]

/** Strings that mean "location is not a constraint at all". */
const OPEN_MARKERS = [
  "worldwide",
  "anywhere",
  "global",
  "globally",
  "international",
  "fully remote",
]

/**
 * Other-country markers, with the wording a chip should use.
 *
 * A modest built-in list of the places these sources actually publish, not a
 * gazetteer. Longer phrases sit before the short ones they contain so the
 * displayed wording is the most specific one that matched.
 */
const RESTRICTED_MARKERS: Array<{ marker: string; display: string }> = [
  // Countries and regions.
  { marker: "united states", display: "US" },
  { marker: "united states of america", display: "US" },
  { marker: "usa", display: "US" },
  { marker: "u s a", display: "US" },
  { marker: "us", display: "US" },
  { marker: "america", display: "US" },
  { marker: "american", display: "US" },
  { marker: "canada", display: "Canada" },
  { marker: "united kingdom", display: "UK" },
  { marker: "uk", display: "UK" },
  { marker: "england", display: "UK" },
  { marker: "scotland", display: "UK" },
  { marker: "ireland", display: "Ireland" },
  { marker: "european union", display: "EU" },
  { marker: "eu", display: "EU" },
  { marker: "europe", display: "Europe" },
  { marker: "european", display: "Europe" },
  { marker: "emea", display: "EMEA" },
  { marker: "latam", display: "LATAM" },
  { marker: "latin america", display: "LATAM" },
  { marker: "germany", display: "Germany" },
  { marker: "deutschland", display: "Germany" },
  { marker: "france", display: "France" },
  { marker: "spain", display: "Spain" },
  { marker: "portugal", display: "Portugal" },
  { marker: "netherlands", display: "Netherlands" },
  { marker: "belgium", display: "Belgium" },
  { marker: "poland", display: "Poland" },
  { marker: "romania", display: "Romania" },
  { marker: "ukraine", display: "Ukraine" },
  { marker: "switzerland", display: "Switzerland" },
  { marker: "austria", display: "Austria" },
  { marker: "sweden", display: "Sweden" },
  { marker: "norway", display: "Norway" },
  { marker: "denmark", display: "Denmark" },
  { marker: "finland", display: "Finland" },
  { marker: "italy", display: "Italy" },
  { marker: "israel", display: "Israel" },
  { marker: "india", display: "India" },
  { marker: "singapore", display: "Singapore" },
  { marker: "japan", display: "Japan" },
  { marker: "australia", display: "Australia" },
  { marker: "new zealand", display: "New Zealand" },
  { marker: "brazil", display: "Brazil" },
  { marker: "mexico", display: "Mexico" },
  { marker: "argentina", display: "Argentina" },
  { marker: "colombia", display: "Colombia" },
  { marker: "nigeria", display: "Nigeria" },
  { marker: "kenya", display: "Kenya" },
  { marker: "south africa", display: "South Africa" },
  // US states the boards publish by name.
  { marker: "california", display: "California" },
  { marker: "texas", display: "Texas" },
  { marker: "florida", display: "Florida" },
  { marker: "washington", display: "Washington" },
  { marker: "massachusetts", display: "Massachusetts" },
  { marker: "colorado", display: "Colorado" },
  { marker: "illinois", display: "Illinois" },
  { marker: "ontario", display: "Ontario" },
  { marker: "british columbia", display: "British Columbia" },
  // Tech-hub cities.
  { marker: "new york", display: "New York" },
  { marker: "san francisco", display: "San Francisco" },
  { marker: "los angeles", display: "Los Angeles" },
  { marker: "seattle", display: "Seattle" },
  { marker: "austin", display: "Austin" },
  { marker: "boston", display: "Boston" },
  { marker: "chicago", display: "Chicago" },
  { marker: "denver", display: "Denver" },
  { marker: "atlanta", display: "Atlanta" },
  { marker: "toronto", display: "Toronto" },
  { marker: "vancouver", display: "Vancouver" },
  { marker: "montreal", display: "Montreal" },
  { marker: "london", display: "London" },
  { marker: "berlin", display: "Berlin" },
  { marker: "munich", display: "Munich" },
  { marker: "muenchen", display: "Munich" },
  { marker: "hamburg", display: "Hamburg" },
  { marker: "frankfurt", display: "Frankfurt" },
  { marker: "cologne", display: "Cologne" },
  { marker: "koeln", display: "Cologne" },
  { marker: "stuttgart", display: "Stuttgart" },
  { marker: "duesseldorf", display: "Dusseldorf" },
  { marker: "paris", display: "Paris" },
  { marker: "amsterdam", display: "Amsterdam" },
  { marker: "dublin", display: "Dublin" },
  { marker: "madrid", display: "Madrid" },
  { marker: "barcelona", display: "Barcelona" },
  { marker: "lisbon", display: "Lisbon" },
  { marker: "warsaw", display: "Warsaw" },
  { marker: "krakow", display: "Krakow" },
  { marker: "prague", display: "Prague" },
  { marker: "zurich", display: "Zurich" },
  { marker: "vienna", display: "Vienna" },
  { marker: "stockholm", display: "Stockholm" },
  { marker: "copenhagen", display: "Copenhagen" },
  { marker: "milan", display: "Milan" },
  { marker: "bucharest", display: "Bucharest" },
  { marker: "budapest", display: "Budapest" },
  { marker: "bangalore", display: "Bangalore" },
  { marker: "bengaluru", display: "Bengaluru" },
  { marker: "mumbai", display: "Mumbai" },
  { marker: "hyderabad", display: "Hyderabad" },
  { marker: "chennai", display: "Chennai" },
  { marker: "pune", display: "Pune" },
  { marker: "tokyo", display: "Tokyo" },
  { marker: "seoul", display: "Seoul" },
  { marker: "sydney", display: "Sydney" },
  { marker: "melbourne", display: "Melbourne" },
  { marker: "auckland", display: "Auckland" },
  { marker: "dubai", display: "Dubai" },
  { marker: "tel aviv", display: "Tel Aviv" },
  { marker: "lagos", display: "Lagos" },
  { marker: "nairobi", display: "Nairobi" },
  { marker: "cape town", display: "Cape Town" },
  { marker: "sao paulo", display: "Sao Paulo" },
  { marker: "buenos aires", display: "Buenos Aires" },
]

/**
 * Words that carry no place of their own. A profile location made only of these
 * ("Remote") would otherwise match every posting ever published.
 */
const GENERIC_LOCATION_WORDS = new Set([
  "remote",
  "hybrid",
  "onsite",
  "on",
  "site",
  "only",
  "anywhere",
  "worldwide",
  "global",
  "work",
  "from",
  "home",
])

/** Shortest token worth matching on; below this a marker matches too much. */
const MIN_MARKER_LENGTH = 2

/**
 * Lowercased, space-padded text with every non-token character collapsed to a
 * space, so `includes(" ph ")` is a whole-token match and "Manila, PH" cannot be
 * read as "Philadelphia". `+` survives so "GMT+8" stays one token.
 */
function normalizeLocationText(value: string): string {
  const collapsed = value
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return ` ${collapsed} `
}

/**
 * The same collapsing with the original case kept, for markers that only mean a
 * place when they are shouted: "NCR" is a Philippine region, "ncr" in prose is
 * an abbreviation for anything at all.
 */
function preserveCaseText(value: string): string {
  const collapsed = value
    .replace(/[^A-Za-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return ` ${collapsed} `
}

function mentions(haystack: string, phrase: string): boolean {
  return haystack.includes(` ${phrase} `)
}

/**
 * The country a profile's stated locations resolve to, or null when none of
 * them name a country this service has a table for. First match wins, in the
 * user's own priority order.
 */
export function resolveProfileCountry(locations: string[]): string | null {
  for (const location of locations) {
    for (const [code, market] of Object.entries(COUNTRY_MARKETS)) {
      if (mentionsMarket(location, market)) return code
    }
  }
  return null
}

/**
 * That country as a sentence needs it ("the Philippines"), or null when the
 * profile names none this build recognises. Callers that cannot name the market
 * are expected to fall back to generic wording rather than guess one.
 */
export function resolveProfileMarketName(locations: string[]): string | null {
  const country = resolveProfileCountry(locations)
  return country ? (COUNTRY_MARKETS[country]?.display ?? null) : null
}

/**
 * The profile's own locations as contiguous phrases worth searching a posting
 * for. Generic words are kept inside a phrase ("remote apac") but a location
 * made of nothing else is dropped — it would match everything.
 */
function profileLocationPhrases(locations: string[]): string[] {
  const phrases: string[] = []
  for (const location of locations) {
    const normalized = normalizeLocationText(location).trim()
    if (normalized.length < MIN_MARKER_LENGTH) continue
    const tokens = normalized.split(" ")
    if (tokens.every((token) => GENERIC_LOCATION_WORDS.has(token))) continue
    phrases.push(normalized)
  }
  return phrases
}

/**
 * Classifies one posting's stated location against the user's market.
 *
 * Order matters and is the product ruling: my market beats my region beats
 * "open to everyone" beats "somewhere else only". A posting that names the
 * user's city is IN_MARKET even if it also names the country's region band.
 */
export function classifyMarketFit(
  posting: MarketFitPosting,
  profile: MarketFitProfile
): MarketFitResult {
  const raw = posting.location?.trim() ?? ""
  const haystack = normalizeLocationText(raw)
  const country = resolveProfileCountry(profile.locations)
  const market = country ? COUNTRY_MARKETS[country] : null

  if (raw.length > 0) {
    // 1. The posting names a location the user themselves listed.
    const phrase = profileLocationPhrases(profile.locations).find((entry) =>
      mentions(haystack, entry)
    )
    if (phrase) {
      return {
        fit: "IN_MARKET",
        reason: `${raw} is one of your preferred locations.`,
        label: market && mentionsMarket(raw, market) ? marketLabel(country) : "Your area",
      }
    }

    // 2. The posting names somewhere inside the country the profile resolves to.
    if (market && mentionsMarket(raw, market)) {
      return {
        fit: "IN_MARKET",
        reason: `Open to candidates in ${market.display}.`,
        label: marketLabel(country),
      }
    }

    // 3. A region band that contains the user's market.
    if (REGION_MARKERS.some((marker) => mentions(haystack, marker))) {
      return {
        fit: "REGION",
        reason: `${raw} covers your region.`,
        label: "APAC",
      }
    }

    // 4. No constraint at all — but only when nothing else is named. "Remote -
    //    US" says "anywhere" in one breath and "not you" in the next.
    const restriction = findRestriction(haystack)
    if (!restriction && OPEN_MARKERS.some((marker) => mentions(haystack, marker))) {
      return {
        fit: "OPEN",
        reason: "Open worldwide — no location restriction stated.",
        label: "Worldwide",
      }
    }

    if (restriction) return restricted(restriction.display, market?.display ?? null)
  }

  // 5. Nothing usable in the location string. The description only gets a say
  //    when it states a restriction outright.
  const stated = findStatedRestriction(posting.description ?? "")
  if (stated) return restricted(stated.display, market?.display ?? null)

  // 6. Nothing in the posting placed it, so the board it was published on is
  //    the last thing left — and only when it publishes for the user's own
  //    market. Deliberately after every explicit statement above: a "USA Only"
  //    role on a Philippine board is still USA only.
  const hostMarket = resolveHostMarket(posting.url)
  if (hostMarket && country && hostMarket.country === country) {
    return {
      fit: "IN_MARKET",
      reason: `Listed on a ${COUNTRY_MARKETS[country]?.boardDisplay ?? country} job board (${hostMarket.host}).`,
      label: marketLabel(country),
    }
  }

  // "Said nothing" and "said something this build cannot place" are different
  // answers, and the second one is the user's cue to open the posting.
  if (raw.length > 0) {
    return {
      fit: "UNKNOWN",
      reason: `Couldn't tell whether "${raw}" is open to you — read the posting.`,
      label: "Location unclear",
    }
  }

  return {
    fit: "UNKNOWN",
    reason: "The posting does not say where you need to be based.",
    label: "Location unstated",
  }
}

/**
 * True when the text names somewhere inside that country. Lowercased markers are
 * matched on the folded text; initialisms only count when the original text
 * shouted them.
 */
function mentionsMarket(
  raw: string,
  market: { markers: string[]; initialisms: string[] }
): boolean {
  const haystack = normalizeLocationText(raw)
  if (market.markers.some((marker) => mentions(haystack, marker))) return true
  const cased = preserveCaseText(raw)
  return market.initialisms.some((initialism) => cased.includes(` ${initialism} `))
}

/**
 * The country a posting's host publishes for, with the host as it was matched,
 * or null when the link is missing, unparseable or not a board this knows.
 */
function resolveHostMarket(url: string | null | undefined): {
  country: string
  host: string
} | null {
  if (!url) return null
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  const country =
    MARKET_HOSTS[host] ?? MARKET_HOSTS[host.replace(/^www\./, "")] ?? null
  return country ? { country, host } : null
}

/**
 * The plain place name a `Job.location` field should carry for a host market
 * code. `COUNTRY_MARKETS.display` is sentence wording ("the Philippines"), not a
 * stored location, so this is kept separately. Only codes `MARKET_HOSTS` can
 * produce are listed; an unlisted code yields no label rather than a guess.
 */
const HOST_MARKET_LOCATION_LABELS: Record<string, string> = {
  PH: "Philippines",
}

/**
 * The location label a posting's board host implies ("Philippines"), or null
 * when the link is missing, unparseable, not a board this knows, or maps to a
 * market with no label. Uses the same host lookup as the fit check's host hint.
 */
export function deriveLocationFromHost(url: string | null | undefined): string | null {
  const hostMarket = resolveHostMarket(url)
  return hostMarket ? (HOST_MARKET_LOCATION_LABELS[hostMarket.country] ?? null) : null
}

/** "Open to PH" for the country code, so the chip stays inside three words. */
function marketLabel(country: string | null): string {
  return country ? `Open to ${country}` : "Your area"
}

function findRestriction(haystack: string): { display: string } | null {
  // Longest marker first, so "united states" wins over the "us" inside it.
  const matched = [...RESTRICTED_MARKERS]
    .sort((a, b) => b.marker.length - a.marker.length)
    .find((entry) => mentions(haystack, entry.marker))
  return matched ? { display: matched.display } : null
}

/**
 * An explicit "<region> only" in the posting body. The word "only" is required:
 * a description that merely mentions a city is naming an office, not a rule.
 */
function findStatedRestriction(description: string): { display: string } | null {
  if (!description) return null
  const haystack = normalizeLocationText(description)
  const matched = [...RESTRICTED_MARKERS]
    .sort((a, b) => b.marker.length - a.marker.length)
    .find((entry) => mentions(haystack, `${entry.marker} only`))
  return matched ? { display: matched.display } : null
}

/**
 * True when the description states an other-market restriction outright ("US
 * only"), using the same check the fit classifier applies when the posting has
 * no usable location. Exposed so callers that infer a location can defer to it.
 */
export function descriptionStatesRestriction(description: string | null | undefined): boolean {
  return findStatedRestriction(description ?? "") !== null
}

/**
 * The restricted verdict. What the posting said about where it hires is a fact
 * about the posting, so it reads the same for every user; whether the user would
 * move is applied later, where it lifts the verdict cap instead of rewriting
 * this. Mixing the two made "USA Only" read as unrestricted.
 */
function restricted(display: string, marketDisplay: string | null): MarketFitResult {
  return {
    fit: "RESTRICTED",
    restrictedTo: display,
    reason: marketDisplay
      ? `Posting is limited to ${display}; your profile location is ${marketDisplay}.`
      : `Posting is limited to ${display}, which is outside your preferred locations.`,
    label: display.split(" ").length > 1 ? `Limited to ${display}` : `${display} only`,
  }
}
