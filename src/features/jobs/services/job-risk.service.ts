/**
 * Deterministic ghost-job / scam heuristics. Deliberately dependency-free: this
 * runs on the create path of every tracked job, including the extension route,
 * so it must not drag the AI stack into that module graph, must be fast, and
 * must never be a reason a create fails. The on-demand model assessment lives in
 * `job-risk-ai.service.ts`.
 *
 * Everything here is English-only and intentionally conservative — a false
 * positive costs the user trust in the badge, so weak signals only ever nudge
 * toward LOW on their own.
 */

export type JobRiskLevel = "LOW" | "MEDIUM" | "HIGH"

export interface JobRiskInput {
  jobTitle: string
  companyName: string
  jobDescription?: string | null
  salary?: number | null
  salaryPeriod?: string | null
  jobLink?: string | null
  contact?: string | null
  location?: string | null
}

export interface JobRiskAssessment {
  level: JobRiskLevel
  reasons: string[]
}

/** Score thresholds. Below LOW_THRESHOLD the posting reads as clean. */
const LOW_THRESHOLD = 2
const MEDIUM_THRESHOLD = 4
const HIGH_THRESHOLD = 6

/** The badge is a summary, not a report: more than this is noise. */
const MAX_REASONS = 6

/** Weight per signal class. */
const WEIGHT = {
  payment: 6,
  offPlatform: 5,
  tooGoodToBeTrue: 5,
  personalEmail: 3,
  lookalikeDomain: 3,
  unrelatedApplyHost: 2,
  suspiciousLink: 2,
  vague: 2,
  shouty: 1,
} as const

/** Crypto asset names. Never scored on their own — see `CRYPTO_PAYMENT`. */
const CRYPTO_TERM = String.raw`(?:crypto(?:currency|currencies)?|bitcoin|btc|usdt|usdc|ethereum|eth)`

/**
 * Crypto only counts in a payment context. "Bitcoin exchange" or "Solidity /
 * Ethereum" is an industry a lot of real jobs are in; "paid in bitcoin" is the
 * scam tell.
 */
const CRYPTO_PAYMENT = new RegExp(
  [
    // "paid in crypto", "salary in bitcoin", "payouts are settled in usdt"
    String.raw`\b(?:paid|pay|payment|payments|payout|payouts|salary|salaries|wage|wages|compensation|compensated|settled|remitted|reimbursed|bonus)\b[^.\n]{0,24}\bin\s+${CRYPTO_TERM}\b`,
    // "crypto payment", "bitcoin wallet", "usdt transfer"
    String.raw`\b${CRYPTO_TERM}\s+(?:payment|payments|payout|payouts|wallet|transfer|transfers|deposit)\b`,
    // "receive bitcoin", "send us crypto"
    String.raw`\b(?:receive|receiving|send|sending|transfer|deposit)\s+(?:us\s+|your\s+|the\s+)?${CRYPTO_TERM}\b`,
  ].join("|")
)

/** "Send us money" wording. The single strongest scam tell there is. */
const PAYMENT_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\b(?:upfront|up-front|registration|application|processing|placement|onboarding)\s+fee\b/,
    reason: "The posting mentions an upfront fee",
  },
  {
    re: /\btraining\s+(?:fee|cost|deposit)\b|\bpay\s+for\s+(?:your\s+)?training\b/,
    reason: "The posting asks you to pay for training",
  },
  {
    re: /\b(?:pay|purchase|buy)\s+(?:for\s+)?(?:your\s+own\s+)?(?:equipment|laptop|software|starter\s+kit)\b/,
    reason: "The posting asks you to buy your own equipment",
  },
  {
    re: /\bwire\s+transfer\b|\bwestern\s+union\b|\bmoney\s?gram\b/,
    reason: "The posting mentions wire transfers",
  },
  {
    re: /\bgift\s+cards?\b/,
    reason: "The posting mentions gift cards",
  },
  {
    // Bare "bitcoin"/"crypto" is an industry, not a red flag — a Solidity role
    // at an exchange says it constantly. Only the payment framing scores.
    re: CRYPTO_PAYMENT,
    reason: "The posting mentions crypto payments",
  },
  {
    re: /\b(?:bank\s+account|routing|social\s+security)\s+(?:number|details|info(?:rmation)?)\b/,
    reason: "The posting asks for bank or SSN details up front",
  },
]

/** Recruiters who want you off the job board before you can verify them. */
const OFF_PLATFORM_APPS = /\b(whats\s?app|telegram|signal\s+app)\b/
/** "text me on +1 555…" / "@handle on telegram" style handoffs. */
const MESSAGING_HANDOFF =
  /\b(?:whats\s?app|telegram|signal)\b[^.\n]{0,40}(?:\+?\d[\d\s().-]{7,}|@[a-z0-9_.]{3,})/

const PERSONAL_EMAIL =
  /[a-z0-9._%+-]+@(gmail|outlook|hotmail|yahoo|proton(?:mail)?|aol|ymail|live|icloud)\.[a-z.]{2,}/

const NO_EXPERIENCE =
  /\bno\s+(?:prior\s+)?experience\s+(?:is\s+)?(?:needed|required|necessary)\b|\bno\s+experience\s+necessary\b|\bzero\s+experience\b/

/** "earn $500 per day from home" and friends. */
const EARN_PER_PERIOD =
  /\b(?:earn|make|get\s+paid)\s+(?:up\s+to\s+)?[$€£]?\s?[\d,]{3,}\s*(?:usd|dollars?)?\s*(?:per|a|\/)\s*(?:day|week)\b/

const GRAND_CLAIMS: Array<{ re: RegExp; label: string }> = [
  { re: /\bunlimited\s+(?:earning|income|earnings|potential)\b/, label: "unlimited earnings" },
  { re: /\bhiring\s+immediately\b|\bimmediate\s+(?:start|hiring)\b/, label: "immediate hiring" },
  { re: /\burgent(?:ly)?\s+(?:requirement|hiring|need(?:ed)?)\b|\burgent\s+vacancy\b/, label: "urgency" },
  { re: /\bwork\s+from\s+home\b[^.\n]{0,30}\bno\s+experience\b/, label: "work-from-home with no experience" },
  { re: /\beasy\s+money\b|\bquick\s+cash\b/, label: "easy money" },
]

/** Anything shorter than this is not a real job description. */
const SHORT_DESCRIPTION = 200

const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "bitly.com",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
  "rb.gy",
  "s.id",
  // No lnkd.in: it is LinkedIn's own short domain and appears in ordinary
  // postings far more often than in scams.
  "tiny.cc",
])

const IP_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/

/**
 * Hosts that legitimately serve an apply link for a company they have no name in
 * common with. Matched as a substring so `boards.greenhouse.io` and
 * `acme.wd1.myworkdayjobs.com` both pass — deliberately permissive, because the
 * cost of missing a board here is a false "unrelated link" flag.
 */
const JOB_BOARD_HOSTS = [
  "linkedin.",
  // LinkedIn's own short domain, deliberately not treated as a shortener above.
  "lnkd.in",
  "indeed.",
  "greenhouse.io",
  "lever.co",
  "workday",
  "myworkdayjobs",
  "ashbyhq",
  "glassdoor.",
  "ziprecruiter.",
  "wellfound.",
  "angel.co",
  "jobvite",
  "icims",
  "smartrecruiters",
  "bamboohr",
] as const

/**
 * Words that carry no identity on their own, so they can never be the token a
 * domain is matched against. "Global Solutions Group" must not make
 * `global-jobs.com` look like a match — or a lookalike.
 */
const GENERIC_COMPANY_WORDS = new Set([
  "inc",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "company",
  "co",
  "gmbh",
  "plc",
  "the",
  "and",
  "group",
  "holdings",
  "global",
  "international",
  "technologies",
  "technology",
  "tech",
  "labs",
  "lab",
  "solutions",
  "services",
  "systems",
  "digital",
  "consulting",
  "partners",
  "ventures",
  "agency",
  "staffing",
  "recruiting",
  "recruitment",
  "talent",
])

/**
 * Shortest company token worth matching a domain against. Under this, initialisms
 * ("IBM", "SAP") collide with far too many unrelated domains.
 */
const MIN_COMPANY_TOKEN = 4

/**
 * Suffixes a scam domain bolts onto a real company name. Used to keep the
 * lookalike check off ordinary coincidences: "Meta" vs `metabase.com` is a
 * different company, `meta-careers.com` is an impersonation.
 */
const IMPERSONATION_SUFFIX =
  /^(?:careers?|hr|jobs?|recruit(?:ing|ment)?|hiring|talent|apply|team|official|support|group|inc|llc|corp|global|intl)$/

/** Any email address in the text, used to read the domain the recruiter writes from. */
const ANY_EMAIL = /[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/g

/**
 * Salary above which "no experience required" stops being plausible, per
 * period. Anything not listed here is not scored.
 */
const IMPLAUSIBLE_SALARY: Record<string, number> = {
  HOURLY: 80,
  DAILY: 800,
  WEEKLY: 4000,
  MONTHLY: 12000,
  YEARLY: 200000,
}

/**
 * Scores the deterministic scam / ghost-job signals in a posting.
 *
 * Returns `null` when nothing suspicious was found, so callers can skip writing
 * risk columns entirely for the overwhelmingly common clean posting.
 */
export function assessJobRiskHeuristics(input: JobRiskInput): JobRiskAssessment | null {
  const description = (input.jobDescription ?? "").trim()
  const lowerDescription = description.toLowerCase()
  const lowerContact = (input.contact ?? "").toLowerCase()
  const haystack = `${lowerDescription}\n${lowerContact}`

  let score = 0
  const reasons: string[] = []

  const add = (points: number, reason: string) => {
    score += points
    if (!reasons.includes(reason)) reasons.push(reason)
  }

  // ── Payment / fee red flags ───────────────────────────────────────────
  for (const { re, reason } of PAYMENT_PATTERNS) {
    if (re.test(haystack)) add(WEIGHT.payment, reason)
  }

  // ── Off-platform contact push ─────────────────────────────────────────
  if (MESSAGING_HANDOFF.test(haystack) || OFF_PLATFORM_APPS.test(lowerContact)) {
    add(WEIGHT.offPlatform, "Pushes contact to WhatsApp, Telegram or Signal")
  }

  // ── Personal-email recruiter ──────────────────────────────────────────
  if (PERSONAL_EMAIL.test(lowerContact)) {
    add(WEIGHT.personalEmail, "Recruiter uses a personal email address, not a company domain")
  }

  // ── Recruiter domain impersonating the company ────────────────────────
  // Worse than a personal email: `google-careers-hr.com` is built to read as the
  // real thing, so it scores separately and can stack with it.
  const companyTokens = significantCompanyTokens(input.companyName)
  if (companyTokens.length > 0 && emailDomainsIn(haystack).some((domain) =>
    isLookalikeDomain(domain, companyTokens)
  )) {
    add(WEIGHT.lookalikeDomain, "Recruiter email domain imitates the company name")
  }

  // ── Too good to be true ───────────────────────────────────────────────
  const noExperience = NO_EXPERIENCE.test(lowerDescription)
  const salaryCeiling = input.salaryPeriod
    ? IMPLAUSIBLE_SALARY[input.salaryPeriod.toUpperCase()]
    : undefined

  if (
    noExperience &&
    typeof input.salary === "number" &&
    salaryCeiling !== undefined &&
    input.salary > salaryCeiling
  ) {
    add(WEIGHT.tooGoodToBeTrue, "Unusually high pay for a role that asks for no experience")
  }

  if (EARN_PER_PERIOD.test(lowerDescription)) {
    add(WEIGHT.tooGoodToBeTrue, "Advertises a fixed daily or weekly payout")
  }

  // ── Vagueness / ghost-job signals ─────────────────────────────────────
  const claims = GRAND_CLAIMS.filter(({ re }) => re.test(lowerDescription)).map((c) => c.label)
  // One "hiring immediately" is ordinary job-board copy; two or more stacked
  // claims is the pattern that actually separates a scam ad from a real one.
  if (claims.length >= 2) {
    add(
      WEIGHT.vague,
      `Leans on ${claims.slice(0, 2).join(" and ")} language instead of role detail`
    )
  }

  if (description.length > 0 && description.length < SHORT_DESCRIPTION && claims.length > 0) {
    add(WEIGHT.vague, "Very short description with big promises and no role detail")
  }

  // ── Shouty formatting ─────────────────────────────────────────────────
  const title = input.jobTitle ?? ""
  const titleLetters = title.replace(/[^a-z]/gi, "")
  if (titleLetters.length >= 6 && titleLetters === titleLetters.toUpperCase()) {
    add(WEIGHT.shouty, "Job title is written in all caps")
  }

  const emojiCount = countEmoji(`${title} ${description}`)
  const bangCount = (`${title} ${description}`.match(/!/g) ?? []).length
  if (emojiCount >= 3 || bangCount >= 5) {
    add(WEIGHT.shouty, "Heavy use of emoji or exclamation marks")
  }

  // ── Suspicious apply link ─────────────────────────────────────────────
  const host = hostOf(input.jobLink)
  if (host) {
    if (SHORTENER_HOSTS.has(host)) {
      add(WEIGHT.suspiciousLink, "Apply link goes through a URL shortener")
    } else if (IP_HOST.test(host)) {
      add(WEIGHT.suspiciousLink, "Apply link points at a raw IP address")
    } else if (
      // Only checked when the link is otherwise ordinary — a shortener already
      // scored above, and one link should not be charged twice.
      companyTokens.length > 0 &&
      !isJobBoardHost(host) &&
      !companyTokens.some((token) => host.replace(/[^a-z0-9]/g, "").includes(token))
    ) {
      add(
        WEIGHT.unrelatedApplyHost,
        "Application link doesn't match the company or a known job board"
      )
    }
  }

  if (score < LOW_THRESHOLD || reasons.length === 0) return null

  const level: JobRiskLevel =
    score >= HIGH_THRESHOLD ? "HIGH" : score >= MEDIUM_THRESHOLD ? "MEDIUM" : "LOW"

  return { level, reasons: reasons.slice(0, MAX_REASONS) }
}

/**
 * The parts of a company name that actually identify it: long enough to be
 * distinctive, and not a legal or industry filler word. Empty when the name is
 * only initialisms or generic words, which is the signal to skip both
 * domain checks rather than guess.
 */
function significantCompanyTokens(companyName: string | null | undefined): string[] {
  if (!companyName) return []
  return companyName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_COMPANY_TOKEN && !GENERIC_COMPANY_WORDS.has(token))
}

/** Every email domain in the text, lowercased and deduped. */
function emailDomainsIn(text: string): string[] {
  const domains = new Set<string>()
  for (const match of text.matchAll(ANY_EMAIL)) {
    domains.add(match[1].toLowerCase())
  }
  return [...domains]
}

/**
 * True when a domain wraps a company token in extra characters — the shape of an
 * impersonation (`google-careers-hr.com`) rather than the real domain
 * (`google.com`) or an unrelated company that merely shares a prefix
 * (`metabase.com`).
 */
function isLookalikeDomain(domain: string, companyTokens: string[]): boolean {
  const label = domain.split(".")[0]
  if (!label) return false

  // The company's own domain is the thing being imitated, not the imitation —
  // including the hyphenated spelling of a multi-word name (`coca-cola` for
  // "Coca Cola"). Only hyphens are stripped for this comparison, so padding
  // (`coca-cola-careers`, `cocacola-hr`) and digits (`coca-cola7`) still read as
  // an impersonation.
  if (label.replace(/-/g, "") === companyTokens.join("")) return false

  return companyTokens.some((token) => {
    if (label === token) return false
    if (!label.includes(token)) return false

    const extra = label.split(token)
    // A hyphen or digit bolted on is the tell; an unbroken word that merely
    // starts with the token is a different company far more often than a scam.
    if (/[-\d]/.test(label)) return true
    return extra.some((part) => IMPERSONATION_SUFFIX.test(part))
  })
}

/** True when the host belongs to a job board that legitimately hosts any company's posting. */
function isJobBoardHost(host: string): boolean {
  return JOB_BOARD_HOSTS.some((board) => host.includes(board))
}

/** Emoji and pictographs, counted without relying on a Unicode property escape. */
function countEmoji(text: string): number {
  const matches = text.match(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu
  )
  return matches?.length ?? 0
}

/** Lowercased host of a URL, or null when it is not parseable. */
function hostOf(link: string | null | undefined): string | null {
  if (!link) return null
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}
