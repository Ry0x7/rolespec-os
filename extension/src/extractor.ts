import type { ClippedJob, JobType, SalaryCurrency, SalaryPeriod, WorkType } from "./types"

/**
 * Extracts a job posting from a document.
 *
 * IMPORTANT: this function is shipped into the page by
 * `chrome.scripting.executeScript({ func: extractJobPosting })`, which stringifies
 * it. It must therefore stay entirely self-contained — every helper lives inside
 * the body and no module-scope binding (constant, import, type-only value) may be
 * referenced at runtime. Type-only imports are erased at build time and are safe.
 *
 * `doc` defaults to the ambient `document` so the injected call needs no arguments
 * (executeScript args must be JSON-serializable, and a Document is not).
 *
 * `jobLink` is intentionally NOT set here — the popup supplies the tab URL.
 */
export function extractJobPosting(doc: Document = document): Partial<ClippedJob> {
  const MAX_DESCRIPTION = 20000
  const MIN_SELECTION = 200

  const text = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined
    const trimmed = value.replace(/\s+/g, " ").trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const stripHtml = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined
    const withBreaks = value
      .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6]|\/tr)\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
    const decoded = withBreaks
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
    const collapsed = decoded
      .split("\n")
      .map((line) => line.replace(/[ \t ]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    return collapsed.length > 0 ? collapsed.slice(0, MAX_DESCRIPTION) : undefined
  }

  const normalizeJobType = (value: unknown): JobType | undefined => {
    const raw = Array.isArray(value) ? value[0] : value
    if (typeof raw !== "string") return undefined
    const key = raw.toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_|_$/g, "")
    if (key === "FULL_TIME" || key === "FULLTIME") return "FULL_TIME"
    if (key === "PART_TIME" || key === "PARTTIME") return "PART_TIME"
    if (key === "CONTRACT" || key === "CONTRACTOR" || key === "CONTRACTUAL") {
      return "CONTRACT"
    }
    if (key === "INTERN" || key === "INTERNSHIP") return "INTERNSHIP"
    if (key === "FREELANCE" || key === "FREELANCER") return "FREELANCE"
    if (key === "TEMPORARY" || key === "TEMP") return "TEMPORARY"
    // VOLUNTEER / PER_DIEM / OTHER have no accepted mapping: leave blank.
    return undefined
  }

  /**
   * Work type from schema.org: `jobLocationType: "TELECOMMUTE"` or a `jobLocation`
   * entry typed `VirtualLocation` both mean fully remote. There is no structured
   * signal for hybrid or on-site, so those only ever come from the text heuristic.
   */
  const normalizeWorkType = (
    jobLocationType: unknown,
    jobLocation: unknown
  ): WorkType | undefined => {
    const raw = Array.isArray(jobLocationType) ? jobLocationType[0] : jobLocationType
    if (typeof raw === "string" && raw.toUpperCase().trim() === "TELECOMMUTE") {
      return "REMOTE"
    }
    const nodes = Array.isArray(jobLocation) ? jobLocation : [jobLocation]
    for (const entry of nodes) {
      if (entry === null || typeof entry !== "object") continue
      if (hasType(entry as Record<string, unknown>, "VirtualLocation")) return "REMOTE"
    }
    return undefined
  }

  /**
   * Text fallback, scanned in two tiers.
   *
   * `short` (location, title, og:title) is dense enough for bare keywords. The
   * description is long and noisy — "hybrid cloud", "remote teams" — so it only
   * counts when it uses an unambiguous phrase.
   *
   * Precedence is hybrid > remote > on-site: a posting that says "remote/hybrid"
   * is hybrid-eligible, so the more specific mention wins. Nothing matched means
   * the field stays blank rather than guessing.
   */
  const guessWorkType = (short: string, description: string): WorkType | undefined => {
    const hybridPhrase = /hybrid (?:work|working|schedule|setup|set-up|model|arrangement|role|position)|(?:work|working) hybrid/i
    const remotePhrase = /work from home|\bwfh\b|fully remote|100% remote|remote[- ]first|fully[- ]distributed/i
    const onsitePhrase = /on-?site only|onsite only|office-?based|fully on-?site/i

    if (/\bhybrid\b/i.test(short) || hybridPhrase.test(description)) return "HYBRID"
    if (/work from home|\bwfh\b|fully remote|\bremote\b/i.test(short)) return "REMOTE"
    if (remotePhrase.test(description)) return "REMOTE"
    if (/on-?site|in-?office|in office/i.test(short)) return "ONSITE"
    if (onsitePhrase.test(description)) return "ONSITE"
    return undefined
  }

  const toPositiveInt = (value: unknown): number | undefined => {
    let num: number | undefined
    if (typeof value === "number") num = value
    else if (typeof value === "string") {
      const cleaned = value.replace(/[^0-9.]/g, "")
      num = cleaned.length > 0 ? Number(cleaned) : undefined
    }
    if (num === undefined || !Number.isFinite(num) || num <= 0) return undefined
    return Math.round(num)
  }

  // `salary` is stored as a single positive integer (numeric-validated input in
  // the form, `z.coerce.number().int().positive()` in the API) — there is no
  // range representation to save into, and RoleSpec never invents a number that
  // is not actually stated in the posting. So when a MonetaryAmount range
  // (minValue and maxValue both present and different) is all a posting gives,
  // the factual "from" value (minValue) is used for this field — never a
  // midpoint or maximum — and the full range is separately exposed as a
  // display-only string (see `readSalaryRangeText`) so nothing is hidden from
  // the user. An explicit single `value`, or only one of minValue/maxValue,
  // keeps the original priority order.
  const findSalaryRangeNode = (
    baseSalary: unknown
  ): { node: Record<string, unknown>; hasExplicitValue: boolean } | undefined => {
    if (baseSalary === null || typeof baseSalary !== "object") return undefined
    const node = baseSalary as Record<string, unknown>
    const value = node.value
    const spec =
      value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined
    const hasExplicitValue = toPositiveInt(spec ? spec.value : value) !== undefined
    const rangeNode =
      spec &&
      toPositiveInt(spec.minValue) !== undefined &&
      toPositiveInt(spec.maxValue) !== undefined
        ? spec
        : toPositiveInt(node.minValue) !== undefined && toPositiveInt(node.maxValue) !== undefined
          ? node
          : undefined
    if (!rangeNode) return undefined
    return { node: rangeNode, hasExplicitValue }
  }

  const readSalary = (baseSalary: unknown): number | undefined => {
    if (baseSalary === null || baseSalary === undefined) return undefined
    const direct = toPositiveInt(baseSalary)
    if (direct !== undefined) return direct
    if (typeof baseSalary !== "object") return undefined
    const node = baseSalary as Record<string, unknown>
    const value = node.value
    const spec =
      value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined

    const explicitValue = toPositiveInt(spec ? spec.value : value)
    if (explicitValue !== undefined) return explicitValue

    const range = findSalaryRangeNode(baseSalary)
    if (range) {
      const min = toPositiveInt(range.node.minValue) as number
      const max = toPositiveInt(range.node.maxValue) as number
      if (min !== max) return min
    }

    const candidates: unknown[] = []
    if (spec) candidates.push(spec.minValue, spec.maxValue)
    candidates.push(node.minValue, node.maxValue, node.amount)
    for (const candidate of candidates) {
      const parsed = toPositiveInt(candidate)
      if (parsed !== undefined) return parsed
    }
    return undefined
  }

  // Display-only: the full "min–max CURRENCY / PERIOD" range for a posting that
  // gives a band instead of one number. Never sent to the API — see
  // `ClippedJob.salaryRangeText`. Deliberately omitted when an explicit single
  // `value` exists alongside minValue/maxValue, since `readSalary` already
  // reports that exact stated number and there is nothing additional to show.
  const readSalaryRangeText = (
    baseSalary: unknown,
    period: SalaryPeriod | undefined,
    currency: SalaryCurrency | undefined
  ): string | undefined => {
    const range = findSalaryRangeNode(baseSalary)
    if (!range || range.hasExplicitValue) return undefined
    const min = toPositiveInt(range.node.minValue) as number
    const max = toPositiveInt(range.node.maxValue) as number
    if (min === max) return undefined
    const withThousands = (num: number): string =>
      num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    const suffix = [currency, period].filter(Boolean).join(" / ")
    const formattedRange = `${withThousands(min)}–${withThousands(max)}`
    return suffix ? `${formattedRange} ${suffix}` : formattedRange
  }

  // schema.org puts the period on the QuantitativeValue (`value.unitText`) and the
  // currency on the MonetaryAmount itself, but plenty of boards flatten one into the
  // other — so both levels are checked.
  const salaryNode = (baseSalary: unknown): Record<string, unknown>[] => {
    if (baseSalary === null || typeof baseSalary !== "object") return []
    const node = baseSalary as Record<string, unknown>
    const value = node.value
    return value !== null && typeof value === "object"
      ? [node, value as Record<string, unknown>]
      : [node]
  }

  const readSalaryPeriod = (baseSalary: unknown): SalaryPeriod | undefined => {
    for (const node of salaryNode(baseSalary)) {
      const raw = node.unitText
      if (typeof raw !== "string") continue
      const key = raw.toUpperCase().trim()
      if (key === "HOUR") return "HOURLY"
      if (key === "MONTH") return "MONTHLY"
      if (key === "YEAR") return "YEARLY"
      // DAY / WEEK have no accepted mapping: leave blank.
    }
    return undefined
  }

  const readSalaryCurrency = (baseSalary: unknown): SalaryCurrency | undefined => {
    for (const node of salaryNode(baseSalary)) {
      const raw = node.currency
      if (typeof raw !== "string") continue
      const key = raw.toUpperCase().trim()
      if (key === "USD" || key === "PHP") return key
      // Any other currency is one RoleSpec cannot store: leave blank.
    }
    return undefined
  }

  const readAddress = (address: unknown): string | undefined => {
    if (typeof address === "string") return text(address)
    if (address === null || typeof address !== "object") return undefined
    const node = address as Record<string, unknown>
    const parts = [
      node.addressLocality,
      node.addressRegion,
      node.addressCountry,
    ]
      .map((part) => {
        if (typeof part === "string") return text(part)
        if (part !== null && typeof part === "object") {
          return text((part as Record<string, unknown>).name)
        }
        return undefined
      })
      .filter((part): part is string => Boolean(part))
    if (parts.length > 0) return parts.join(", ").slice(0, 200)
    return text(node.name) ?? text(node.streetAddress)
  }

  /**
   * Every place a `jobLocation` names, in order and without duplicates. A single
   * entry reads exactly as it always did; a posting that lists several offices
   * keeps all of them instead of silently dropping every one after the first.
   */
  const readLocation = (jobLocation: unknown): string | undefined => {
    const nodes = Array.isArray(jobLocation) ? jobLocation : [jobLocation]
    const places: string[] = []
    for (const entry of nodes) {
      let place: string | undefined
      if (typeof entry === "string") {
        place = text(entry)
      } else if (entry !== null && typeof entry === "object") {
        const node = entry as Record<string, unknown>
        place = readAddress(node.address) ?? text(node.name)
      }
      if (place && !places.includes(place)) places.push(place)
    }
    if (places.length === 0) return undefined
    return places.join(" · ").slice(0, 200)
  }

  /**
   * `datePosted` / `validThrough` → a calendar date (`YYYY-MM-DD`). Boards publish
   * both bare dates and full timestamps; anything unparseable is dropped rather
   * than guessed at, because a wrong deadline is worse than no deadline.
   */
  const readDate = (value: unknown): string | undefined => {
    const raw = text(value)
    if (!raw) return undefined
    const bare = /^(\d{4}-\d{2}-\d{2})/.exec(raw)
    if (bare) {
      const parsedBare = Date.parse(`${bare[1]}T00:00:00.000Z`)
      return Number.isNaN(parsedBare) ? undefined : bare[1]
    }
    const parsed = Date.parse(raw)
    if (Number.isNaN(parsed)) return undefined
    // A human-written date ("09 Sep 2026" — what bossjob.ph publishes) names a
    // calendar day, not an instant. Reading it back in UTC would move it to the
    // 8th for everyone east of Greenwich, so the local day is the answer.
    const date = new Date(parsed)
    const pad = (part: number): string => String(part).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  const readOrganization = (org: unknown): string | undefined => {
    const entry = Array.isArray(org) ? org[0] : org
    if (typeof entry === "string") return text(entry)
    if (entry === null || typeof entry !== "object") return undefined
    return text((entry as Record<string, unknown>).name)
  }

  const hasType = (node: Record<string, unknown>, wanted: string): boolean => {
    const type = node["@type"]
    if (typeof type === "string") return type.toLowerCase() === wanted.toLowerCase()
    if (Array.isArray(type)) {
      return type.some(
        (entry) =>
          typeof entry === "string" && entry.toLowerCase() === wanted.toLowerCase()
      )
    }
    return false
  }

  // Flattens JSON-LD payloads: bare nodes, arrays of nodes, and @graph wrappers
  // (recursively, since @graph entries may themselves be arrays).
  const flatten = (value: unknown, depth: number): Record<string, unknown>[] => {
    if (depth > 5 || value === null || typeof value !== "object") return []
    if (Array.isArray(value)) {
      return value.flatMap((entry) => flatten(entry, depth + 1))
    }
    const node = value as Record<string, unknown>
    const nested = "@graph" in node ? flatten(node["@graph"], depth + 1) : []
    return [node, ...nested]
  }

  const findJsonLdJobPosting = (): Record<string, unknown> | undefined => {
    const scripts = Array.from(
      doc.querySelectorAll('script[type="application/ld+json"]')
    )
    for (const script of scripts) {
      let parsed: unknown
      try {
        parsed = JSON.parse(script.textContent ?? "")
      } catch {
        // Malformed JSON-LD is common in the wild; skip the block, never throw.
        continue
      }
      for (const node of flatten(parsed, 0)) {
        if (hasType(node, "JobPosting")) return node
      }
    }
    return undefined
  }

  const meta = (selector: string): string | undefined => {
    const el = doc.querySelector(selector)
    return text(el?.getAttribute("content"))
  }

  /** Visible text of one element, whitespace-collapsed. */
  const elementText = (el: Element | null | undefined): string | undefined => {
    if (!el) return undefined
    const rendered = (el as HTMLElement).innerText
    return text(typeof rendered === "string" ? rendered : el.textContent)
  }

  /**
   * The employer from microdata, for a page with no JSON-LD JobPosting. Kalibrr
   * publishes it as `<meta itemprop="name" content="…">` inside a hidden
   * `[itemprop="hiringOrganization"]`, so the `content` attribute counts as much
   * as the text does.
   */
  const readMicrodataOrganization = (): string | undefined => {
    const named = doc.querySelector('[itemprop="hiringOrganization"] [itemprop="name"]')
    const fromNamed = text(named?.getAttribute("content")) ?? elementText(named)
    if (fromNamed) return fromNamed
    const org = doc.querySelector('[itemprop="hiringOrganization"]')
    const fromOrg = text(org?.getAttribute("content")) ?? elementText(org)
    // The bare element wraps the whole employer block on some boards; only a
    // value short enough to be a name is one.
    if (fromOrg && fromOrg.length <= 100) return fromOrg
    return undefined
  }

  /**
   * "Junior to Mid", "Senior", "Entry Level" — what a board puts in the second
   * segment of "Web Developer | Junior to Mid at Squadzip". It is a seniority
   * band, not an employer, and saving it as one names the wrong company on the
   * job forever. Only ever applied to a company guessed by splitting a heading;
   * a stated employer is never second-guessed.
   */
  const looksLikeSeniorityBand = (value: string): boolean =>
    /^(?:junior|jr|mid|senior|sr|entry|lead|principal|staff|intern|to)\b/i.test(value) ||
    / to /i.test(value)

  /**
   * Whitespace-collapsed, case-insensitive equality. Used to reject a company
   * that is really just the job title said twice: a heading split can hand back
   * the same phrase on both sides of the separator, and saving it names the
   * employer after the role forever. Strict equality only — a company that
   * merely shares words with the title is still a real employer name.
   */
  const sameText = (a: string | undefined, b: string | undefined): boolean => {
    const left = text(a)
    const right = text(b)
    if (!left || !right) return false
    return left.toLowerCase() === right.toLowerCase()
  }

  /** Strips a leading "Location:" style label so a labelled chip is not its own value. */
  const withoutLocationLabel = (value: string): string =>
    value.replace(/^(?:job |work )?(?:location|address)\s*[:：]?\s*/i, "").trim()

  /**
   * Where the job is, for a page that published no JSON-LD `jobLocation` — which
   * is most of the Philippine boards. Tried in descending order of how much the
   * page is actually asserting, and deliberately conservative at every tier: a
   * blank location is something the user can fix in the form before saving, a
   * wrong one quietly mis-ranks the job for the rest of its life.
   */
  const readDomLocation = (): string | undefined => {
    // (b) Microdata — the other structured signal, and as trustworthy as JSON-LD.
    // The itemised address is read first: on Kalibrr the enclosing
    // `[itemprop="jobLocation"]` also contains the hidden microdata spans, so its
    // text reads "…Makati, NCR, PhilippinesMakatiNCRPhilippines". Composing the
    // parts gives the same place said once.
    const addressParts: string[] = []
    for (const prop of ["addressLocality", "addressRegion", "addressCountry"]) {
      const part = elementText(doc.querySelector(`[itemprop="${prop}"]`))
      if (part && part.length <= 80 && !addressParts.includes(part)) addressParts.push(part)
    }
    if (addressParts.length > 0) return addressParts.join(", ").slice(0, 200)

    const itemprop = withoutLocationLabel(
      elementText(doc.querySelector('[itemprop="jobLocation"]')) ?? ""
    )
    if (itemprop.length >= 2 && itemprop.length <= 200) return itemprop

    // (c) A labelled line in the rendered text ("Location: Cagayan de Oro, PH").
    // The 120-character cap is the guard: a prose sentence never reaches the end
    // of its line inside it, so it simply fails to match instead of being stored.
    const body = doc.body
    const rendered = body ? (body as HTMLElement).innerText : undefined
    const bodyText = (typeof rendered === "string" ? rendered : body?.textContent ?? "").slice(
      0,
      100000
    )
    const labelled =
      /^[ \t]*(?:Location|Job Location|Work Location|Address)[ \t]*[:：][ \t]*(.{3,120})$/im.exec(
        bodyText
      )
    if (labelled) {
      const value = text(labelled[1])
      if (value && value.length >= 3) return value.slice(0, 200)
    }

    // (d) The handful of attribute patterns job boards actually use. Only short
    // values are accepted — anything longer is a card, not a location.
    for (const selector of ['[data-testid*="location" i]', '[class*="location" i]']) {
      let nodes: Element[] = []
      try {
        nodes = Array.from(doc.querySelectorAll(selector))
      } catch {
        // An engine without the case-insensitive attribute flag: skip the tier.
        continue
      }
      for (const node of nodes) {
        const raw = elementText(node)
        if (!raw || raw.length > 80) continue
        const value = withoutLocationLabel(raw)
        if (value.length >= 3) return value
      }
    }

    // There is deliberately no `og:locale` tier. It was tried and measured:
    // bossjob.ph — a Philippine board — serves `og:locale: en-us` on every
    // posting, because that tag names the page's *language*, not the job's
    // country. Reading it as a location saved a worldwide-remote posting as
    // "United States", which turned an in-market clip into "US only" and cost
    // it the verdict. An empty location is a blank the user can fill in before
    // saving, and the server already has a better answer for it: an unstated
    // location on a Philippine board reads as in-market from the host alone.
    return undefined
  }

  const result: Partial<ClippedJob> = {}
  const posting = findJsonLdJobPosting()

  if (posting) {
    const jobTitle = text(posting.title) ?? text(posting.name)
    if (jobTitle) result.jobTitle = jobTitle.slice(0, 200)
    const companyName = readOrganization(posting.hiringOrganization)
    if (companyName) result.companyName = companyName.slice(0, 200)
    const location = readLocation(posting.jobLocation)
    if (location) result.location = location
    const salaryAmount = posting.baseSalary ?? posting.estimatedSalary
    const salary = readSalary(salaryAmount)
    if (salary !== undefined) result.salary = salary
    const salaryPeriod = readSalaryPeriod(salaryAmount)
    if (salaryPeriod) result.salaryPeriod = salaryPeriod
    const salaryCurrency = readSalaryCurrency(salaryAmount)
    if (salaryCurrency) result.salaryCurrency = salaryCurrency
    const salaryRangeText = readSalaryRangeText(salaryAmount, salaryPeriod, salaryCurrency)
    if (salaryRangeText) result.salaryRangeText = salaryRangeText
    const jobType = normalizeJobType(posting.employmentType)
    if (jobType) result.jobType = jobType
    const workType = normalizeWorkType(posting.jobLocationType, posting.jobLocation)
    if (workType) result.workType = workType
    const description = stripHtml(posting.description)
    if (description) result.jobDescription = description
    const postedAt = readDate(posting.datePosted)
    if (postedAt) result.postedAt = postedAt
    const deadline = readDate(posting.validThrough)
    if (deadline) result.deadline = deadline
  }

  // --- Fallbacks for anything structured data did not provide -----------------

  const ogTitle = meta('meta[property="og:title"], meta[name="og:title"]')
  const ogSite = meta('meta[property="og:site_name"], meta[name="og:site_name"]')
  const ogDescription = meta(
    'meta[property="og:description"], meta[name="og:description"]'
  )
  const docTitle = text(doc.title)

  // "Title - Company", "Title | Company", "Title at Company", "Title – Company".
  const splitHeading = (
    heading: string | undefined
  ): { title?: string; company?: string } => {
    if (!heading) return {}
    const parts = heading
      .split(/\s+(?:-|\||–|—|·|at)\s+/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
    if (parts.length === 0) return {}
    return { title: parts[0], company: parts[1] }
  }

  const fromOg = splitHeading(ogTitle)
  const fromDoc = splitHeading(docTitle)

  if (!result.jobTitle) {
    const title = fromOg.title ?? fromDoc.title
    if (title) result.jobTitle = title.slice(0, 200)
  }
  if (!result.companyName) {
    const fromSplit = [fromOg.company, fromDoc.company].find(
      (candidate): candidate is string =>
        Boolean(candidate) &&
        !looksLikeSeniorityBand(candidate!) &&
        // The same phrase on both sides of the separator is the title repeated,
        // not an employer. Discarding the candidate leaves the rest of the
        // fallback order (microdata, og:site_name) to answer.
        !sameText(candidate, result.jobTitle)
    )
    // Microdata states the employer; a split heading only guesses at one.
    const company = readMicrodataOrganization() ?? ogSite ?? fromSplit
    if (company) result.companyName = company.slice(0, 200)
  }

  // Runs before the work-type guess below, which reads `result.location`.
  if (!result.location) {
    const location = readDomLocation()
    if (location) result.location = location.slice(0, 200)
  }

  if (!result.jobDescription) {
    let selection: string | undefined
    try {
      selection = text(doc.defaultView?.getSelection()?.toString())
    } catch {
      selection = undefined
    }
    if (selection && selection.length >= MIN_SELECTION) {
      result.jobDescription = selection.slice(0, MAX_DESCRIPTION)
    } else if (ogDescription && ogDescription.length >= MIN_SELECTION) {
      result.jobDescription = ogDescription.slice(0, MAX_DESCRIPTION)
    }
  }

  if (!result.workType) {
    const short = [result.location, result.jobTitle, ogTitle]
      .filter((part): part is string => Boolean(part))
      .join(" ")
    const workType = guessWorkType(short, result.jobDescription ?? "")
    if (workType) result.workType = workType
  }

  // Last line of defence: whichever tier supplied the employer, it is never the
  // job title verbatim. Absent is how every fallback above already represents
  // "no company stated", so the user fills it in before saving.
  if (sameText(result.companyName, result.jobTitle)) delete result.companyName

  return result
}
