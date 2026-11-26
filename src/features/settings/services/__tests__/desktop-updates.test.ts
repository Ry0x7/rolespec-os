import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  DESKTOP_UPDATE_REQUEST_FILE,
  DESKTOP_UPDATE_SETTINGS_FILE,
  DESKTOP_UPDATE_STATUS_FILE,
  desktopUpdateRequestPath,
  desktopUpdateStatusPath,
  desktopUpdatesFilePath,
  parseDesktopUpdateSettings,
  parseDesktopUpdateStatus,
  readDesktopUpdateSettings,
  readDesktopUpdateStatus,
  writeDesktopUpdateRequest,
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
  it("defaults to checking stable when the file does not exist", async () => {
    await expect(readDesktopUpdateSettings()).resolves.toEqual({
      autoCheck: true,
      channel: "stable",
    })
  })

  it("writes to config/updates.json and reads the saved value back", async () => {
    await writeDesktopUpdateSettings({ autoCheck: false, channel: "beta" })

    const file = path.join(root, "config", DESKTOP_UPDATE_SETTINGS_FILE)
    expect(desktopUpdatesFilePath()).toBe(file)
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      autoCheck: false,
      channel: "beta",
    })
    await expect(readDesktopUpdateSettings()).resolves.toEqual({
      autoCheck: false,
      channel: "beta",
    })
  })

  it("keeps checks enabled and falls back to stable for malformed or incomplete files", async () => {
    expect(parseDesktopUpdateSettings("not json")).toEqual({
      autoCheck: true,
      channel: "stable",
    })
    expect(parseDesktopUpdateSettings('{"autoCheck":"no"}')).toEqual({
      autoCheck: true,
      channel: "stable",
    })
    expect(parseDesktopUpdateSettings("{}")).toEqual({ autoCheck: true, channel: "stable" })
    expect(parseDesktopUpdateSettings('{"autoCheck":false}')).toEqual({
      autoCheck: false,
      channel: "stable",
    })
    expect(parseDesktopUpdateSettings('{"autoCheck":false,"channel":"nightly"}')).toEqual({
      autoCheck: false,
      channel: "stable",
    })
    expect(parseDesktopUpdateSettings('{"channel":"beta"}')).toEqual({
      autoCheck: true,
      channel: "beta",
    })
  })

  it("does not invent a path without a desktop data root", async () => {
    delete process.env.ROLSPEC_DATA_DIR

    expect(desktopUpdatesFilePath()).toBeNull()
  })

  it("rejects a write without a desktop data root", async () => {
    delete process.env.ROLSPEC_DATA_DIR

    await expect(
      writeDesktopUpdateSettings({ autoCheck: false, channel: "stable" })
    ).rejects.toThrow("desktop data directory")
  })

  it("reads a hand-edited file", async () => {
    const file = path.join(root, "config", DESKTOP_UPDATE_SETTINGS_FILE)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '{"autoCheck": false}\n', "utf8")

    await expect(readDesktopUpdateSettings()).resolves.toEqual({
      autoCheck: false,
      channel: "stable",
    })
  })
})

describe("desktop update check bridge", () => {
  it("does not invent request or status paths without a data root", () => {
    delete process.env.ROLSPEC_DATA_DIR

    expect(desktopUpdateRequestPath()).toBeNull()
    expect(desktopUpdateStatusPath()).toBeNull()
  })

  it("writes a request the shell can consume", async () => {
    await writeDesktopUpdateRequest("request-1")

    const file = path.join(root, "config", DESKTOP_UPDATE_REQUEST_FILE)
    expect(desktopUpdateRequestPath()).toBe(file)
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ id: "request-1" })
  })

  it("rejects a request without a desktop data root", async () => {
    delete process.env.ROLSPEC_DATA_DIR

    await expect(writeDesktopUpdateRequest("request-1")).rejects.toThrow(
      "desktop data directory"
    )
  })

  it("accepts a complete status document", () => {
    expect(
      parseDesktopUpdateStatus(
        JSON.stringify({
          id: "request-1",
          state: "downloading",
          currentVersion: "2.1.0",
          version: "2.1.1",
          progress: 42,
          message: "Downloading the update",
          checkedAt: "2026-11-26T15:30:00Z",
        })
      )
    ).toEqual({
      id: "request-1",
      state: "downloading",
      currentVersion: "2.1.0",
      version: "2.1.1",
      progress: 42,
      message: "Downloading the update",
      checkedAt: "2026-11-26T15:30:00Z",
    })
  })

  it("rejects malformed, incomplete, and unknown states", () => {
    expect(parseDesktopUpdateStatus("not json")).toBeNull()
    expect(parseDesktopUpdateStatus('{"state":"upToDate"}')).toBeNull()
    expect(parseDesktopUpdateStatus('{"id":"request-1"}')).toBeNull()
    expect(parseDesktopUpdateStatus('{"id":"request-1","state":"dancing"}')).toBeNull()
    expect(parseDesktopUpdateStatus("[]")).toBeNull()
  })

  it("drops invalid optional fields but keeps the state", () => {
    expect(
      parseDesktopUpdateStatus(
        JSON.stringify({
          id: "request-1",
          state: "downloading",
          currentVersion: null,
          version: "",
          progress: 140,
          message: 42,
          checkedAt: "",
        })
      )
    ).toEqual({ id: "request-1", state: "downloading" })
  })

  it("reads a status file and treats a missing or corrupt one as no answer", async () => {
    await expect(readDesktopUpdateStatus()).resolves.toBeNull()

    const file = path.join(root, "config", DESKTOP_UPDATE_STATUS_FILE)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      JSON.stringify({ id: "request-1", state: "upToDate", currentVersion: "2.1.0" }),
      "utf8"
    )

    await expect(readDesktopUpdateStatus()).resolves.toEqual({
      id: "request-1",
      state: "upToDate",
      currentVersion: "2.1.0",
    })

    await writeFile(file, "{broken", "utf8")
    await expect(readDesktopUpdateStatus()).resolves.toBeNull()
  })
})
