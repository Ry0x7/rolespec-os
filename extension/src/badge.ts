/**
 * Content script for the in-page fit badges, emitted as a classic script at
 * `dist/assets/badge.js` (content scripts cannot be ES modules).
 *
 * It only ever runs on a supported job board the user has granted: the background
 * worker registers it for those origins alone (`syncBadgeScripts`), top frame only.
 * The one listener it adds is a MutationObserver on document.body; it never fetches —
 * verdicts come from the worker over `chrome.runtime.sendMessage`. See badge-core.ts
 * for the page-safety rules.
 */
import type { QualifyPosting } from "./api"
import { createBadgeRunner, QUALIFY_MESSAGE, type QualifyReply } from "./badge-core"
import { siteFor } from "./badge-sites"
import { extractJobPosting } from "./extractor"

const STARTED_FLAG = "__rolespecBadgeStarted"
const DEBOUNCE_MS = 300

function start(): void {
  const scope = globalThis as unknown as Record<string, unknown>
  // The worker may inject this file into a tab that the registered script already ran
  // in (right after a grant); both copies share this isolated world, so one wins.
  if (scope[STARTED_FLAG]) return
  if (window.top !== window) return
  if (!siteFor(location.href)) return
  scope[STARTED_FLAG] = true

  let observer: MutationObserver | null = null
  const send = async (postings: QualifyPosting[]): Promise<QualifyReply> => {
    try {
      const reply = (await chrome.runtime.sendMessage({ type: QUALIFY_MESSAGE, postings })) as QualifyReply | undefined
      return reply ?? { ok: false, reason: "no-reply" }
    } catch {
      // "Extension context invalidated": the extension was reloaded or removed. This
      // copy can never talk to a worker again, so it stops watching the page.
      if (!chrome.runtime?.id) observer?.disconnect()
      return { ok: false, reason: "network" }
    }
  }

  const runner = createBadgeRunner({
    doc: document,
    getUrl: () => location.href,
    send,
    extract: extractJobPosting,
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (runner.isStopped()) {
        observer?.disconnect()
        return
      }
      void runner.scan()
    }, DEBOUNCE_MS)
  }

  observer = new MutationObserver(schedule)
  if (document.body) observer.observe(document.body, { childList: true, subtree: true })
  void runner.scan()
}

start()
