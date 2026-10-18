import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("node:dns", () => {
  const promises = {
    lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
  }
  return { promises, default: { promises } }
})

const { undiciFetchMock, agentInstances } = vi.hoisted(() => ({
  undiciFetchMock: vi.fn(),
  agentInstances: [] as Array<{ options: AgentOptions }>,
}))

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  addresses?: string | Array<{ address: string; family: number }>,
  family?: number
) => void

type AgentOptions = {
  connect: {
    lookup: (hostname: string, options: { all?: boolean }, callback: LookupCallback) => void
  }
}

vi.mock("undici", () => {
  class Agent {
    options: AgentOptions
    constructor(options: AgentOptions) {
      this.options = options
      agentInstances.push(this)
    }
  }
  return { Agent, fetch: undiciFetchMock }
})

import { promises as dns } from "node:dns"

import { fetchPortfolioText } from "../fetch-portfolio"
import { PORTFOLIO_FETCH_TIMEOUT_MS } from "../../constants/portfolio"

const mockedLookup = vi.mocked(dns.lookup)

/** Queues the responses the (mocked) undici fetch hands back, in order. */
function respondsWith(...responses: Response[]) {
  for (const response of responses) {
    undiciFetchMock.mockResolvedValueOnce(response as never)
  }
  return undiciFetchMock
}

/** Answers every call with the same response. */
function alwaysResponds(response: () => Response) {
  undiciFetchMock.mockImplementation(async () => response() as never)
  return undiciFetchMock
}

function htmlResponse(body: string, headers: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  })
}

function resolvesTo(...addresses: string[]) {
  mockedLookup.mockResolvedValue(
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    })) as never
  )
}

describe("fetchPortfolioText (runtime)", () => {
  beforeEach(() => {
    undiciFetchMock.mockReset()
    mockedLookup.mockReset()
    resolvesTo("93.184.216.34")
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns extracted text on a happy path", async () => {
    respondsWith(
      htmlResponse("<html><head><title>Ry</title></head><body><h1>Portfolio</h1><script>x()</script></body></html>")
    )
    const result = await fetchPortfolioText("https://example.com")
    expect(result.ok).toBe(true)
  })

  it("routes the request through the pinned undici agent", async () => {
    respondsWith(htmlResponse("<body>Hi</body>"))
    await fetchPortfolioText("https://example.com")
    const init = undiciFetchMock.mock.calls[0][1] as { dispatcher?: unknown }
    expect(agentInstances.length).toBeGreaterThan(0)
    expect(init.dispatcher).toBe(agentInstances[0])
    expect(typeof agentInstances[0].options.connect.lookup).toBe("function")
  })

  it("follows a redirect and re-validates it", async () => {
    const f = respondsWith(
      new Response(null, { status: 302, headers: { location: "/final" } }),
      htmlResponse("<body>Final page content</body>")
    )
    const result = await fetchPortfolioText("https://example.com")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe("Final page content")
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("blocks a redirect to localhost", async () => {
    alwaysResponds(() =>
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8080/" } })
    )
    const result = await fetchPortfolioText("https://example.com")
    expect(result).toEqual({ ok: false, code: "BLOCKED_URL" })
  })

  it("blocks a redirect to the cloud metadata endpoint", async () => {
    alwaysResponds(() =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      })
    )
    const result = await fetchPortfolioText("https://example.com")
    expect(result).toEqual({ ok: false, code: "BLOCKED_URL" })
  })

  it("blocks a redirect to a hostname that resolves privately", async () => {
    respondsWith(
      new Response(null, { status: 302, headers: { location: "https://intranet.example.com/" } })
    )
    // First hop resolves publicly, the redirect target resolves to a private IP.
    mockedLookup.mockReset()
    mockedLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
    mockedLookup.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }] as never)
    const result = await fetchPortfolioText("https://example.com")
    expect(result).toEqual({ ok: false, code: "BLOCKED_URL" })
    expect(undiciFetchMock).toHaveBeenCalledTimes(1)
  })

  it("rejects a redirect to a file: URL", async () => {
    respondsWith(
      new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } })
    )
    const result = await fetchPortfolioText("https://example.com")
    expect(result).toEqual({ ok: false, code: "INVALID_URL" })
    expect(undiciFetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(["data:text/html,<h1>hi</h1>", "gopher://example.com/1"])(
    "rejects %s without a request",
    async (url) => {
      const result = await fetchPortfolioText(url)
      expect(result).toEqual({ ok: false, code: "INVALID_URL" })
      expect(undiciFetchMock).not.toHaveBeenCalled()
    }
  )

  it("gives up after 3 redirects", async () => {
    const f = alwaysResponds(() =>
      new Response(null, { status: 302, headers: { location: "https://example.com/next" } })
    )
    const result = await fetchPortfolioText("https://example.com")
    expect(result).toEqual({ ok: false, code: "FETCH_FAILED" })
    // Initial request + PORTFOLIO_FETCH_MAX_REDIRECTS hops.
    expect(f).toHaveBeenCalledTimes(4)
  })

  it("rejects a non-html content type", async () => {
    respondsWith(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    )
    const result = await fetchPortfolioText("https://example.com")
    expect(result).toEqual({ ok: false, code: "UNSUPPORTED_CONTENT" })
  })

  it("rejects an oversized content-length", async () => {
    respondsWith(htmlResponse("<body>x</body>", { "content-length": String(4 * 1024 * 1024) }))
    const result = await fetchPortfolioText("https://example.com")
    expect(result).toEqual({ ok: false, code: "TOO_LARGE" })
  })

  it("rejects an oversized streamed body with no content-length", async () => {
    const big = "<body>" + "a".repeat(3.5 * 1024 * 1024) + "</body>"
    respondsWith(new Response(big, { status: 200, headers: { "content-type": "text/html" } }))
    const result = await fetchPortfolioText("https://example.com")
    expect(result).toEqual({ ok: false, code: "TOO_LARGE" })
  })

  it("counts decoded bytes, so a small compressed body that expands is still TOO_LARGE", async () => {
    // The cap is enforced on what the reader yields (already decompressed), not
    // on the declared transfer size — a gzip bomb hits it all the same.
    const chunk = new TextEncoder().encode("a".repeat(512 * 1024))
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk)
        sent += chunk.byteLength
        if (sent > 4 * 1024 * 1024) controller.close()
      },
    })
    respondsWith(
      new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-encoding": "gzip",
          "content-length": "2048",
        },
      })
    )
    const result = await fetchPortfolioText("https://example.com")
    expect(result).toEqual({ ok: false, code: "TOO_LARGE" })
  })

  it("maps an abort to TIMEOUT", async () => {
    undiciFetchMock.mockImplementation(async () => {
      const err = new Error("aborted")
      err.name = "AbortError"
      throw err
    })
    const result = await fetchPortfolioText("https://example.com")
    expect(result).toEqual({ ok: false, code: "TIMEOUT" })
  })

  it("aborts a hop that never resolves once the shared timer fires", async () => {
    vi.useFakeTimers()
    undiciFetchMock.mockImplementation(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const err = new Error("aborted")
            err.name = "AbortError"
            reject(err)
          })
        })
    )
    const pending = fetchPortfolioText("https://example.com")
    await vi.advanceTimersByTimeAsync(PORTFOLIO_FETCH_TIMEOUT_MS + 10)
    await expect(pending).resolves.toEqual({ ok: false, code: "TIMEOUT" })
  })

  it("maps a 404 to FETCH_FAILED", async () => {
    respondsWith(new Response("nope", { status: 404 }))
    const result = await fetchPortfolioText("https://example.com")
    expect(result).toEqual({ ok: false, code: "FETCH_FAILED" })
  })

  it("fails the fetch when the connect-time lookup sees a rebound private address", async () => {
    // Rebinding: the pre-check resolves publicly, the connector's own lookup —
    // the one the socket would use — comes back private.
    mockedLookup.mockReset()
    mockedLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
    mockedLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never)

    // Stand in for undici's connector: resolve through the agent's lookup and
    // only "connect" when it approves.
    undiciFetchMock.mockImplementation(
      (url: string | URL, init: { dispatcher: { options: AgentOptions } }) =>
        new Promise((resolve, reject) => {
          const hostname = new URL(String(url)).hostname
          init.dispatcher.options.connect.lookup(hostname, { all: true }, (err) => {
            if (err) reject(err)
            else resolve(htmlResponse("<body>internal secrets</body>"))
          })
        })
    )

    const result = await fetchPortfolioText("https://rebind.example.com")
    expect(result).toEqual({ ok: false, code: "FETCH_FAILED" })
    expect(mockedLookup).toHaveBeenCalledTimes(2)
  })
})
