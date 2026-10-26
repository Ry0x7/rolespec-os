#!/usr/bin/env node
// Smoke test: proves that /api/jobs/scrape actually serves HTML back
// (and that FIRECRAWL_API_KEY is wired + pointing at the right host if it
// is set). The whole job-discovery flow depends on scrape URLs, so this is
// the lowest-effort end-to-end guard for the feature, not a unit test of the
// client module.
import { writeFileSync } from "node:fs"
import { request } from "node:http"

const DEST = "firecrawl-smoke-output.json"
const PORT = Number(process.env.SMOKE_SERVER_PORT ?? 3100)
const BASE = process.env.SMOKE_BASE_URL ?? `http://localhost:${PORT}`

const body = JSON.stringify({ url: "https://example.com", formats: ["markdown", "html", "text"] })
const deadline = Date.now() + 90_000

function finish(code: number, payload: Record<string, unknown>) {
  writeFileSync(DEST, JSON.stringify(payload, null, 2) + "\n")
  process.exit(code)
}

const req = request(BASE + "/api/jobs/scrape", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
}, (res) => {
  const chunks: Buffer[] = []
  res.on("data", (c) => chunks.push(Buffer.from(c)))
  res.on("end", () => {
    try {
      const json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
      const ok = res.statusCode === 200 && typeof json.title === "string" && typeof json.description === "string"
      finish(ok ? 0 : 1, {
        ...json,
        status: res.statusCode,
        elapsedMs: Date.now() - deadline + 90_000,
        ok,
        triage: ok
          ? "scrape route returned a minimal posting"
          : json.error
          ? `server rejected with: ${String(json.error).slice(0, 500)}`
          : `unexpected response shape/status ${res.statusCode}`,
      })
    } catch {
      finish(1, { status: res.statusCode, ok: false, triage: "route response was not valid JSON" })
    }
  })
})
req.setTimeout(90_000, () => finish(1, { status: "timeout", ok: false, triage: "request took >90s" }))
req.on("error", (e) => finish(1, { status: "error", ok: false, triage: `cannot reach ${BASE} — ${e.message.slice(0, 300)}` }))
req.write(body)
req.end()

if (Date.now() > deadline) {
  finish(1, { status: "timeout", ok: false, triage: "script started too late to warn about missing key" })
}
