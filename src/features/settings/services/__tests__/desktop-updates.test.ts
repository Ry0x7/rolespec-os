import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  DESKTOP_UPDATE_SETTINGS_FILE,
  desktopUpdatesFilePath,
  parseDesktopUpdateSettings,
  readDesktopUpdateSettings,
  writeDesktopUpdateSettings,
} from "../desktop-updates"

const originalDesktop = process.env.ROLSPEC_DESKTOP
const originalDataDir = process.env.ROLSPEC_DATA_DIR

let root = ""

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "rolespec-desktop-updates-"))
  process.env.ROLSPEC_DESKTOP = "1"
  process.env.ROLSPEC_DATA_DIR = root
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  if (originalDesktop === undefined) delete process.env.ROLSPEC_DESKTOP
  else process.env.ROLSPEC_DESKTOP = originalDesktop
  if (originalDataDir === undefined) delete process.env.ROLSPEC_DATA_DIR
  else process.env.ROLSPEC_DATA_DIR = originalDataDir
})

describe("desktop update settings", () => {
  it("defaults to checking when the file does not exist", async () => {
    await expect(readDesktopUpdateSettings()).resolves.toEqual({ autoCheck: true })
  })

  it("writes to config/updates.json and reads the saved value back", async () => {
    await writeDesktopUpdateSettings({ autoCheck: false })

    const file = path.join(root, "config", DESKTOP_UPDATE_SETTINGS_FILE)
    expect(desktopUpdatesFilePath()).toBe(file)
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ autoCheck: false })
    await expect(readDesktopUpdateSettings()).resolves.toEqual({ autoCheck: false })
  })

  it("keeps checks enabled for malformed or incomplete files", async () => {
    expect(parseDesktopUpdateSettings("not json")).toEqual({ autoCheck: true })
    expect(parseDesktopUpdateSettings('{"autoCheck":"no"}')).toEqual({ autoCheck: true })
    expect(parseDesktopUpdateSettings("{}")).toEqual({ autoCheck: true })
    expect(parseDesktopUpdateSettings('{"autoCheck":false}')).toEqual({ autoCheck: false })
  })

  it("does not invent a path without a desktop data root", () => {
    delete process.env.ROLSPEC_DATA_DIR

    expect(desktopUpdatesFilePath()).toBeNull()
  })

  it("rejects a write without a desktop data root", async () => {
    delete process.env.ROLSPEC_DATA_DIR

    await expect(writeDesktopUpdateSettings({ autoCheck: false })).rejects.toThrow(
      "desktop data directory"
    )
  })

  it("reads a hand-edited file", async () => {
    const file = path.join(root, "config", DESKTOP_UPDATE_SETTINGS_FILE)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '{"autoCheck": false}\n', "utf8")

    await expect(readDesktopUpdateSettings()).resolves.toEqual({ autoCheck: false })
  })
})
