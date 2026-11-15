// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { FETCH_MEMO_TTL_MS, clearFetchMemo, fetchMemoized, isAbortError } from "../fetch-memo"

const URL_A = "https://example.test/board-a"
const URL_B = "https://example.test/board-b"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** A response that only resolves once the test lets it. */
function deferredResponse(body: unknown) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { gate: gate.then(() => jsonResponse(body)), release }
}

/**
 * A request that hangs until the test releases it or the signal it was handed
 * is aborted — the only way to observe whose abort actually reached `fetch`.
 */
function hangingFetch(body: unknown) {
  const state = { signal: undefined as AbortSignal | undefined, release: () => {} }
  const impl = (_url: unknown, init?: RequestInit) => {
    state.signal = init?.signal ?? undefined
    return new Promise<Response>((resolve, reject) => {
      state.release = () => resolve(jsonResponse(body))
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("This operation was aborted", "AbortError")),
        { once: true }
      )
    })
  }
  return { state, impl }
}

beforeEach(() => {
  clearFetchMemo()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("fetchMemoized", () => {
  it("returns the status and body text of a successful response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ jobs: [] }))

    await expect(fetchMemoized(URL_A, {})).resolves.toEqual({
      ok: true,
      status: 200,
      text: '{"jobs":[]}',
    })
  })

  it("shares one in-flight request between concurrent callers", async () => {
    const deferred = deferredResponse({ jobs: [1] })
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => deferred.gate)

    const both = Promise.all([fetchMemoized(URL_A, {}), fetchMemoized(URL_A, {})])
    deferred.release()
    const [first, second] = await both

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.text).toBe('{"jobs":[1]}')
    expect(second.text).toBe(first.text)
  })

  it("serves a later caller from the memo without refetching", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}))

    await fetchMemoized(URL_A, {})
    await fetchMemoized(URL_A, {})

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("keys the memo by URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}))

    await fetchMemoized(URL_A, {})
    await fetchMemoized(URL_B, {})

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("refetches once the TTL has elapsed", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({}))

    await fetchMemoized(URL_A, {})
    vi.advanceTimersByTime(FETCH_MEMO_TTL_MS - 1)
    await fetchMemoized(URL_A, {})
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2)
    await fetchMemoized(URL_A, {})
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not memoize a non-OK response", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => jsonResponse({}, 503))
      .mockImplementation(async () => jsonResponse({ jobs: [] }))

    const failed = await fetchMemoized(URL_A, {})
    expect(failed.ok).toBe(false)
    expect(failed.status).toBe(503)

    // The next call retries the source rather than replaying the outage.
    const retried = await fetchMemoized(URL_A, {})
    expect(retried.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not memoize a thrown request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => {
        throw new Error("ECONNRESET")
      })
      .mockImplementation(async () => jsonResponse({ jobs: [] }))

    await expect(fetchMemoized(URL_A, {})).rejects.toThrow("ECONNRESET")
    await expect(fetchMemoized(URL_A, {})).resolves.toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("fetchMemoized shared-request lifetime", () => {
  it("keeps the shared request alive when one of two callers aborts", async () => {
    const { state, impl } = hangingFetch({ jobs: [1] })
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(impl)

    const first = new AbortController()
    const second = new AbortController()
    const a = fetchMemoized(URL_A, { signal: first.signal })
    const b = fetchMemoized(URL_A, { signal: second.signal })
    // Both waiters are attached before anything aborts.
    await Promise.resolve()

    first.abort()
    await expect(a).rejects.toSatisfy(isAbortError)

    // The first caller's deadline is its own. The request is still running.
    expect(state.signal?.aborted).toBe(false)
    state.release()
    await expect(b).resolves.toMatchObject({ ok: true, text: '{"jobs":[1]}' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("cancels the shared request once every caller has aborted", async () => {
    const { state, impl } = hangingFetch({ jobs: [1] })
    vi.spyOn(globalThis, "fetch").mockImplementation(impl)

    const first = new AbortController()
    const second = new AbortController()
    const a = fetchMemoized(URL_A, { signal: first.signal })
    const b = fetchMemoized(URL_A, { signal: second.signal })
    await Promise.resolve()

    first.abort()
    await expect(a).rejects.toSatisfy(isAbortError)
    expect(state.signal?.aborted).toBe(false)

    second.abort()
    await expect(b).rejects.toSatisfy(isAbortError)
    expect(state.signal?.aborted).toBe(true)
  })

  it("cancels the shared request when its own budget runs out, for every caller", async () => {
    const { state, impl } = hangingFetch({ jobs: [1] })
    vi.spyOn(globalThis, "fetch").mockImplementation(impl)

    // Neither caller's own signal ever fires: only the shared budget does.
    const a = fetchMemoized(URL_A, { signal: new AbortController().signal }, URL_A, 5)
    const b = fetchMemoized(URL_A, { signal: new AbortController().signal }, URL_A, 5)

    await expect(a).rejects.toSatisfy(isAbortError)
    await expect(b).rejects.toSatisfy(isAbortError)
    expect(state.signal?.aborted).toBe(true)
  })
})
