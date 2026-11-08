// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyApiToken: vi.fn(),
  userFindUnique: vi.fn(),
  careerProfileFindUnique: vi.fn(),
  playerProfileFindUnique: vi.fn(),
}))

vi.mock("@/features/settings/services/api-token", () => ({
  verifyApiToken: mocks.verifyApiToken,
}))
vi.mock("@/shared/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    careerProfile: { findUnique: mocks.careerProfileFindUnique },
    playerProfile: { findUnique: mocks.playerProfileFindUnique },
  },
}))

import { GET, OPTIONS } from "../route"

const CAREER = {
  contactFullName: "Marisol Reyes",
  contactEmail: "marisol@example.com",
  contactPhone: "+63 917 555 0100",
  contactLocation: "Manila, Philippines",
  linkedinUrl: "https://linkedin.com/in/marisol",
  githubUrl: "https://github.com/marisol",
  websiteUrl: "https://marisol.dev",
  workAuthorization: "PH citizen",
  requiresSponsorship: true,
  salaryMin: 45000,
  salaryMax: 55000,
  salaryCurrency: "PHP",
}

function get({ token = "rspec_valid", origin }: { token?: string | null; origin?: string } = {}) {
  const headers: Record<string, string> = {}
  if (token !== null) headers.authorization = `Bearer ${token}`
  if (origin) headers.origin = origin
  return GET(new Request("http://localhost/api/extension/profile", { method: "GET", headers }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyApiToken.mockResolvedValue("user_1")
  mocks.userFindUnique.mockResolvedValue({ name: "Account Name", email: "account@example.com" })
  mocks.careerProfileFindUnique.mockResolvedValue(CAREER)
  mocks.playerProfileFindUnique.mockResolvedValue({
    currentRole: "Registered Nurse",
    targetRole: "Nurse Manager",
  })
})

describe("authentication", () => {
  it("401s without a token and never touches the database", async () => {
    const res = await get({ token: null })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: "Invalid or missing API token",
      code: "UNAUTHORIZED",
    })
    expect(mocks.verifyApiToken).not.toHaveBeenCalled()
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })

  it("401s when the token is revoked", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)
    const res = await get({ token: "rspec_revoked" })
    expect(res.status).toBe(401)
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })

  it("401s when the token resolves to a missing user", async () => {
    mocks.userFindUnique.mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(401)
  })
})

describe("profile payload", () => {
  it("returns contact/preference facts scoped to the token owner", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      profile: {
        fullName: "Marisol Reyes",
        email: "marisol@example.com",
        phone: "+63 917 555 0100",
        location: "Manila, Philippines",
        linkedinUrl: "https://linkedin.com/in/marisol",
        githubUrl: "https://github.com/marisol",
        websiteUrl: "https://marisol.dev",
        currentRole: "Registered Nurse",
        targetRole: "Nurse Manager",
        workAuthorization: "PH citizen",
        requiresSponsorship: true,
        salaryMin: 45000,
        salaryMax: 55000,
        salaryCurrency: "PHP",
      },
    })
    expect(mocks.careerProfileFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1" } }),
    )
    expect(mocks.playerProfileFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1" } }),
    )
  })

  it("falls back to the account identity when no career profile exists", async () => {
    mocks.careerProfileFindUnique.mockResolvedValue(null)
    mocks.playerProfileFindUnique.mockResolvedValue(null)

    const body = await (await get()).json()
    expect(body.profile).toMatchObject({
      fullName: "Account Name",
      email: "account@example.com",
      phone: null,
      currentRole: null,
      targetRole: null,
      workAuthorization: null,
    })
  })

  it("never returns resume text or a token/hash field", async () => {
    const body = await (await get()).json()
    const serialized = JSON.stringify(body).toLowerCase()
    expect(serialized).not.toContain("resume")
    expect(serialized).not.toContain("token")
    expect(serialized).not.toContain("hash")
  })

  it("500s without leaking the database error", async () => {
    mocks.userFindUnique.mockRejectedValue(new Error("connection lost"))
    const res = await get()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: "Could not load your profile",
      code: "SERVER_ERROR",
    })
  })
})

describe("CORS", () => {
  it("reflects extension origins and keeps the preflight narrow", async () => {
    const preflight = await OPTIONS(
      new Request("http://localhost/api/extension/profile", {
        method: "OPTIONS",
        headers: { origin: "chrome-extension://abcdef" },
      }),
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "chrome-extension://abcdef",
    )
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS")
  })

  it("does not reflect a web origin", async () => {
    const res = await get({ origin: "https://evil.example.com" })
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("keeps the allowance on a 401", async () => {
    mocks.verifyApiToken.mockResolvedValue(null)
    const res = await get({ origin: "moz-extension://abcdef" })
    expect(res.status).toBe(401)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("moz-extension://abcdef")
  })
})
