import type { ClippedJob } from "./types"

/** Job boards with bespoke DOM shapes the extractor knows how to read. */
export type BoardId =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "linkedin"
  | "indeed"
  | "seek"
  | "jobstreet"
  | "generic"

type BoardPattern = { id: BoardId; source: string; label: string; regex?: RegExp }

// Sources stay lazy: regexes compile on first use, not at module load.
const BOARD_PATTERNS: BoardPattern[] = [
  { id: "greenhouse", source: "(^|\\.)greenhouse\\.io$|boards\\.greenhouse\\.io$", label: "Greenhouse" },
  { id: "lever", source: "(^|\\.)lever\\.co$", label: "Lever" },
  { id: "ashby", source: "(^|\\.)ashby\\.hq$", label: "Ashby" },
  { id: "workday", source: "myworkdayjobs\\.com$", label: "Workday" },
  { id: "linkedin", source: "(^|\\.)linkedin\\.com$", label: "LinkedIn" },
  { id: "indeed", source: "(^|\\.)indeed\\.", label: "Indeed" },
  { id: "seek", source: "(^|\\.)seek\\.", label: "SEEK" },
  { id: "jobstreet", source: "(^|\\.)jobstreet\\.", label: "JobStreet" },
]

function patternRegex(entry: BoardPattern): RegExp {
  if (!entry.regex) entry.regex = new RegExp(entry.source, "i")
  return entry.regex
}

const detectCache = new Map<string, BoardId>()

export function detectBoard(host: string | null | undefined): BoardId {
  const normalized = (host ?? "").trim().toLowerCase()
  if (!normalized) return "generic"
  const cached = detectCache.get(normalized)
  if (cached) return cached
  for (const board of BOARD_PATTERNS) {
    if (patternRegex(board).test(normalized)) {
      if (detectCache.size > 200) detectCache.clear()
      detectCache.set(normalized, board.id)
      return board.id
    }
  }
  if (detectCache.size > 200) detectCache.clear()
  detectCache.set(normalized, "generic")
  return "generic"
}

export function boardLabel(board: BoardId): string {
  const found = BOARD_PATTERNS.find((entry) => entry.id === board)
  return found ? found.label : "this board"
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

export function detectBoardFromUrl(url: string | null | undefined): BoardId {
  return detectBoard(hostOf(url))
}

/** True when the board has a dedicated adapter (extractor + badges). */
export function isKnownBoard(board: BoardId): boolean {
  return board !== "generic"
}

/**
 * One-line hint shown under the clip form so a partial read names the board
 * it came from instead of a generic "could not read" message.
 */
export function boardReadHint(board: BoardId, job: Partial<ClippedJob>): string | null {
  const missing: string[] = []
  if (!job.companyName) missing.push("company")
  if (!job.jobTitle) missing.push("title")
  if (missing.length === 0) return null
  if (board === "generic") return null
  return `Partial read from ${boardLabel(board)} — check ${missing.join(" and ")} before saving.`
}
