import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"

const { mockAuth, mockPrisma, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    jobApplication: { findMany: vi.fn(), count: vi.fn() },
    playerProfile: { findUnique: vi.fn() },
  },
  mockRedirect: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("@/shared/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))
// `getUserDayStart` reads the tz cookie through `next/headers`, which has no
// request scope here.
vi.mock("@/shared/lib/user-day", () => ({
  getUserDayStart: async () => new Date("2026-10-01T00:00:00.000Z"),
}))
// The board is a client drag-and-drop surface; the header is what this file is
// about, so it is stubbed out.
vi.mock("@/features/workspace/components/workspace-board", () => ({
  WorkspaceBoard: () => <div data-testid="workspace-board" />,
}))

import WorkspacePage from "../page"

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  mockRedirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
  mockPrisma.jobApplication.findMany.mockResolvedValue([])
  mockPrisma.jobApplication.count.mockResolvedValue(0)
  mockPrisma.playerProfile.findUnique.mockResolvedValue(null)
})

describe("workspace page header cross-links", () => {
  // Paired with the "Board" link in the `/jobs` header — the board must lead
  // back to the list without going through the nav.
  it("links back to the job list from the header", async () => {
    render(await WorkspacePage())

    const list = screen.getByRole("link", { name: /list/i })
    expect(list.getAttribute("href")).toBe("/jobs")
  })
})
