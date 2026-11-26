import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const { mockAuth, mockRevalidatePath } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRevalidatePath: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))

import { updateDesktopAutoCheck } from "../desktop-updates.actions"

const originalDesktop = process.env.ROLSPEC_DESKTOP
const originalDataDir = process.env.ROLSPEC_DATA_DIR

let root = ""

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "rolespec-desktop-updates-action-"))
  process.env.ROLSPEC_DESKTOP = "1"
  process.env.ROLSPEC_DATA_DIR = root
  mockAuth.mockResolvedValue({ user: { id: "user-1" } })
})

afterEach(async () => {
  vi.clearAllMocks()
  await rm(root, { recursive: true, force: true })
  if (originalDesktop === undefined) delete process.env.ROLSPEC_DESKTOP
  else process.env.ROLSPEC_DESKTOP = originalDesktop
  if (originalDataDir === undefined) delete process.env.ROLSPEC_DATA_DIR
  else process.env.ROLSPEC_DATA_DIR = originalDataDir
})

describe("updateDesktopAutoCheck", () => {
  it("refuses without a session", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await updateDesktopAutoCheck({ autoCheck: false })).toEqual({
      error: "Unauthorized",
    })
    await expect(
      readFile(path.join(root, "config", "updates.json"), "utf8")
    ).rejects.toThrow()
  })

  it("refuses outside the desktop runtime", async () => {
    delete process.env.ROLSPEC_DESKTOP

    expect(await updateDesktopAutoCheck({ autoCheck: false })).toEqual({
      error: "Update settings are only available in the desktop app.",
    })
  })

  it("writes the preference and revalidates the settings page", async () => {
    expect(await updateDesktopAutoCheck({ autoCheck: false })).toEqual({ success: true })

    expect(
      JSON.parse(await readFile(path.join(root, "config", "updates.json"), "utf8"))
    ).toEqual({ autoCheck: false })
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings/preferences")
  })

  it("rejects a non-boolean preference", async () => {
    expect(
      await updateDesktopAutoCheck({ autoCheck: "no" } as unknown as { autoCheck: boolean })
    ).toEqual({ error: "Invalid input" })
  })
})
