import { NextResponse } from "next/server"
import { z } from "zod"
import { resolveApiUserId } from "@/features/auth/api-auth"
import {
  fetchPublicUrl,
  WebSourceError,
} from "@/features/career-profile/services/web-presence.service"
import { RATE_LIMIT_BUCKETS, consumeRateLimit } from "@/shared/lib/rate-limit"

export const dynamic = "force-dynamic"
export const maxDuration = 30

const bodySchema = z.object({
  url: z.string().url().max(2000),
  formats: z.array(z.enum(["markdown", "html", "text"])).max(3).optional(),
})

const SCRAPE_TIMEOUT_MS = 20_000
const RATE_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 }

/**
 * `POST /api/jobs/scrape` — server-side job-discovery fetch.
 * Uses Firecrawl when `FIRECRAWL_API_KEY` is set (proper scraping for
 * JS-heavy boards: Greenhouse/Lever/Workday/Ashby), otherwise falls back to a
 * plain fetch with a browser UA so discovery still works without AI or keys.
 * Single-owner guarded; rate-limited per user; 20s timeout; no AI required.
 */
export async function POST(req: Request) {
  const userId = await resolveApiUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const allowed = await consumeRateLimit(RATE_LIMIT_BUCKETS.DISCOVERY_ADD_URL, userId, RATE_LIMIT)
  if (!allowed) return NextResponse.json({ error: "Too many scrapes. Try again later." }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const apiKey = process.env.FIRECRAWL_API_KEY?.trim() || ""
  const baseUrl = (process.env.FIRECRAWL_BASE_URL?.trim().replace(/\/$/, "") || "https://api.firecrawl.dev").replace(/\/$/, "")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS)
  try {
    if (apiKey) {
      const res = await fetch(`${baseUrl}/v1/scrape`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          url: parsed.data.url,
          formats: parsed.data.formats ?? ["markdown", "html"],
          onlyMainContent: true,
          waitFor: 1500,
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        return NextResponse.json(
          { error: "Scrape failed", provider: "firecrawl", status: res.status, detail: text.slice(0, 500) },
          { status: 502 }
        )
      }
      const data = (await res.json()) as {
        data?: { markdown?: string; html?: string; text?: string; metadata?: Record<string, unknown> }
      }
      const payload = data.data ?? {}
      return NextResponse.json(
        {
          provider: "firecrawl",
          url: parsed.data.url,
          markdown: (payload.markdown ?? "").slice(0, 50000),
          html: typeof payload.html === "string" ? payload.html.slice(0, 200000) : undefined,
          text: typeof payload.text === "string" ? payload.text.slice(0, 50000) : undefined,
          metadata: payload.metadata ?? null,
        },
        { headers: { "Cache-Control": "private, max-age=60, s-maxage=0" } }
      )
    }

    // No-key fallback: the same public-only fetch the portfolio scanner uses,
    // so this route cannot be pointed at loopback, RFC1918 or metadata hosts.
    const result = await fetchPublicUrl(parsed.data.url, {
      accept: (contentType) =>
        !contentType ||
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml+xml"),
    })
    return NextResponse.json(
      { provider: "direct", url: result.url, html: result.body.slice(0, 200000) },
      { headers: { "Cache-Control": "private, max-age=60, s-maxage=0" } }
    )
  } catch (err) {
    const timedOut =
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof WebSourceError && err.code === "TIMEOUT")
    return NextResponse.json(
      { error: timedOut ? "Scrape timed out" : "Scrape failed" },
      { status: timedOut ? 504 : 502 }
    )
  } finally {
    clearTimeout(timer)
  }
}
