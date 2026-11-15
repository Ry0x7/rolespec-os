import type { ExperienceLevel, WorkType } from "@/generated/prisma/enums"
import {
  extractJobRequirements,
  JOB_REQUIREMENT_FLAGS,
  type JobRequirementFlag,
} from "@/features/jobs/services/job-requirements.service"
import {
  assessJobRiskHeuristics,
  type JobRiskLevel,
} from "@/features/jobs/services/job-risk.service"

import {
  classifyMarketFit,
  resolveProfileMarketName,
  type MarketFitResult,
} from "./market-fit.service"

/**
 * Deterministic qualification of a discovered posting against the user's Career
 * Profile: `Worth it? → Eligible? → Match? → Risk? → What next?`.
 *
 * Deliberately AI-free. This runs for every candidate of every discovery run,
 * before the user has decided anything is worth a token, so it must be fast,
 * pure and offline. The expensive per-job analysis (`analyzeJobMatchAI`,
 * `assessJobRiskAI`) stays where it is — on a job the user already saved.
 *
 * Two invariants shape the whole file:
 *
 * - Posting text is never evidence of the user's qualifications. "Match?" only
 *   ever reports which capabilities *the profile already holds* are mentioned
 *   by the posting; it can never add one, and a posting that lists a skill the
 *   user does not have does not give it to them.
 * - A false BLOCKED is the expensive mistake — it hides a job the user could
 *   have taken. Only a stated requirement the profile directly contradicts
 *   blocks; everything softer is a CONCERN the user can read and overrule.
 */

/** How one of the four questions came back. */
export type QualificationSignal = "GOOD" | "NEUTRAL" | "CONCERN" | "BLOCKER"

/** The overall read, and the order candidates are worth looking at in. */
export type QualificationVerdict = "STRONG" | "WORTH_A_LOOK" | "WEAK" | "BLOCKED"

/**
 * A check a step wanted to run and had no posting data for. "The posting never
 * said" is not the same answer as "checked, and it is fine", and the difference
 * is what stops an unknown from reading as a strong fit.
 */
export type QualificationUnchecked = "work-mode" | "location" | "requirements"

export interface QualificationStep {
  signal: QualificationSignal
  /** Plain sentences, already user-facing. Empty means "nothing to say". */
  reasons: string[]
  /** Omitted when the step could run every check it wanted to. */
  unchecked?: QualificationUnchecked[]
}

export interface QualificationMatchStep extends QualificationStep {
  /** Profile capabilities this posting mentions, in profile order. */
  matched: string[]
  /** How many of `matched` the user has explicitly confirmed. */
  confirmedCount: number
}

export interface QualificationRiskStep extends QualificationStep {
  /** Null when the heuristics had nothing to score. */
  level: JobRiskLevel | null
}

export interface Qualification {
  /** Worth it? — does this posting fit what the user said they want. */
  worthIt: QualificationStep
  /** Eligible? — do the posting's stated requirements rule the user out. */
  eligible: QualificationStep
  /** Match? — which of the user's capabilities this posting asks for. */
  match: QualificationMatchStep
  /** Risk? — the same ghost-job/scam heuristics a saved job gets. */
  risk: QualificationRiskStep
  verdict: QualificationVerdict
  /** What next? — one sentence telling the user what to do with this row. */
  nextAction: string
  /** The eligibility requirements the posting stated, for the badge row. */
  requirementFlags: JobRequirementFlag[]
  /** Where this posting will consider candidates from, read from its location. */
  marketFit: MarketFitResult
  /**
   * Whether sponsorship is still an open question here. Optional so a stored
   * snapshot written before this existed still parses; absent means "unknown",
   * which readers treat the same as the old flag-only behaviour.
   */
  sponsorshipRelevant?: boolean
}

/**
 * The slice of a Career Profile this needs. A structural subset rather than
 * `LoadedCareerProfile` so the function stays pure and testable, and so a
 * profile read that returns less than the full include cannot crash a run.
 */
export interface QualificationProfile {
  targetRoleTitles: string[]
  locations: string[]
  openToRelocation: boolean
  workModes: WorkType[]
  /** Tri-state: null means the user has not answered, which never blocks. */
  requiresSponsorship: boolean | null
  /** Null means the user has not answered, which never penalizes a posting. */
  experienceLevel: ExperienceLevel | null
  capabilities: Array<{ name: string; confirmed: boolean }>
}

/** The slice of a normalized posting this needs. */
export interface QualificationPosting {
  title: string
  companyName: string
  url: string
  location?: string
  workType?: WorkType
  salaryText?: string
  description?: string
}

/** Human wording for the work modes, so reasons read as sentences. */
const WORK_MODE_LABEL: Record<WorkType, string> = {
  REMOTE: "remote",
  HYBRID: "hybrid",
  ONSITE: "onsite",
}

/**
 * Location strings that mean "location is not a constraint". A posting that
 * says one of these can never fail the location check.
 */
const OPEN_LOCATION_WORDS = ["remote", "anywhere", "worldwide", "global"]

/** Below this length a capability name matches too much to be worth reporting. */
const MIN_CAPABILITY_LENGTH = 2

/**
 * Filler that carries no role meaning. Without this, a target role of "Head of
 * Design" would match "VP of Sales" on the word "of" alone.
 */
const ROLE_STOPWORDS = new Set([
  "of",
  "and",
  "the",
  "a",
  "an",
  "in",
  "for",
  "to",
  "at",
  "sr",
  "jr",
  "senior",
  "junior",
  "mid",
  "lead",
  "staff",
  "principal",
  "i",
  "ii",
  "iii",
])

/** Seniority as an order, so "above the user's level" is a comparison. */
const EXPERIENCE_LEVEL_RANK: Record<ExperienceLevel, number> = {
  JUNIOR: 0,
  MID: 1,
  SENIOR: 2,
  LEAD: 3,
  EXECUTIVE: 4,
}

/** Human wording for the levels, so reasons read as sentences. */
const EXPERIENCE_LEVEL_LABEL: Record<ExperienceLevel, string> = {
  JUNIOR: "Junior",
  MID: "Mid",
  SENIOR: "Senior",
  LEAD: "Lead",
  EXECUTIVE: "Executive",
}

/**
 * Whole-token phrases a title uses to announce its level. Matched on the same
 * tokenizer as everything else, so "senior" cannot hit "seniority" and "lead"
 * cannot hit "leadership" — a title that happens to say "Lead Generation" is a
 * knowingly accepted false positive, since only the word boundary is checked.
 */
const TITLE_SENIORITY_MARKERS: Array<{ phrase: string; level: ExperienceLevel }> = [
  { phrase: "intern", level: "JUNIOR" },
  { phrase: "internship", level: "JUNIOR" },
  { phrase: "entry level", level: "JUNIOR" },
  { phrase: "junior", level: "JUNIOR" },
  { phrase: "jr", level: "JUNIOR" },
  { phrase: "graduate", level: "JUNIOR" },
  { phrase: "senior", level: "SENIOR" },
  { phrase: "sr", level: "SENIOR" },
  { phrase: "staff", level: "LEAD" },
  { phrase: "principal", level: "LEAD" },
  { phrase: "lead", level: "LEAD" },
  { phrase: "head of", level: "LEAD" },
  { phrase: "director", level: "EXECUTIVE" },
  { phrase: "vp", level: "EXECUTIVE" },
  { phrase: "vice president", level: "EXECUTIVE" },
  { phrase: "chief", level: "EXECUTIVE" },
  { phrase: "cto", level: "EXECUTIVE" },
  { phrase: "cio", level: "EXECUTIVE" },
  { phrase: "executive", level: "EXECUTIVE" },
  // German titles. Diacritics are folded before matching (see
  // `seniorityFromTitle`), so these are spelled in their folded ASCII form.
  { phrase: "praktikant", level: "JUNIOR" },
  { phrase: "praktikantin", level: "JUNIOR" },
  { phrase: "praktikum", level: "JUNIOR" },
  { phrase: "werkstudent", level: "JUNIOR" },
  { phrase: "werkstudentin", level: "JUNIOR" },
  { phrase: "trainee", level: "JUNIOR" },
  { phrase: "leiter", level: "LEAD" },
  { phrase: "leiterin", level: "LEAD" },
  { phrase: "teamleiter", level: "LEAD" },
  { phrase: "teamleiterin", level: "LEAD" },
  { phrase: "bereichsleiter", level: "LEAD" },
  { phrase: "bereichsleiterin", level: "LEAD" },
  { phrase: "geschaeftsfuehrer", level: "EXECUTIVE" },
  { phrase: "geschaeftsfuehrerin", level: "EXECUTIVE" },
]

/**
 * A stated years-of-experience number, e.g. "8 years", "9+ yrs", "3-5 years",
 * "3 Jahre", "mindestens 5 Jahren".
 */
const YEARS_OF_EXPERIENCE = /(\d{1,2})\s*\+?\s*(?:years?|yrs?|jahren|jahre|jahr)\b/gi

/** How far either side of that number the word "experience" still counts. */
const YEARS_EXPERIENCE_WINDOW = 60

/**
 * The words that make a number nearby a years-of-experience bar rather than a
 * company statistic. "erfahrung" covers "Berufserfahrung" as a substring.
 */
const YEARS_EXPERIENCE_WORDS = ["experience", "erfahrung"]

/** Confirmed capabilities a posting must mention before "Match?" reads GOOD. */
const STRONG_MATCH_CONFIRMED = 3

/**
 * Confirmed capabilities an *adjacent* title needs before it can still read
 * STRONG. A title that only shares a generic word with a target role ("Data
 * Engineer" vs "Software Engineer") is not evidence of a fit by itself, so the
 * posting has to earn the top band on the capabilities it actually names.
 */
const RELATED_TITLE_CONFIRMED = 2

/**
 * The generic tokens that still name a *kind of work*. Sharing one of these is
 * what makes a title adjacent: "Data Engineer" and "Software Engineer" are two
 * engineering jobs. Sharing "senior", "remote" or "urgent" is not adjacency —
 * it is two postings using the same filler, and the posting is then unrelated.
 */
const GENERIC_ROLE_NOUNS = new Set([
  "engineer",
  "developer",
  "programmer",
  "analyst",
  "specialist",
  "consultant",
  "architect",
  "administrator",
  "technician",
  "designer",
  "manager",
  "lead",
  "intern",
  "assistant",
  "coordinator",
  "tester",
])

/**
 * Title words that carry no role identity: every second posting says them, so a
 * title sharing only these with a target role has not matched it.
 *
 * `ROLE_STOPWORDS` is folded in, so seniority and filler live in one place, and
 * so is {@link GENERIC_ROLE_NOUNS} — a role noun is generic by definition; it
 * is only kept as its own set because sharing one is the difference between
 * "adjacent" and "unrelated".
 */
const GENERIC_TITLE_TOKENS = new Set([
  ...ROLE_STOPWORDS,
  ...GENERIC_ROLE_NOUNS,
  "engineering",
  "development",
  "software",
  "associate",
  "internship",
  "remote",
  "onsite",
  "hybrid",
  "urgent",
  "urgently",
  "needed",
  "now",
  "hiring",
  "apply",
  "part",
  "time",
  "full",
  "contract",
  "contractor",
  "freelance",
  "va",
  "virtual",
  "job",
  "role",
  "position",
  "with",
  "or",
  "on",
])

/** How close a posting title is to something the user said they are looking for. */
export type TitleRelevance = "MATCH" | "RELATED" | "UNRELATED"

/**
 * Builds the profile slice from whatever `loadCareerProfile` returned. Every
 * field is optional on the way in: a partial profile degrades to fewer answers,
 * never to a thrown run.
 */
export function toQualificationProfile(profile: {
  targetRoles?: Array<{ title: string; active: boolean }> | null
  locations?: string[] | null
  openToRelocation?: boolean | null
  workModes?: WorkType[] | null
  requiresSponsorship?: boolean | null
  experienceLevel?: ExperienceLevel | null
  capabilities?: Array<{ name: string; confirmed: boolean }> | null
}): QualificationProfile {
  return {
    targetRoleTitles: (profile.targetRoles ?? [])
      .filter((role) => role.active)
      .map((role) => role.title),
    locations: profile.locations ?? [],
    openToRelocation: profile.openToRelocation ?? false,
    workModes: profile.workModes ?? [],
    requiresSponsorship: profile.requiresSponsorship ?? null,
    experienceLevel: profile.experienceLevel ?? null,
    capabilities: profile.capabilities ?? [],
  }
}

/**
 * Qualifies one posting. Pure, order-stable and total: any posting/profile pair
 * produces a verdict, and an empty profile simply produces a NEUTRAL one.
 */
export function qualifyCandidate(
  posting: QualificationPosting,
  profile: QualificationProfile
): Qualification {
  const requirementFlags = safeRequirements(posting)

  // Where the posting will consider candidates from, read once and used by both
  // "Worth it?" (it is the location check) and "Eligible?" (an explicit
  // restriction is an eligibility fact, not a preference miss).
  const marketFit = classifyMarketFit(
    {
      location: posting.location ?? null,
      workTypeHint: posting.workType ?? null,
      description: posting.description ?? null,
      // Last-resort market hint when the posting states no location at all.
      url: posting.url || null,
    },
    { locations: profile.locations, openToRelocation: profile.openToRelocation }
  )

  const worthItResult = assessWorthIt(posting, profile, marketFit)
  const eligibleResult = assessEligibility(
    posting,
    requirementFlags,
    profile,
    marketFit,
    resolveProfileMarketName(profile.locations)
  )
  const match = assessMatch(posting, profile)
  const risk = assessRisk(posting)

  const worthIt = worthItResult.step
  const eligible = withMarketRestriction(
    eligibleResult.step,
    marketFit,
    profile.openToRelocation,
    eligibleResult.sponsorshipConfirmed
  )

  const verdict = decideVerdict(
    { worthIt, eligible, match, risk },
    {
      preferenceFitConfirmed: worthItResult.preferenceFitConfirmed,
      locationFitConfirmed: worthItResult.locationFitConfirmed,
      preferenceConcerns: worthItResult.preferenceConcerns,
      sponsorshipConfirmed: eligibleResult.sponsorshipConfirmed,
      requiresSponsorship: profile.requiresSponsorship,
      marketFit: marketFit.fit,
      openToRelocation: profile.openToRelocation,
      titleRelated: worthItResult.titleRelated,
      titleUnrelated: worthItResult.titleUnrelated,
    }
  )

  return {
    worthIt,
    eligible,
    match,
    risk,
    verdict,
    nextAction: decideNextAction(verdict, { worthIt, eligible, match, risk }),
    requirementFlags,
    marketFit,
    sponsorshipRelevant: eligibleResult.sponsorshipRelevant,
  }
}

/**
 * A posting that states it only hires somewhere the user is not is an
 * eligibility fact, so it is said in the eligibility step rather than buried in
 * preferences. It still never blocks: the string is free text from a job board,
 * and free text is not precise enough to tell someone they may not apply.
 *
 * A user who would relocate hears the same fact with the consequence they
 * actually face — a move and a work-authorization question — rather than being
 * told the posting is out of reach.
 */
function withMarketRestriction(
  step: QualificationStep,
  marketFit: MarketFitResult,
  openToRelocation: boolean,
  sponsorshipConfirmed: boolean
): QualificationStep {
  if (marketFit.fit !== "RESTRICTED") return step

  const where = marketFit.restrictedTo ?? "another region"

  // A user who would move, reading a posting that has already said it sponsors,
  // has both halves of the answer. Nothing is outstanding, so this is a note
  // about the move rather than a mark against the posting — and the posting can
  // still read STRONG on the strength of everything else.
  if (openToRelocation && sponsorshipConfirmed) {
    return {
      ...step,
      reasons: [
        ...step.reasons,
        `Limited to ${where} — you're open to relocation and the posting mentions sponsorship.`,
      ],
    }
  }

  const reason = openToRelocation
    ? `Limited to ${where} — you're open to relocation; check sponsorship.`
    : marketFit.reason

  return {
    ...step,
    signal: step.signal === "BLOCKER" ? "BLOCKER" : "CONCERN",
    reasons: [...step.reasons, reason],
  }
}

/**
 * Requirement extraction is regex-only and does not throw today, but it runs on
 * every candidate of every run: one unlucky posting must never cost the user
 * the whole list, so a throw degrades to "the posting stated nothing".
 */
function safeRequirements(posting: QualificationPosting): JobRequirementFlag[] {
  try {
    return extractJobRequirements({
      jobDescription: posting.description,
      location: posting.location,
    })
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Worth it?
// ---------------------------------------------------------------------------

/**
 * The step, plus what it managed to *confirm* rather than merely not flag. The
 * verdict needs the difference; the user-facing step does not carry it.
 */
interface WorthItResult {
  step: QualificationStep
  /** True when work mode or location was checked against the profile and fit. */
  preferenceFitConfirmed: boolean
  /** True when the posting is open/remote, or sits in a preferred location. */
  locationFitConfirmed: boolean
  /**
   * How many of the two hard preferences (work mode, location) the posting
   * stated and missed. The step can only carry one CONCERN, but missing both is
   * a worse posting than missing one, so the verdict is told the count.
   */
  preferenceConcerns: number
  /** True when the title only shares a generic role noun with a target role. */
  titleRelated: boolean
  /** True when the title shares nothing role-bearing with any target role. */
  titleUnrelated: boolean
}

/**
 * Preference fit: work mode, location and how close the title is to a role the
 * user is actually targeting.
 *
 * Salary is deliberately not scored. Providers publish it as free text
 * ("competitive", "$60k–$80k DOE", "€ 55.000"), and a misparsed number that
 * demotes a well-paid job is worse than no answer at all — the salary text is
 * shown to the user verbatim instead.
 */
function assessWorthIt(
  posting: QualificationPosting,
  profile: QualificationProfile,
  marketFit: MarketFitResult
): WorthItResult {
  const reasons: string[] = []
  const unchecked: QualificationUnchecked[] = []
  let concerns = 0
  let goods = 0
  let workModeFitConfirmed = false
  let locationFitConfirmed = false
  let preferenceConcerns = 0

  // Work mode is only answerable when the posting published one. Arbeitnow and
  // the ATS boards routinely publish none, and an unstated mode is not evidence
  // that it is the one the user asked for.
  const workModeUnwanted = Boolean(
    posting.workType && profile.workModes.length > 0 && !profile.workModes.includes(posting.workType)
  )
  if (profile.workModes.length > 0) {
    if (!posting.workType) {
      unchecked.push("work-mode")
    } else if (profile.workModes.includes(posting.workType)) {
      goods += 1
      workModeFitConfirmed = true
      reasons.push(`${capitalize(WORK_MODE_LABEL[posting.workType])} matches your preference.`)
    } else {
      concerns += 1
      preferenceConcerns += 1
      reasons.push(
        `Posted as ${WORK_MODE_LABEL[posting.workType]}; you prefer ${profile.workModes
          .map((mode) => WORK_MODE_LABEL[mode])
          .join(" or ")}.`
      )
    }
  }

  // Only a location-bound posting can miss on location; a remote one cannot.
  const postingIsOpen =
    posting.workType === "REMOTE" || mentionsOpenLocation(posting.location)
  if (
    marketFit.fit === "IN_MARKET" ||
    marketFit.fit === "REGION" ||
    marketFit.fit === "OPEN"
  ) {
    // The market classifier answers the same question this step used to ask of
    // the raw string, and answers it with a sentence the user can read. Only
    // IN_MARKET counts as a positive the verdict can lean on: "open to
    // everyone" is the absence of a constraint, not evidence of a fit.
    locationFitConfirmed = true
    if (marketFit.fit === "IN_MARKET") goods += 1
    reasons.push(marketFit.reason)
  } else if (postingIsOpen) {
    locationFitConfirmed = true
  } else if (profile.locations.length > 0) {
    if (!posting.location) {
      unchecked.push("location")
    } else if (matchesAnyLocation(posting.location, profile.locations)) {
      goods += 1
      locationFitConfirmed = true
      reasons.push(`${posting.location} is one of your preferred locations.`)
    } else if (profile.openToRelocation && !workModeUnwanted) {
      // Being open to relocation answers a distant posting — but only one the
      // user could actually take. A posting whose stated work mode is already
      // one they did not ask for is not rescued by their willingness to move.
      reasons.push(
        `${posting.location} is outside your preferred locations, but you are open to relocation.`
      )
    } else {
      concerns += 1
      preferenceConcerns += 1
      reasons.push(`${posting.location} is outside your preferred locations.`)
    }
  }

  if (unchecked.length > 0) {
    const missing = unchecked.includes("work-mode")
      ? unchecked.includes("location")
        ? "location or work mode"
        : "work mode"
      : "location"
    reasons.push(`Couldn't check ${missing} from this posting — it does not say.`)
  }

  // The title, read for the words that identify a role rather than for any
  // shared word. An adjacent title is said plainly and costs the posting
  // nothing here — it only has to earn the top band on capabilities instead.
  let titleRelated = false
  let titleUnrelated = false
  if (profile.targetRoleTitles.length > 0) {
    const relevance = titleRelevance(posting.title, profile.targetRoleTitles)
    if (relevance === "MATCH") {
      goods += 1
    } else if (relevance === "RELATED") {
      titleRelated = true
      const adjacent = relatedTargetRole(posting.title, profile.targetRoleTitles)
      reasons.push(
        adjacent
          ? `Title is adjacent to your target roles (${adjacent}).`
          : "Title is adjacent to your target roles."
      )
    } else {
      concerns += 1
      titleUnrelated = true
      reasons.push("Title doesn't match your target roles.")
    }
  }

  // Seniority, and only in one direction: a posting pitched above the user's
  // level is the one that wastes their time. A posting below it is still
  // theirs to take, an unanswered profile level says nothing about them, and a
  // posting that announces no level is not evidence of one either — the same
  // tri-state rule `requiresSponsorship` follows.
  const postingLevel = profile.experienceLevel ? inferPostingSeniority(posting) : null
  if (
    profile.experienceLevel &&
    postingLevel &&
    EXPERIENCE_LEVEL_RANK[postingLevel] > EXPERIENCE_LEVEL_RANK[profile.experienceLevel] &&
    // An active target role that names that level is the user saying they want
    // it, which outranks the level they filled in once on the profile form.
    !targetRolesReachLevel(profile.targetRoleTitles, postingLevel)
  ) {
    concerns += 1
    reasons.push(
      `Looks like a ${EXPERIENCE_LEVEL_LABEL[postingLevel]}-level role; your profile targets ${EXPERIENCE_LEVEL_LABEL[profile.experienceLevel]}.`
    )
  }

  // A step that could not run one of its checks cannot read GOOD: a green dot
  // over "couldn't check work mode" would be the same lie the verdict cap
  // exists to stop.
  const signal: QualificationSignal =
    concerns > 0 ? "CONCERN" : goods > 0 && unchecked.length === 0 ? "GOOD" : "NEUTRAL"

  return {
    step: { signal, reasons, ...(unchecked.length > 0 && { unchecked }) },
    preferenceFitConfirmed: workModeFitConfirmed || locationFitConfirmed,
    locationFitConfirmed,
    preferenceConcerns,
    titleRelated,
    titleUnrelated,
  }
}

// ---------------------------------------------------------------------------
// Eligible?
// ---------------------------------------------------------------------------

/** The step, plus whether the posting actually settled the sponsorship question. */
interface EligibilityResult {
  step: QualificationStep
  /** True only when the posting states sponsorship is available. */
  sponsorshipConfirmed: boolean
  /**
   * True when sponsorship is still an open question for this user and posting.
   * False when they do not need it, or when the posting is silent and hires
   * where they already are — a remote-worldwide or Philippines-open role does
   * not raise a visa question, so nothing should imply one.
   */
  sponsorshipRelevant: boolean
}

/**
 * Market fits that answer the sponsorship question by themselves: the posting
 * will consider someone working from where the user already is, so a visa is
 * not what stands between them and it.
 */
const SPONSORSHIP_MOOT_FITS: ReadonlyArray<MarketFitResult["fit"]> = [
  "IN_MARKET",
  "OPEN",
  "REGION",
]

/**
 * The neutral note that replaces "check before you apply" when the posting
 * hires where the user is. `market` is the profile's resolved country, said the
 * way a sentence needs it ("the Philippines"), or null when this build does not
 * recognise one.
 */
function sponsorshipMootNote(fit: MarketFitResult["fit"], market: string | null): string {
  if (fit === "OPEN") return "Remote worldwide — sponsorship is unlikely to apply."
  if (fit === "REGION") {
    return "Regional remote role — sponsorship is unlikely to apply; confirm if unsure."
  }
  return market
    ? `Sponsorship isn't a factor — the role is open to candidates in ${market}.`
    : "Sponsorship isn't a factor — the role is open to candidates where you are."
}

/**
 * The posting's stated requirements read against the profile's work-authorization
 * answer. Only two things block, and only when the user said they need
 * sponsorship: a posting that states it does not sponsor, and one that demands
 * citizenship or permanent residency — needing sponsorship is exactly the
 * condition those rule out.
 *
 * `requiresSponsorship === null` never blocks. An unanswered profile question is
 * not a fact about the user, so it can only ask them to answer it.
 */
function assessEligibility(
  posting: QualificationPosting,
  flags: JobRequirementFlag[],
  profile: QualificationProfile,
  marketFit: MarketFitResult,
  marketName: string | null
): EligibilityResult {
  const has = (flag: JobRequirementFlag) => flags.includes(flag)
  const sponsorshipConfirmed = has(JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE)

  /** True when the posting itself said something about work authorization. */
  const sponsorshipStated =
    has(JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP) ||
    has(JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE) ||
    has(JOB_REQUIREMENT_FLAGS.CITIZENSHIP_REQUIRED) ||
    has(JOB_REQUIREMENT_FLAGS.RESIDENCY_REQUIRED) ||
    has(JOB_REQUIREMENT_FLAGS.WORK_AUTH_REQUIRED)

  // A posting that hires where the user already is does not raise a visa
  // question at all, so a silent one is not an open question either. A posting
  // that stated a work-authorization condition always stays relevant: it said
  // something, and what it said outranks where it hires.
  const sponsorshipMooted =
    !sponsorshipStated && SPONSORSHIP_MOOT_FITS.includes(marketFit.fit)
  const sponsorshipRelevant = profile.requiresSponsorship === true && !sponsorshipMooted

  // Nothing to read means nothing was checked. The requirement extractor only
  // ever sees the description, so a source that publishes none leaves every
  // eligibility question open rather than answered.
  if (!posting.description) {
    const step: QualificationStep = {
      signal: "NEUTRAL",
      reasons: ["Couldn't check the posting's requirements — this source publishes no description."],
      unchecked: ["requirements"],
    }
    return { step, sponsorshipConfirmed: false, sponsorshipRelevant }
  }

  if (flags.length === 0 && profile.requiresSponsorship !== true) {
    return { step: { signal: "NEUTRAL", reasons: [] }, sponsorshipConfirmed, sponsorshipRelevant }
  }

  const reasons: string[] = []
  /** Informational: true, worth saying, and not a mark against the posting. */
  const notes: string[] = []
  const blockers: string[] = []

  if (profile.requiresSponsorship === true) {
    if (has(JOB_REQUIREMENT_FLAGS.NO_SPONSORSHIP)) {
      blockers.push("The posting states it does not sponsor, and you need sponsorship.")
    }
    if (has(JOB_REQUIREMENT_FLAGS.CITIZENSHIP_REQUIRED)) {
      blockers.push("The posting requires citizenship, which sponsorship cannot cover.")
    }
    if (has(JOB_REQUIREMENT_FLAGS.RESIDENCY_REQUIRED)) {
      blockers.push("The posting requires permanent residency, which sponsorship cannot cover.")
    }
    if (blockers.length === 0 && has(JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE)) {
      reasons.push("The posting says sponsorship is available.")
    }
    // Silence is the common case, and for a user who needs sponsorship it is an
    // open question, not a clean bill of health. Said plainly, never as a mark
    // against the posting — the extractor reads English and German, so a
    // posting in another language can state a stance this cannot see.
    if (blockers.length === 0 && !has(JOB_REQUIREMENT_FLAGS.SPONSORSHIP_AVAILABLE)) {
      notes.push(
        sponsorshipMooted
          ? sponsorshipMootNote(marketFit.fit, marketName)
          : has(JOB_REQUIREMENT_FLAGS.WORK_AUTH_REQUIRED)
            ? "The posting requires work authorization but doesn't say it sponsors — you need sponsorship."
            : "The posting doesn't mention visa sponsorship — you need it, so check before you apply."
      )
    }
  } else if (profile.requiresSponsorship === null && sponsorshipStated) {
    reasons.push(
      "This posting has work-authorization conditions; answer the sponsorship question on your Career Profile to get a straight answer here."
    )
  }

  if (has(JOB_REQUIREMENT_FLAGS.SECURITY_CLEARANCE)) {
    reasons.push("A security clearance is required; your profile cannot confirm one.")
  }

  // A stated location restriction is only a caveat when the posting's own
  // location does not already sit inside the user's preferred set. It never
  // blocks: the restriction is prose, and prose is not precise enough to tell
  // someone they may not apply.
  const locationRestricted =
    has(JOB_REQUIREMENT_FLAGS.US_ONLY) || has(JOB_REQUIREMENT_FLAGS.LOCATION_RESTRICTED)
  if (
    locationRestricted &&
    profile.locations.length > 0 &&
    !profile.openToRelocation &&
    !(posting.location && matchesAnyLocation(posting.location, profile.locations))
  ) {
    reasons.push("The posting restricts where you may be based; check it against your locations.")
  }

  if (blockers.length > 0) {
    return {
      step: { signal: "BLOCKER", reasons: [...blockers, ...reasons, ...notes] },
      sponsorshipConfirmed,
      sponsorshipRelevant,
    }
  }
  if (reasons.length > 0) {
    // A stated "sponsorship available" that applies to the user is good news;
    // everything else here is a caveat.
    const onlyGoodNews =
      reasons.length === 1 && reasons[0].startsWith("The posting says sponsorship is available")
    return {
      step: { signal: onlyGoodNews ? "GOOD" : "CONCERN", reasons: [...reasons, ...notes] },
      sponsorshipConfirmed,
      sponsorshipRelevant,
    }
  }
  if (notes.length > 0) {
    return { step: { signal: "NEUTRAL", reasons: notes }, sponsorshipConfirmed, sponsorshipRelevant }
  }
  return { step: { signal: "NEUTRAL", reasons: [] }, sponsorshipConfirmed, sponsorshipRelevant }
}

// ---------------------------------------------------------------------------
// Match?
// ---------------------------------------------------------------------------

/**
 * Which capabilities the profile already holds this posting asks for.
 *
 * The direction matters: the profile is the source and the posting is searched.
 * Nothing here can create, confirm or strengthen a capability — a posting that
 * names a skill the user does not have simply contributes nothing.
 */
function assessMatch(
  posting: QualificationPosting,
  profile: QualificationProfile
): QualificationMatchStep {
  if (profile.capabilities.length === 0) {
    return {
      signal: "NEUTRAL",
      reasons: ["Add capabilities to your Career Profile to see how postings line up."],
      matched: [],
      confirmedCount: 0,
    }
  }

  if (!posting.description) {
    return {
      signal: "NEUTRAL",
      reasons: ["This source publishes no description, so there is nothing to compare against."],
      matched: [],
      confirmedCount: 0,
    }
  }

  const haystack = tokenizedHaystack(`${posting.title} ${posting.description}`)

  const matched: string[] = []
  let confirmedCount = 0
  for (const capability of profile.capabilities) {
    const needle = tokenizedHaystack(capability.name).trim()
    if (needle.length < MIN_CAPABILITY_LENGTH) continue
    if (!haystack.includes(` ${needle} `)) continue
    matched.push(capability.name)
    if (capability.confirmed) confirmedCount += 1
  }

  if (matched.length === 0) {
    return {
      signal: "CONCERN",
      reasons: ["The posting does not mention any capability on your profile."],
      matched,
      confirmedCount,
    }
  }

  const signal: QualificationSignal =
    confirmedCount >= STRONG_MATCH_CONFIRMED ? "GOOD" : "NEUTRAL"

  return {
    signal,
    reasons: [
      confirmedCount > 0
        ? `Mentions ${matched.length} of your capabilities, ${confirmedCount} confirmed.`
        : `Mentions ${matched.length} of your capabilities, none confirmed yet.`,
    ],
    matched,
    confirmedCount,
  }
}

// ---------------------------------------------------------------------------
// Keyword relevance (ranking only)
// ---------------------------------------------------------------------------

/**
 * How many of the query's profile keywords this posting mentions, as whole
 * tokens, in its title or description.
 *
 * A tie-breaker for the candidate list and nothing more. It can only move a
 * posting up among others that already share its verdict; it never filters,
 * never blocks and never changes a qualification — so a keyword the posting
 * happens not to say can never hide a job the user should see.
 *
 * The direction is the same as "Match?": the keywords come from the profile and
 * the posting is searched. A posting naming a term the user does not have still
 * contributes nothing.
 */
export function countKeywordMentions(
  posting: Pick<QualificationPosting, "title" | "description">,
  keywords: string[]
): number {
  if (keywords.length === 0) return 0

  const haystack = tokenizedHaystack(`${posting.title} ${posting.description ?? ""}`)
  const counted = new Set<string>()
  for (const keyword of keywords) {
    const needle = tokenizedHaystack(keyword).trim()
    if (needle.length < MIN_CAPABILITY_LENGTH) continue
    if (counted.has(needle)) continue
    if (!haystack.includes(` ${needle} `)) continue
    counted.add(needle)
  }
  return counted.size
}

// ---------------------------------------------------------------------------
// Risk?
// ---------------------------------------------------------------------------

/**
 * The same heuristics a saved job gets, run early so an obvious scam never
 * reaches the board. Risk never blocks: the user may still want to look.
 */
function assessRisk(posting: QualificationPosting): QualificationRiskStep {
  let assessment: ReturnType<typeof assessJobRiskHeuristics> = null
  try {
    assessment = assessJobRiskHeuristics({
      jobTitle: posting.title,
      companyName: posting.companyName,
      jobDescription: posting.description,
      jobLink: posting.url,
      location: posting.location,
    })
  } catch {
    // A heuristic that throws costs this one answer, never the run.
    return { signal: "NEUTRAL", reasons: [], level: null }
  }

  if (!assessment) return { signal: "NEUTRAL", reasons: [], level: null }
  if (assessment.level === "LOW") {
    return { signal: "GOOD", reasons: [], level: "LOW" }
  }
  return { signal: "CONCERN", reasons: assessment.reasons, level: assessment.level }
}

// ---------------------------------------------------------------------------
// Verdict and next action
// ---------------------------------------------------------------------------

interface Steps {
  worthIt: QualificationStep
  eligible: QualificationStep
  match: QualificationMatchStep
  risk: QualificationRiskStep
}

/** What the steps confirmed, as opposed to what they merely did not flag. */
interface VerdictContext {
  preferenceFitConfirmed: boolean
  locationFitConfirmed: boolean
  preferenceConcerns: number
  sponsorshipConfirmed: boolean
  requiresSponsorship: boolean | null
  marketFit: MarketFitResult["fit"]
  openToRelocation: boolean
  /** True when the title is only adjacent to the user's target roles. */
  titleRelated: boolean
  /** True when the title names none of the kinds of work the user is after. */
  titleUnrelated: boolean
}

function decideVerdict(steps: Steps, context: VerdictContext): QualificationVerdict {
  const all = [steps.worthIt, steps.eligible, steps.match, steps.risk]
  if (all.some((step) => step.signal === "BLOCKER")) return "BLOCKED"

  // A posting that states it only hires somewhere the user is not cannot be one
  // of the ones they should read first, however well the rest of it scores. It
  // is capped rather than blocked: the restriction is a parsed free-text string,
  // and the user must still be able to find the posting and judge it themselves.
  //
  // The cap is the one place willingness to relocate belongs. A user who would
  // move has already answered the question the restriction asks, so the posting
  // keeps whatever band the rest of the checks earned it — and keeps the note in
  // "Eligible?" that says what moving there would involve.
  if (context.marketFit === "RESTRICTED" && !context.openToRelocation) return "WEAK"

  // A title that names none of the kinds of work the user is after is not
  // "worth a look" on the strength of one capability the description happens to
  // mention: a Bookkeeper posting saying "Excel" is still a bookkeeping job.
  // Capped rather than blocked — the title is one line of free text, and the
  // user must still be able to find the posting and judge it themselves.
  if (context.titleUnrelated) return "WEAK"

  const concerns = all.filter((step) => step.signal === "CONCERN").length
  // Missing both stated preferences is two misses even though one step reports
  // them: an onsite role in a city the user does not want is not a near miss.
  if (steps.risk.level === "HIGH" || concerns >= 2 || context.preferenceConcerns >= 2) {
    return "WEAK"
  }
  if (concerns === 1) return "WORTH_A_LOOK"

  // No concerns anywhere. It is only STRONG when something positive was
  // actually established — an empty profile produces NEUTRAL everywhere, and
  // "we know nothing about you" is not a strong match.
  const strong = steps.match.signal === "GOOD" || steps.worthIt.signal === "GOOD"
  if (!strong) return "WORTH_A_LOOK"

  // STRONG has to mean "checked, and it fits". Two things it must never mean:
  //
  // - "the posting never said where or how you would work". A capability match
  //   alone is what put a German-language onsite Berlin trainee role at the top
  //   of a Cagayan de Oro remote-seeker's list; nothing had been ruled out, so
  //   nothing was flagged.
  // - "you need sponsorship and the posting is silent about both sponsorship and
  //   somewhere you could work from".
  //
  // Neither adds a concern and neither blocks — the posting may well be fine.
  // They only cost it the top band, which is the claim that cannot be supported.
  if (!context.preferenceFitConfirmed) return "WORTH_A_LOOK"
  // An adjacent title ("Data Engineer" against a Software Engineer target) is
  // not a fit the title established, so the capabilities have to establish it.
  if (context.titleRelated && steps.match.confirmedCount < RELATED_TITLE_CONFIRMED) {
    return "WORTH_A_LOOK"
  }
  if (
    context.requiresSponsorship === true &&
    !context.sponsorshipConfirmed &&
    !context.locationFitConfirmed
  ) {
    return "WORTH_A_LOOK"
  }

  return "STRONG"
}

function decideNextAction(verdict: QualificationVerdict, steps: Steps): string {
  if (verdict === "BLOCKED") {
    return "Skip this one unless the posting is wrong about its own requirements."
  }
  if (steps.risk.level === "HIGH") {
    return "Verify the company independently before spending any time on this."
  }
  if (verdict === "STRONG") {
    return "Save it and tailor a resume from the matching role family."
  }
  if (verdict === "WEAK") {
    return "Read the posting before saving — it misses on more than one of your criteria."
  }
  if ([steps.worthIt, steps.eligible].some((step) => (step.unchecked ?? []).length > 0)) {
    return "Worth opening — the posting leaves too much unstated to judge the fit from here."
  }
  return "Worth opening. Save it if the description holds up."
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Lowercased text with every non-token character collapsed to a space and the
 * whole string space-padded, so `includes(" react ")` is a whole-token match.
 * `+`, `#` and `.` survive so "c++", "c#" and "node.js" stay single tokens.
 *
 * A dot not followed by an alphanumeric is sentence punctuation, not part of a
 * name, and is dropped: without that, "we use C#." and "experience with React."
 * would never match the capability they name.
 */
function tokenizedHaystack(value: string): string {
  const collapsed = value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\.(?![a-z0-9])/g, "")
    .trim()
  return ` ${collapsed} `
}

/** True when the posting's own location text says location is not a constraint. */
function mentionsOpenLocation(location: string | undefined): boolean {
  if (!location) return false
  const haystack = location.toLowerCase()
  return OPEN_LOCATION_WORDS.some((word) => haystack.includes(word))
}

/**
 * Substring match in both directions: a profile location of "Berlin" should hit
 * a posting in "Berlin, Germany", and a profile location of "Metro Manila"
 * should hit a posting in "Manila".
 */
function matchesAnyLocation(location: string, preferred: string[]): boolean {
  const haystack = tokenizedHaystack(location)
  return preferred.some((entry) => {
    const needle = tokenizedHaystack(entry).trim()
    if (needle.length < MIN_CAPABILITY_LENGTH) return false
    if (haystack.includes(` ${needle} `)) return true
    // The other direction, token by token, so "Metro Manila" matches "Manila".
    return needle
      .split(" ")
      .filter((token) => token.length >= MIN_CAPABILITY_LENGTH)
      .some((token) => haystack.includes(` ${token} `))
  })
}

/**
 * Title tokens, with the spellings of "full stack" folded together first so
 * "Full-Stack", "Fullstack" and "Full Stack Developer" are one token and cannot
 * match on the generic word "full" alone.
 */
function titleTokens(value: string): string[] {
  const folded = value.replace(/full[\s_-]*stack/gi, "fullstack")
  return tokenizedHaystack(folded)
    .trim()
    .split(" ")
    .filter((token) => token.length >= MIN_CAPABILITY_LENGTH)
}

/** True when `tokens` contains `phrase` as a contiguous run. */
function containsTokenSequence(tokens: string[], phrase: string[]): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false
  return tokens.some((_, start) =>
    phrase.every((token, offset) => tokens[start + offset] === token)
  )
}

/**
 * How close a posting title is to the roles the user is actually targeting.
 *
 * The search that produced the candidate was a loose OR, so the title is worth
 * re-reading here — but only for words that identify a role. A shared
 * "engineer" or "developer" is not evidence of anything: it is what put a Data
 * Engineer posting at the top of a Backend/Frontend/Web list.
 *
 * - MATCH — the title spells out a whole target role ("Software Engineer"), or
 *   shares a word that identifies one ("backend", "wordpress", "qa").
 * - RELATED — the only overlap is a generic *role noun* ("Data Engineer" vs
 *   "Software Engineer"): two jobs of the same kind. Adjacent, and said as
 *   such; never a positive on its own.
 * - UNRELATED — nothing in common but filler ("Bookkeeper", and "Senior
 *   Accountant" against "Senior Frontend Engineer" — a seniority word is not
 *   an adjacency).
 */
export function titleRelevance(postingTitle: string, roleTitles: string[]): TitleRelevance {
  const tokens = titleTokens(postingTitle)
  if (tokens.length === 0) return "UNRELATED"
  const present = new Set(tokens)

  let related = false
  for (const role of roleTitles) {
    const roleTokens = titleTokens(role)
    if (roleTokens.length === 0) continue
    // The whole role, said in order. This is the only thing that can match a
    // role made entirely of generic words, like "Software Engineer".
    if (containsTokenSequence(tokens, roleTokens)) return "MATCH"
    for (const token of roleTokens) {
      if (!present.has(token)) continue
      if (!GENERIC_TITLE_TOKENS.has(token)) return "MATCH"
      // Only a shared *kind of work* makes the titles adjacent. A shared
      // "senior" or "remote" is two postings using the same filler.
      if (GENERIC_ROLE_NOUNS.has(token)) related = true
    }
  }
  return related ? "RELATED" : "UNRELATED"
}

/** The first target role an adjacent title shares a role noun with, for the note. */
function relatedTargetRole(postingTitle: string, roleTitles: string[]): string | null {
  const present = new Set(titleTokens(postingTitle))
  return (
    roleTitles.find((role) =>
      titleTokens(role).some((token) => present.has(token) && GENERIC_ROLE_NOUNS.has(token))
    ) ?? null
  )
}

/**
 * True when the posting title is not plainly about something else — the loose
 * "is this in the neighbourhood" question this used to answer on its own. The
 * three-way answer, which is what the verdict reads, lives in
 * {@link titleRelevance}.
 */
export function matchesAnyRoleTitle(title: string, roleTitles: string[]): boolean {
  return titleRelevance(title, roleTitles) !== "UNRELATED"
}

// ---------------------------------------------------------------------------
// Seniority
// ---------------------------------------------------------------------------

/**
 * The level a posting is pitched at, or null when it never says.
 *
 * The title is asked first: it is the one line every source publishes, and a
 * title that says "Senior" is the posting stating its own level. Only when the
 * title is silent does the description's years-of-experience bar stand in, and
 * the bar is read as a bar — the highest number stated wins, because that is
 * the one the reader has to clear.
 */
function inferPostingSeniority(posting: QualificationPosting): ExperienceLevel | null {
  return seniorityFromTitle(posting.title) ?? seniorityFromYearsOfExperience(posting.description)
}

/**
 * German umlauts and `ß` folded to their ASCII spellings, so a title written
 * "Geschäftsführer" and one written "Geschaeftsfuehrer" are the same token.
 * Applied only where a title is read for its level — `tokenizedHaystack` drops
 * non-ASCII characters, which would otherwise split the word into fragments.
 */
function foldDiacritics(value: string): string {
  return value
    .replace(/ä/gi, "ae")
    .replace(/ö/gi, "oe")
    .replace(/ü/gi, "ue")
    .replace(/ß/gi, "ss")
}

/**
 * The highest level any marker in the title claims. Highest rather than first
 * so "Senior Director" reads as the executive role it is, not the senior one.
 */
function seniorityFromTitle(title: string): ExperienceLevel | null {
  const haystack = tokenizedHaystack(foldDiacritics(title))

  let found: ExperienceLevel | null = null
  for (const marker of TITLE_SENIORITY_MARKERS) {
    if (!haystack.includes(` ${marker.phrase} `)) continue
    if (!found || EXPERIENCE_LEVEL_RANK[marker.level] > EXPERIENCE_LEVEL_RANK[found]) {
      found = marker.level
    }
  }
  return found
}

/**
 * The years-of-experience bar the description states, mapped onto the levels.
 * A number only counts when "experience" sits near it, so a "5 years of runway"
 * sentence in a company blurb cannot set a posting's level.
 */
function seniorityFromYearsOfExperience(description: string | undefined): ExperienceLevel | null {
  if (!description) return null

  const haystack = description.toLowerCase()
  let years: number | null = null
  for (const match of haystack.matchAll(YEARS_OF_EXPERIENCE)) {
    const index = match.index ?? 0
    const window = haystack.slice(
      Math.max(0, index - YEARS_EXPERIENCE_WINDOW),
      index + match[0].length + YEARS_EXPERIENCE_WINDOW
    )
    if (!YEARS_EXPERIENCE_WORDS.some((word) => window.includes(word))) continue
    const stated = Number.parseInt(match[1], 10)
    if (Number.isNaN(stated)) continue
    if (years === null || stated > years) years = stated
  }

  if (years === null) return null
  if (years <= 2) return "JUNIOR"
  if (years <= 5) return "MID"
  if (years <= 8) return "SENIOR"
  return "LEAD"
}

/** True when one of the user's own target titles already names that level or above. */
function targetRolesReachLevel(roleTitles: string[], level: ExperienceLevel): boolean {
  return roleTitles.some((role) => {
    const target = seniorityFromTitle(role)
    return target !== null && EXPERIENCE_LEVEL_RANK[target] >= EXPERIENCE_LEVEL_RANK[level]
  })
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
