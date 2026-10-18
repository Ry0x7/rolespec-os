// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((url: string) => {
    // Next's `redirect` signals by throwing, and the action relies on that to
    // stop executing. A mock that returned normally would hide a bug here.
    const err = new Error("NEXT_REDIRECT") as Error & { digest: string }
    err.digest = `NEXT_REDIRECT;replace;${url}`
    throw err
  }),
  revalidatePath: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordAttempt: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiTokensByName: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/shared/lib/rate-limit", () => ({
  RATE_LIMIT_BUCKETS: { API_TOKEN_CREATE: "api_token_create" },
  RATE_LIMIT_MESSAGE: "Too many attempts. Please try again later.",
  consumeRateLimit: mocks.consumeRateLimit,
  recordAttempt: mocks.recordAttempt,
}))
vi.mock("../../services/api-token", () => ({
  createApiToken: mocks.createApiToken,
  revokeApiTokensByName: mocks.revokeApiTokensByName,
}))

import { EXTENSION_TOKEN_NAME } from "../../constants/data"
import { connectExtensionAction } from "../extension-connect.actions"

const ID = "a".repeat(32)
const VALID_URI = `https://${ID}.chromiumapp.org/`
const VALID_STATE = "state_abcdef123"

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

/** Runs the action and returns the redirect URL the mock threw, or null. */
async function redirectedTo(data: FormData): Promise<string | null> {
  try {
    await connectExtensionAction(data)
    return null
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? ""
    return digest.startsWith("NEXT_REDIRECT") ? digest.split(";").slice(2).join(";") : null
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "user_1", email: "a@example.com" } })
  mocks.consumeRateLimit.mockResolvedValue(true)
  mocks.revokeApiTokensByName.mockResolvedValue(1)
  mocks.createApiToken.mockResolvedValue({
    token: "rspec_freshtoken",
    summary: { id: "t1", name: EXTENSION_TOKEN_NAME, createdAt: new Date(), lastUsedAt: null },
  })
})

describe("happy path", () => {
  it("mints a token and redirects to the extension with it in the fragment", async () => {
    const url = await redirectedTo(form({ state: VALID_STATE, redirectUri: VALID_URI }))

    expect(mocks.createApiToken).toHaveBeenCalledWith("user_1", EXTENSION_TOKEN_NAME)
    expect(url).toBe(`${VALID_URI}#token=rspec_freshtoken&state=${VALID_STATE}`)
  })

  it("revokes the previous extension token before minting, to dodge the cap", async () => {
    await redirectedTo(form({ state: VALID_STATE, redirectUri: VALID_URI }))

    expect(mocks.revokeApiTokensByName).toHaveBeenCalledWith("user_1", EXTENSION_TOKEN_NAME)
    expect(mocks.revokeApiTokensByName.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createApiToken.mock.invocationCallOrder[0]
    )
  })

  it("consumes a rate-limit attempt and refreshes /settings", async () => {
    await redirectedTo(form({ state: VALID_STATE, redirectUri: VALID_URI }))

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "api_token_create",
      "user_1",
      expect.objectContaining({ max: expect.any(Number) })
    )
    // The consume writes its own row; the separate record call is gone.
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings")
  })
})

describe("refusals", () => {
  it("refuses when nobody is signed in", async () => {
    mocks.auth.mockResolvedValue(null)

    const result = await connectExtensionAction(form({ state: VALID_STATE, redirectUri: VALID_URI }))

    expect(result).toEqual({ error: "You are not signed in." })
    expect(mocks.createApiToken).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it.each([
    ["a foreign redirect target", { state: VALID_STATE, redirectUri: "https://evil.com/" }],
    ["a plain-http target", { state: VALID_STATE, redirectUri: `http://${ID}.chromiumapp.org/` }],
    ["a too-short state", { state: "short", redirectUri: VALID_URI }],
    ["nothing at all", {}],
  ])("re-validates server-side and refuses %s", async (_label, fields) => {
    const result = await connectExtensionAction(form(fields as Record<string, string>))

    expect(result).toHaveProperty("error")
    expect(mocks.createApiToken).not.toHaveBeenCalled()
    expect(mocks.revokeApiTokensByName).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("refuses when rate limited, without minting", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false)

    const result = await connectExtensionAction(form({ state: VALID_STATE, redirectUri: VALID_URI }))

    expect(result).toEqual({ error: "Too many attempts. Please try again later." })
    expect(mocks.createApiToken).not.toHaveBeenCalled()
  })

  it("reports an error rather than redirecting when the write fails", async () => {
    mocks.createApiToken.mockRejectedValue(new Error("connection lost"))

    const result = await connectExtensionAction(form({ state: VALID_STATE, redirectUri: VALID_URI }))

    expect(result).toEqual({ error: "Could not connect the extension. Please try again." })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
