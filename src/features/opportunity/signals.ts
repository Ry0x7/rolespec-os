import type { Signal, SignalEvidence, SignalId, SignalState } from "./types"

/**
 * Deterministic reading of a posting's workload and friction language.
 *
 * Rules this module follows, because each one is a way an app lies to a
 * candidate:
 *
 * 1. **A quote or nothing.** Every indicator carries the sentence it came from.
 *    If no sentence supports it, the indicator is `UNKNOWN` — never guessed from
 *    the title or the industry.
 * 2. **Conditional language is `UNCERTAIN`.** "May include on-call", "occasional
 *    travel", "as needed" are not commitments, and are labelled as such.
 * 3. **Contradictions are reported, not resolved.** If one sentence says "no
 *    overtime" and another says "overtime required", the signal is `UNCERTAIN`
 *    and both sentences are kept. Picking one would be an invention.
 * 4. **No hours, no hourly figure.** There is no default 40-hour week here.
 */

export interface PostingSignals {
  workload: Signal[]
  friction: Signal[]
  eligibility: Signal[]
  hoursPerWeek: number | null
  hoursSentence: string | null
  interviewStages: number | null
  commissionOnly: boolean
  variableComponent: boolean
  contractLanguage: boolean
  /** Sentences that contradict each other, keyed by the indicator they affect. */
  contradictions: Array<{ id: SignalId; excerpts: [string, string] }>
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+|\r+/
const CONDITIONAL = /\b(?:may|might|can|occasional(?:ly)?|sometimes|as needed|as required|periodically|potential(?:ly)?)\b/i

function sentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
}

function evidence(
  excerpt: string | null,
  sourceUrl: string | null,
  source: SignalEvidence["source"] = "POSTING_TEXT"
): SignalEvidence | null {
  return excerpt ? { excerpt, sourceUrl, source } : null
}

const NEGATIONS: Partial<Record<SignalId, RegExp>> = {
  ON_CALL: /\bno\s+on[- ]call\b|\bwithout\s+on[- ]call\b/i,
  OVERTIME: /\bno\s+overtime\b|\bno\s+extended\s+hours\b/i,
  SHIFTS: /\bno\s+(?:night|rotating)\s+shifts?\b|\bday\s+shift\s+only\b/i,
  QUOTAS: /\bno\s+(?:sales\s+)?quotas?\b/i,
  TRAVEL: /\bno\s+travel\b|\btravel[- ]free\b/i,
}

function positive(
  id: SignalId,
  text: string,
  patterns: RegExp[],
  sourceUrl: string | null,
  reason: (excerpt: string) => string,
  /** Sentences that deny the burden; they are the other half of a contradiction. */
  negation?: RegExp
): { signal: Signal; excerpt: string | null } {
  for (const sentence of sentences(text)) {
    if (!patterns.some((pattern) => pattern.test(sentence))) continue
    if (negation?.test(sentence)) continue
    const conditional = CONDITIONAL.test(sentence)
    return {
      signal: {
        id,
        state: conditional ? "UNCERTAIN" : "SUPPORTED",
        reason: conditional
          ? `${reason(sentence)} The posting does not commit to it.`
          : reason(sentence),
        evidence: evidence(sentence, sourceUrl),
      },
      excerpt: sentence,
    }
  }
  return {
    signal: { id, state: "UNKNOWN", reason: unknownReason(id), evidence: null },
    excerpt: null,
  }
}

function unknownReason(id: SignalId): string {
  switch (id) {
    case "ON_CALL":
      return "The posting does not say whether the role has on-call."
    case "OVERTIME":
      return "The posting does not say whether overtime is expected."
    case "SHIFTS":
      return "The posting does not describe the shift pattern."
    case "QUOTAS":
      return "The posting does not say whether the role carries a quota."
    case "TRAVEL":
      return "The posting does not state how much travel is involved."
    case "ROLE_BREADTH":
      return "The posting does not describe the role's breadth."
    case "SCHEDULE_RIGIDITY":
      return "The posting does not state fixed hours or time-zone coverage."
    case "FLEXIBLE_SCHEDULE":
      return "The posting does not offer a flexible schedule explicitly."
    case "ASSESSMENT":
      return "The posting does not describe an assessment or take-home."
    case "INTERVIEW_STAGES":
      return "The posting does not state how many interview stages there are."
    case "UNPAID_TASK":
      return "The posting does not mention an unpaid task."
    case "REQUIRED_DOCUMENTS":
      return "The posting does not list required application documents."
    case "WORK_AUTHORIZATION":
      return "The posting does not state a work-authorization requirement."
    case "LOCATION_RESTRICTION":
      return "The posting does not restrict candidates to a location."
    default:
      return "The posting does not state this."
  }
}

const WORKLOAD_PATTERNS: Array<{
  id: SignalId
  patterns: RegExp[]
  reason: (excerpt: string) => string
}> = [
  {
    id: "ON_CALL",
    patterns: [/\bon[- ]call\b/i, /\bpager\s+duty\b/i, /\b24\/7\s+(?:on[- ]call|support|coverage)\b/i],
    reason: () => "The posting mentions on-call.",
  },
  {
    id: "OVERTIME",
    patterns: [/\bovertime\b/i, /\bextended\s+hours\b/i, /\bweekend\s+work\b/i],
    reason: () => "The posting expects overtime or extended hours.",
  },
  {
    id: "SHIFTS",
    patterns: [
      /\b(?:night|evening|rotating|swing|graveyard|12[- ]hour|8[- ]hour)\s+shifts?\b/i,
      /\bshift\s+(?:work|rotation|pattern)\b/i,
    ],
    reason: () => "The role works shifts.",
  },
  {
    id: "QUOTAS",
    patterns: [/\b(?:sales|revenue|call|activity)\s+quotas?\b/i, /\bquota[- ]carrying\b/i],
    reason: () => "The role carries a quota.",
  },
  {
    id: "SCHEDULE_RIGIDITY",
    patterns: [
      /\bfixed\s+(?:schedule|hours)\b/i,
      /\bcore\s+hours\b/i,
      /\bmust\s+(?:be\s+available|work)\s+(?:during|from)\b/i,
      /\b(?:9|8)(?:am)?\s*[-–to]+\s*5(?:pm)?\b/i,
    ],
    reason: () => "The posting states a fixed schedule or coverage window.",
  },
]

function travelSignal(text: string, sourceUrl: string | null): Signal {
  const all = sentences(text)
  const percent = all.find((sentence) => /\b\d{1,3}\s*%\s*(?:travel|of\s+the\s+time)?\b/i.test(sentence) && /travel/i.test(sentence))
  if (percent) {
    const value = Number(percent.match(/(\d{1,3})\s*%/)?.[1] ?? "0")
    return {
      id: "TRAVEL",
      state: "SUPPORTED",
      reason: `The posting states ${value}% travel.`,
      evidence: evidence(percent, sourceUrl),
    }
  }
  const negation = all.find((sentence) => NEGATIONS.TRAVEL!.test(sentence))
  const qualitative = all.find(
    (sentence) => /\btravel\b/i.test(sentence) && !NEGATIONS.TRAVEL!.test(sentence)
  )
  if (!qualitative && negation) {
    // "No travel" is worth stating, but it is not a workload burden — and a
    // sentence about its absence must never be scored as travel.
    return {
      id: "TRAVEL",
      state: "UNKNOWN",
      reason: "The posting says no travel is required.",
      evidence: evidence(negation, sourceUrl),
    }
  }
  if (qualitative) {
    const conditional = CONDITIONAL.test(qualitative) || /\boccasional(?:ly)?\b/i.test(qualitative)
    return {
      id: "TRAVEL",
      state: conditional ? "UNCERTAIN" : "SUPPORTED",
      reason: conditional
        ? "The posting mentions travel without quantifying it."
        : "The posting mentions travel.",
      evidence: evidence(qualitative, sourceUrl),
    }
  }
  return { id: "TRAVEL", state: "UNKNOWN", reason: unknownReason("TRAVEL"), evidence: null }
}

function roleBreadthSignal(title: string, text: string, sourceUrl: string | null): Signal {
  const slashed = title.split(/[/&+]/).map((part) => part.trim()).filter(Boolean)
  if (slashed.length >= 3) {
    return {
      id: "ROLE_BREADTH",
      state: "SUPPORTED",
      reason: `The title covers ${slashed.length} disciplines.`,
      evidence: evidence(title, sourceUrl, "STRUCTURED_FIELD"),
    }
  }
  const explicit = sentences(text).find((sentence) =>
    /\b(?:wear|wearing)\s+(?:many|multiple)\s+hats\b|\bacross\s+(?:several|multiple)\s+(?:functions|teams|disciplines)\b/i.test(
      sentence
    )
  )
  if (explicit) {
    return {
      id: "ROLE_BREADTH",
      state: "SUPPORTED",
      reason: "The posting describes a role spanning several functions.",
      evidence: evidence(explicit, sourceUrl),
    }
  }
  if (slashed.length === 2) {
    return {
      id: "ROLE_BREADTH",
      state: "UNCERTAIN",
      reason: `The title names two disciplines (${slashed.join(" / ")}).`,
      evidence: evidence(title, sourceUrl, "STRUCTURED_FIELD"),
    }
  }
  return { id: "ROLE_BREADTH", state: "UNKNOWN", reason: unknownReason("ROLE_BREADTH"), evidence: null }
}

function flexibleScheduleSignal(text: string, sourceUrl: string | null): Signal {
  const sentence = sentences(text).find((line) =>
    /\b(?:flexible|flex)\s+(?:hours|schedule|working)\b|\bwork\s+whenever\b|\bown\s+your\s+schedule\b/i.test(line)
  )
  if (!sentence) {
    return {
      id: "FLEXIBLE_SCHEDULE",
      state: "UNKNOWN",
      reason: unknownReason("FLEXIBLE_SCHEDULE"),
      evidence: null,
    }
  }
  return {
    id: "FLEXIBLE_SCHEDULE",
    state: CONDITIONAL.test(sentence) ? "UNCERTAIN" : "SUPPORTED",
    reason: "The posting offers a flexible schedule.",
    evidence: evidence(sentence, sourceUrl),
  }
}

function hoursSignal(text: string): { hours: number | null; sentence: string | null } {
  for (const sentence of sentences(text)) {
    const match =
      sentence.match(/\b(\d{1,2})(?:\.\d+)?\s*(?:hours?|hrs?)(?:\s*(?:per|a|\/)\s*(?:week|wk))\b/i) ??
      sentence.match(/\b(\d{1,2})\s*(?:hours?|hrs?)\s*(?:a|per)\s*week\b/i) ??
      sentence.match(/\b(\d{1,2})[- ]hour\s+week\b/i)
    if (!match) continue
    const hours = Number(match[1])
    if (hours > 0 && hours <= 80) return { hours, sentence }
  }
  return { hours: null, sentence: null }
}

const STAGE_MARKERS = [
  /\bphone\s+screen\b/i,
  /\brecruiter\s+(?:call|screen)\b/i,
  /\bhiring\s+manager\s+(?:call|interview)\b/i,
  /\btechnical\s+(?:screen|interview)\b/i,
  /\btake[- ]home\b/i,
  /\bpanel\s+interview\b/i,
  /\bon[- ]?site\s+interview\b/i,
  /\bfinal\s+round\b/i,
  /\breference\s+check\b/i,
]

function interviewStages(text: string): { count: number | null; sentence: string | null } {
  const all = sentences(text)
  const explicit = all.find((sentence) => /\b\d\s*(?:rounds?|stages?|steps?|interviews?)\b/i.test(sentence))
  if (explicit) {
    const count = Number(explicit.match(/\b(\d)\s*(?:rounds?|stages?|steps?|interviews?)\b/i)?.[1] ?? "0")
    if (count > 0 && count <= 10) return { count, sentence: explicit }
  }
  const mentioned = all.filter((sentence) => STAGE_MARKERS.some((pattern) => pattern.test(sentence)))
  if (mentioned.length >= 2) {
    return { count: mentioned.length, sentence: mentioned.join(" ") }
  }
  if (mentioned.length === 1) return { count: 1, sentence: mentioned[0]! }
  return { count: null, sentence: null }
}

const DOCUMENT_PATTERNS = [
  /\bcover\s+letter\b/i,
  /\bportfolio\b/i,
  /\breferences?\b/i,
  /\btranscripts?\b/i,
  /\b(?:degree|diploma)\s+copy\b/i,
  /\bdriver'?s?\s+licen[cs]e\b/i,
]

function documentSignal(text: string, sourceUrl: string | null): Signal {
  const all = sentences(text).filter((sentence) =>
    /\b(?:submit|upload|provide|attach|require|include)\b/i.test(sentence)
  )
  // Count distinct document types, not matching sentences: one sentence can
  // ask for a cover letter *and* a portfolio, which is two documents.
  const kinds = DOCUMENT_PATTERNS.filter((pattern) =>
    all.some((sentence) => pattern.test(sentence))
  ).length
  const first = all.find((sentence) => DOCUMENT_PATTERNS.some((pattern) => pattern.test(sentence)))

  if (kinds === 0) {
    return { id: "REQUIRED_DOCUMENTS", state: "UNKNOWN", reason: unknownReason("REQUIRED_DOCUMENTS"), evidence: null }
  }
  return {
    id: "REQUIRED_DOCUMENTS",
    state: kinds >= 2 ? "SUPPORTED" : "UNCERTAIN",
    reason:
      kinds >= 2
        ? `The application asks for ${kinds} kinds of supporting document.`
        : "The application asks for one supporting document.",
    evidence: evidence(first ?? null, sourceUrl),
  }
}

function workAuthorizationSignal(text: string, sourceUrl: string | null): Signal {
  for (const sentence of sentences(text)) {
    if (
      /\b(?:must|required)\s+(?:be\s+)?(?:legally\s+)?(?:authorized|eligible|permitted)\s+to\s+work\s+in\b/i.test(sentence) ||
      /\bno\s+(?:visa\s+)?sponsorship\b/i.test(sentence) ||
      /\bsponsorship\s+(?:is\s+)?not\s+available\b/i.test(sentence)
    ) {
      return {
        id: "WORK_AUTHORIZATION",
        state: "SUPPORTED",
        reason: "The posting requires existing work authorization.",
        evidence: evidence(sentence, sourceUrl),
      }
    }
  }
  return {
    id: "WORK_AUTHORIZATION",
    state: "UNKNOWN",
    reason: unknownReason("WORK_AUTHORIZATION"),
    evidence: null,
  }
}

function locationRestrictionSignal(text: string, sourceUrl: string | null): Signal {
  for (const sentence of sentences(text)) {
    if (
      /\bonly\s+(?:consider|accept|hire)\s+(?:candidates?\s+)?(?:who\s+are\s+)?(?:based|located|residing|resident)\s+in\b/i.test(sentence) ||
      /\bmust\s+(?:be\s+)?(?:based|located|residing|resident)\s+in\b/i.test(sentence) ||
      /\b(?:remote|hybrid)\s+(?:within|in)\s+(?:the\s+)?(?:philippines|us|uk|eu|canada|australia|singapore)\b/i.test(sentence)
    ) {
      return {
        id: "LOCATION_RESTRICTION",
        state: "SUPPORTED",
        reason: "The posting restricts where the candidate can be based.",
        evidence: evidence(sentence, sourceUrl),
      }
    }
  }
  return {
    id: "LOCATION_RESTRICTION",
    state: "UNKNOWN",
    reason: unknownReason("LOCATION_RESTRICTION"),
    evidence: null,
  }
}

function commissionSignals(text: string): { commissionOnly: boolean; variable: boolean; excerpt: string | null } {
  const all = sentences(text)
  const only = all.find((sentence) => /\bcommission[- ]only\b|\b100\s*%\s*commission\b|\bno\s+base\s+salary\b/i.test(sentence))
  const basePay = all.find((sentence) => /\bbase\s+(?:salary|pay)\b/i.test(sentence))
  if (only && basePay) {
    // The posting contradicts itself; do not claim commission-only.
    return { commissionOnly: false, variable: true, excerpt: only }
  }
  const variable = all.find((sentence) =>
    /\bOTE\b|\bon[- ]target\s+earnings\b|\buncapped\s+commission\b|\bcommission\b/i.test(sentence) &&
    !/\bno\s+commission\b/i.test(sentence)
  )
  return {
    commissionOnly: Boolean(only),
    variable: Boolean(variable),
    excerpt: only ?? variable ?? null,
  }
}

/**
 * Reads a posting once. Total and deterministic: the same text always produces
 * the same signals, in the same order, with the same excerpts.
 */
export function readPostingSignals(
  posting: { title: string; description?: string | null; url?: string | null },
): PostingSignals {
  const text = (posting.description ?? "").trim()
  const sourceUrl = posting.url ?? null
  const all = sentences(text)

  const workload: Signal[] = []
  const contradictions: PostingSignals["contradictions"] = []

  for (const definition of WORKLOAD_PATTERNS) {
    const { signal, excerpt } = positive(
      definition.id,
      text,
      definition.patterns,
      sourceUrl,
      definition.reason,
      NEGATIONS[definition.id]
    )
    const negation = NEGATIONS[definition.id]
    const negated = negation ? all.find((sentence) => negation.test(sentence)) : undefined
    if (excerpt && negated && signal.state === "SUPPORTED") {
      contradictions.push({ id: definition.id, excerpts: [excerpt, negated] })
      workload.push({
        ...signal,
        state: "UNCERTAIN",
        reason: `${signal.reason} Another sentence says otherwise, so this is unresolved.`,
        evidence: evidence(excerpt, sourceUrl),
      })
      continue
    }
    workload.push(signal)
  }

  workload.push(travelSignal(text, sourceUrl))
  workload.push(roleBreadthSignal(posting.title, text, sourceUrl))
  workload.push(flexibleScheduleSignal(text, sourceUrl))

  const travel = workload.find((signal) => signal.id === "TRAVEL")
  const noTravel = all.find((sentence) => NEGATIONS.TRAVEL!.test(sentence))
  if (travel?.state === "SUPPORTED" && noTravel && travel.evidence) {
    contradictions.push({ id: "TRAVEL", excerpts: [travel.evidence.excerpt, noTravel] })
    travel.state = "UNCERTAIN"
    travel.reason = "The posting mentions travel and also says there is none, so this is unresolved."
  }

  const assessment = positive(
    "ASSESSMENT",
    text,
    [/\btake[- ]home\b/i, /\bassessment\b/i, /\bcoding\s+challenge\b/i, /\bcase\s+study\b/i, /\btechnical\s+exercise\b/i],
    sourceUrl,
    () => "The hiring process includes an assessment."
  ).signal

  const unpaid = positive(
    "UNPAID_TASK",
    text,
    [/\bunpaid\s+(?:task|assignment|project|trial)\b/i, /\bunpaid\s+work\b/i],
    sourceUrl,
    () => "The posting mentions unpaid work."
  ).signal

  // A take-home with no statement about pay is not evidence of unpaid work.
  if (unpaid.state === "UNKNOWN" && assessment.state !== "UNKNOWN") {
    const takeHome = all.find((sentence) => /\btake[- ]home\b/i.test(sentence))
    if (takeHome && !/\bpaid\b/i.test(takeHome)) {
      unpaid.id = "UNPAID_TASK"
      unpaid.state = "UNCERTAIN"
      unpaid.reason = "The posting mentions a take-home without saying whether it is paid."
      unpaid.evidence = evidence(takeHome, sourceUrl)
    }
  }

  const stages = interviewStages(text)
  const stageSignal: Signal =
    stages.count === null
      ? { id: "INTERVIEW_STAGES", state: "UNKNOWN", reason: unknownReason("INTERVIEW_STAGES"), evidence: null }
      : {
          id: "INTERVIEW_STAGES",
          state: "SUPPORTED",
          reason: `The posting describes ${stages.count} interview ${stages.count === 1 ? "stage" : "stages"}.`,
          evidence: evidence(stages.sentence, sourceUrl),
        }

  const friction: Signal[] = [assessment, stageSignal, unpaid, documentSignal(text, sourceUrl)]

  const hours = hoursSignal(text)
  const commission = commissionSignals(text)

  return {
    workload,
    friction,
    eligibility: [workAuthorizationSignal(text, sourceUrl), locationRestrictionSignal(text, sourceUrl)],
    hoursPerWeek: hours.hours,
    hoursSentence: hours.sentence,
    interviewStages: stages.count,
    commissionOnly: commission.commissionOnly,
    variableComponent: commission.variable,
    contractLanguage: /\bcontract(?:or)?\s+(?:role|position)\b|\bfixed[- ]term\b|\b\d+\s*[-–]\s*\d+\s*month\s+contract\b/i.test(
      text
    ),
    contradictions,
  }
}

/** Rebuilds a signal as `UNKNOWN` without inventing a reason. */
export function unknownSignal(id: SignalId, reason: string): Signal {
  return { id, state: "UNKNOWN", reason, evidence: null }
}

/** Convenience for callers that only need the state. */
export function signalState(signal: Signal | undefined): SignalState {
  return signal?.state ?? "UNKNOWN"
}
