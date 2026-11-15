import { afterEach, describe, expect, it, vi } from "vitest"
import { apiRequest, ApiError } from "../api-client"

afterEach(() => vi.unstubAllGlobals())
describe("same-origin browser transport", () => {
  it("preserves HTTP error and code, never returns invented success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Review changed", code: "CONFLICT" }), { status: 409 })))
    await expect(apiRequest("/api/review-tasks/1")).rejects.toMatchObject({ status: 409, code: "CONFLICT", message: "Review changed" })
  })
  it("does not label FormData as JSON and always uses same-origin credentials", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetch)
    await apiRequest("/api/intake/upload", { method: "POST", body: new FormData() })
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store", headers: {} })
  })
  it("rejects an unreadable successful response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Offline proxy</html>")))
    await expect(apiRequest("/api/ranking")).rejects.toBeInstanceOf(ApiError)
  })
})
