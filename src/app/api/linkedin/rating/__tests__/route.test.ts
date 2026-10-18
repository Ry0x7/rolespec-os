// @vitest-environment node
import { describe, it, expect } from "vitest"
import { POST } from "../route"

describe("POST /api/linkedin/rating", () => {
  it("returns 404 and FEATURE_DISABLED", async () => {
    const res = await POST(new Request("http://localhost/api/linkedin/rating", { method: "POST" }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe("FEATURE_DISABLED")
  })
})
