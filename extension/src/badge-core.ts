/**
 * The in-page fit badge: find the postings on a supported job board, ask the background
 * worker for their verdicts, and put a small label next to each title.
 *
 * Inert towards the page by construction (a password manager shares these pages):
 * - no event listeners at all — the caller adds one MutationObserver, nothing else;
 * - never reads or writes an <input> or <form>, never calls focus();
 * - the only change to an existing page element is `data-rolespec-badged="1"` on the
 *   element the badge sits after; the badge itself is a new <span> whose closed shadow
 *   root holds every style, so no page CSS is added or overridden.
 */
import type { QualifyPosting } from "./api"
import type { BadgeVerdict } from "./badge-cache"
import { adapterFor, siteFor } from "./badge-sites"
import type { ClippedJob, QualificationVerdict } from "./types"
import { MAX_DESCRIPTION_LENGTH } from "./types"
import { VERDICT_BADGES } from "./verdict-badges"

export const QUALIFY_MESSAGE = "rolespec:qualify"
export const MAX_POSTINGS_PER_MESSAGE = 40

/** The worker's answer to a `rolespec:qualify` message. */
export type QualifyReply =
  | { ok: true; profileComplete: boolean; results: BadgeVerdict[] }
  | { ok: false; reason: string }

/**
 * Wording comes from the side panel's table (src/verdict-badges.ts), so a badge and the
 * panel never disagree; the colours are the panel's --ok / --border / --warn / --danger.
 */
const VERDICT_COLORS: Record<QualificationVerdict, string> = {
  STRONG: "#4ade80",
  WORTH_A_LOOK: "#2a2f3d",
  WEAK: "#ffb454",
  BLOCKED: "#ff6b6b",
}

export const BADGE_HOST_ATTR = "data-rolespec-badge"
export const BADGED_ATTR = "data-rolespec-badged"

const BADGE_CSS = `
:host { all: initial; display: inline-block; vertical-align: middle; margin: 0 0 0 8px; }
.pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 7px; border: 1px solid var(--tone); border-radius: 999px;
  background: #171a23; color: #e7e9ee;
  font: 600 11px/16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  white-space: nowrap; cursor: default;
}
.risk { color: #ff6b6b; }
`

interface Mounted {
  host: HTMLElement
  key: string
  verdict: QualificationVerdict
  riskLevel: string | null
}

/**
 * Renders (or keeps) one badge directly after `mount`. Idempotent: the same verdict for
 * the same key on the same mount is a no-op; a different key (an SPA re-using the
 * element for another job) replaces the old badge. Returns the closed shadow root so
 * tests can read the label — page scripts cannot.
 */
export function renderBadge(
  mount: Element,
  result: BadgeVerdict,
  registry: WeakMap<Element, Mounted>,
): ShadowRoot | null {
  const existing = registry.get(mount)
  if (
    existing &&
    existing.host.isConnected &&
    existing.host.previousSibling === mount &&
    existing.key === result.key &&
    existing.verdict === result.verdict &&
    existing.riskLevel === result.riskLevel
  ) {
    return null
  }
  existing?.host.remove()
  // A badge left by an earlier copy of this script (the extension was reloaded): its
  // registry is gone, so drop it and draw a fresh one.
  const stray = mount.nextElementSibling
  if (stray?.hasAttribute(BADGE_HOST_ATTR)) stray.remove()

  const doc = mount.ownerDocument
  const tone = { label: VERDICT_BADGES[result.verdict].label, color: VERDICT_COLORS[result.verdict] }
  const host = doc.createElement("span")
  host.setAttribute(BADGE_HOST_ATTR, "1")
  host.style.cssText = "display:inline-block;vertical-align:middle;margin-left:8px"
  const shadow = host.attachShadow({ mode: "closed" })

  const style = doc.createElement("style")
  style.textContent = BADGE_CSS
  const pill = doc.createElement("span")
  pill.className = "pill"
  pill.style.setProperty("--tone", tone.color)
  pill.textContent = tone.label
  if (result.riskLevel === "HIGH") {
    const risk = doc.createElement("span")
    risk.className = "risk"
    risk.textContent = "· ⚑ risk"
    pill.append(risk)
  }
  const lines = [`RoleSpec: ${tone.label.replace(/^\W+\s*/, "")}`]
  lines.push(result.matched.length > 0 ? `Matches: ${result.matched.join(", ")}` : "No matched capabilities")
  if (result.riskLevel === "HIGH") lines.push("High risk: looks like a ghost or scam posting")
  pill.title = lines.join("\n")
  shadow.append(style, pill)

  mount.setAttribute(BADGED_ATTR, "1")
  mount.after(host)
  registry.set(mount, { host, key: result.key, verdict: result.verdict, riskLevel: result.riskLevel })
  return shadow
}

interface Target {
  key: string
  mount: Element
  posting: QualifyPosting
}

export interface BadgeRunnerDeps {
  doc: Document
  getUrl: () => string
  send: (postings: QualifyPosting[]) => Promise<QualifyReply>
  extract: (doc: Document) => Partial<ClippedJob>
  now?: () => number
}

/** After a failed request (rate limit, network), unknown keys wait this long. */
const RETRY_AFTER_MS = 60_000

/**
 * The scan loop, minus the MutationObserver (the entry script owns that). `scan()` is
 * safe to call any number of times: known verdicts are drawn from memory, only unknown
 * keys are requested, and a key is never in flight twice.
 */
export function createBadgeRunner(deps: BadgeRunnerDeps) {
  const now = deps.now ?? Date.now
  /** key → verdict, or null when the server returned none for it. */
  const verdicts = new Map<string, BadgeVerdict | null>()
  const inFlight = new Set<string>()
  const registry = new WeakMap<Element, Mounted>()
  let stopped = false
  let retryAt = 0

  function collect(): Target[] {
    const url = deps.getUrl()
    const site = siteFor(url)
    if (!site) return []
    const adapter = adapterFor(site)
    const targets: Target[] = []

    const detailKey = adapter.detailKey(url)
    const anchor = detailKey ? adapter.detailTitleAnchor(deps.doc) : null
    if (detailKey && anchor) {
      const job = deps.extract(deps.doc)
      const title = job.jobTitle || anchor.textContent?.replace(/\s+/g, " ").trim() || ""
      if (title) {
        targets.push({
          key: detailKey,
          mount: anchor,
          posting: {
            key: detailKey,
            url,
            title,
            companyName: job.companyName || undefined,
            location: job.location || undefined,
            workType: job.workType ?? null,
            description: job.jobDescription?.slice(0, MAX_DESCRIPTION_LENGTH) || undefined,
          },
        })
      }
    }

    for (const card of adapter.listCards(deps.doc, url)) {
      targets.push({
        key: card.key,
        mount: card.mount,
        posting: {
          key: card.key,
          url: card.key,
          title: card.title,
          companyName: card.companyName,
          location: card.location,
        },
      })
    }
    return targets
  }

  function draw(targets: Target[]): void {
    for (const target of targets) {
      const verdict = verdicts.get(target.key)
      if (verdict) renderBadge(target.mount, verdict, registry)
    }
  }

  async function request(postings: QualifyPosting[]): Promise<void> {
    for (const posting of postings) inFlight.add(posting.key)
    let reply: QualifyReply
    try {
      reply = await deps.send(postings)
    } catch {
      reply = { ok: false, reason: "network" }
    } finally {
      for (const posting of postings) inFlight.delete(posting.key)
    }
    if (!reply || !reply.ok) {
      // Signed out or a rejected token will not fix itself on this page.
      if (reply?.reason === "signed-out" || reply?.reason === "unauthorized") stopped = true
      else retryAt = now() + RETRY_AFTER_MS
      return
    }
    if (!reply.profileComplete) {
      stopped = true
      return
    }
    const byKey = new Map(reply.results.map((result) => [result.key, result]))
    for (const posting of postings) verdicts.set(posting.key, byKey.get(posting.key) ?? null)
  }

  async function scan(): Promise<void> {
    if (stopped) return
    const targets = collect()
    draw(targets)
    if (now() < retryAt) return

    const unknown = new Map<string, QualifyPosting>()
    for (const target of targets) {
      if (verdicts.has(target.key) || inFlight.has(target.key) || unknown.has(target.key)) continue
      unknown.set(target.key, target.posting)
    }
    if (unknown.size === 0) return
    const postings = [...unknown.values()]
    const batches: Promise<void>[] = []
    for (let i = 0; i < postings.length; i += MAX_POSTINGS_PER_MESSAGE) {
      batches.push(request(postings.slice(i, i + MAX_POSTINGS_PER_MESSAGE)))
    }
    await Promise.all(batches)
    if (!stopped) draw(collect())
  }

  return { scan, isStopped: () => stopped }
}
