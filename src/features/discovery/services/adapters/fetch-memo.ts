/**
 * Per-URL fetch memo for sources that cannot search.
 *
 * `runDiscovery` fans out up to five derived queries across every adapter. The
 * board endpoints take no search term, so all five queries request byte-for-byte
 * identical JSON — several hundred KB each for a Lever board. This collapses
 * that to one request per URL: concurrent callers share the in-flight promise,
 * and a later query inside the same run reuses the response text.
 *
 * ## The shared request has its own lifetime
 *
 * The request must not inherit the first caller's `AbortSignal`. It used to:
 * when query 1's budget fired, the shared fetch died and queries 2-5 — whose own
 * budgets had not fired — saw an `AbortError` they could not explain, and were
 * reported as broken sources rather than slow ones (measured live on a Lever
 * board, 2026-09-14). The request now runs on its own controller and is
 * cancelled only when
 *
 * - **every** waiter has aborted, so nobody is left to read the bytes, or
 * - its own {@link ADAPTER_FETCH_BUDGET_MS} budget fires.
 *
 * A single caller that aborts simply stops waiting: it rejects with its own
 * reason and leaves the request running for the others.
 *
 * Only successes are held. A non-OK status or a thrown request is evicted, so
 * the next call retries the source rather than inheriting a stale failure.
 */

/** Long enough to cover one discovery run, short enough that boards stay fresh. */
export const FETCH_MEMO_TTL_MS = 60_000

/**
 * Ceiling on one (adapter × query) call, and on the shared request behind it.
 *
 * One constant, in the module both sides can import: `runDiscovery` gives each
 * adapter call an `AbortSignal.timeout` of this, and the board adapters hand the
 * same number to their memoized request. If the two could drift, a request would
 * either outlive the call that wanted it or die before the call gave up. Lives
 * here rather than in the action because a `"use server"` file may only export
 * async functions.
 */
export const ADAPTER_FETCH_BUDGET_MS = 7_000

/** The response as text; adapters parse it themselves so the body is reusable. */
export interface MemoizedResponse {
  ok: boolean
  status: number
  text: string
}

interface MemoEntry {
  expiresAt: number
  response: Promise<MemoizedResponse>
  /** Cancels the shared request. Only the rules above may pull this. */
  controller: AbortController
  /** One token per caller still waiting. Empty means nobody wants the bytes. */
  waiting: Set<symbol>
}

const memo = new Map<string, MemoEntry>()

/** Test seam — the memo is module state and would otherwise leak between cases. */
export function clearFetchMemo(): void {
  memo.clear()
}

/**
 * True for the two ways a request ends because a deadline or a cancel fired,
 * rather than because the source misbehaved. `AbortSignal.timeout` rejects with
 * `TimeoutError`, a manual abort with `AbortError`, and a caller that shared a
 * memoized request can see either — so "slow" is never reported as "broken".
 */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const name = (err as { name?: unknown }).name
  return name === "AbortError" || name === "TimeoutError"
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError")
}

/**
 * Joins a caller to an entry: it gets the shared response, but its own abort
 * only ends its own wait. The last waiter to leave cancels the request.
 */
function join(entry: MemoEntry, signal: AbortSignal | null | undefined): Promise<MemoizedResponse> {
  if (signal?.aborted) return Promise.reject(abortReason(signal))

  const token = Symbol("waiter")
  entry.waiting.add(token)

  return new Promise<MemoizedResponse>((resolve, reject) => {
    const own = signal
    const onAbort = own
      ? () => {
          entry.waiting.delete(token)
          // Nobody left who will read the response: paying for the rest of it
          // helps no one. Any other waiter keeps the request alive.
          if (entry.waiting.size === 0) entry.controller.abort(abortReason(own))
          reject(abortReason(own))
        }
      : null

    if (own && onAbort) own.addEventListener("abort", onAbort, { once: true })

    entry.response.then(
      (value) => {
        if (own && onAbort) own.removeEventListener("abort", onAbort)
        entry.waiting.delete(token)
        resolve(value)
      },
      (err: unknown) => {
        if (own && onAbort) own.removeEventListener("abort", onAbort)
        entry.waiting.delete(token)
        reject(err)
      }
    )
  })
}

/**
 * `memoKey` defaults to the URL, which is the whole request for the GET boards.
 * Workday searches one URL with a POST body that changes per query, so it
 * passes a key that includes the body — two different searches must not share
 * an entry.
 *
 * `init.signal` is the *caller's* signal: it decides how long this caller
 * waits, never how long the shared request lives.
 */
export function fetchMemoized(
  url: string,
  init: RequestInit,
  memoKey: string = url,
  budgetMs: number = ADAPTER_FETCH_BUDGET_MS
): Promise<MemoizedResponse> {
  const cached = memo.get(memoKey)
  if (cached && cached.expiresAt > Date.now()) return join(cached, init.signal)

  const controller = new AbortController()
  const budget = AbortSignal.timeout(budgetMs)
  budget.addEventListener("abort", () => controller.abort(budget.reason), { once: true })

  const response = (async (): Promise<MemoizedResponse> => {
    const res = await fetch(url, { ...init, signal: controller.signal })
    return { ok: res.ok, status: res.status, text: await res.text() }
  })()

  const entry: MemoEntry = {
    expiresAt: Date.now() + FETCH_MEMO_TTL_MS,
    response,
    controller,
    waiting: new Set(),
  }
  memo.set(memoKey, entry)

  // Evict anything that is not a usable success. Both branches are handled, so
  // this never surfaces as an unhandled rejection.
  void response.then(
    (result) => {
      if (!result.ok) memo.delete(memoKey)
    },
    () => memo.delete(memoKey)
  )

  return join(entry, init.signal)
}
