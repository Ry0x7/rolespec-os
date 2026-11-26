import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const { mockAuth, mockRevalidatePath } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockRevalidatePath: vi.fn(),
}))

vi.mock("@/features/auth/config", () => ({ auth: mockAuth }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))

import {
  getDesktopUpdateStatus,
  requestDesktopUpdateCheck,
  updateDesktopAutoCheck,
} from "../desktop-updates.actions"

const originalDesktop = process.env.ROLSPEC_DESKTOP
const originalDataDir = process.env.ROLSPEC_DATA_DIR

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

describe("requestDesktopUpdateCheck", () => {
  it("refuses without a session", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await requestDesktopUpdateCheck()).toEqual({ error: "Unauthorized" })
    await expect(
      readFile(path.join(root, "config", "update-check.json"), "utf8")
    ).rejects.toThrow()
  })

  it("refuses outside the desktop runtime", async () => {
    delete process.env.ROLSPEC_DESKTOP

    expect(await requestDesktopUpdateCheck()).toEqual({
      error: "Update settings are only available in the desktop app.",
    })
  })

  it("writes a UUID request for the shell", async () => {
    const result = await requestDesktopUpdateCheck()

    expect(result).toEqual({ id: expect.stringMatching(UUID) })
    const id = (result as { id: string }).id
    expect(
      JSON.parse(await readFile(path.join(root, "config", "update-check.json"), "utf8"))
    ).toEqual({ id })
  })

  it("reports a request that could not be written", async () => {
    // A file where the config directory should be makes mkdir fail.
    await writeFile(path.join(root, "config"), "not a directory", "utf8")

    expect(await requestDesktopUpdateCheck()).toEqual({
      error: "Could not start an update check.",
    })
  })
})

describe("getDesktopUpdateStatus", () => {
  it("refuses without a session", async () => {
    mockAuth.mockResolvedValue(null)

    expect(await getDesktopUpdateStatus()).toEqual({ error: "Unauthorized" })
  })

  it("refuses outside the desktop runtime", async () => {
    delete process.env.ROLSPEC_DESKTOP

    expect(await getDesktopUpdateStatus()).toEqual({
      error: "Update settings are only available in the desktop app.",
    })
  })

  it("returns null before the shell answers", async () => {
    expect(await getDesktopUpdateStatus()).toEqual({ status: null })
  })

  it("returns the shell's answer", async () => {
    const file = path.join(root, "config", "update-status.json")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      JSON.stringify({ id: "request-1", state: "upToDate", currentVersion: "2.1.0" }),
      "utf8"
    )

    expect(await getDesktopUpdateStatus()).toEqual({
      status: { id: "request-1", state: "upToDate", currentVersion: "2.1.0" },
    })
  })
})
