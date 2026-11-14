// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  parseCodexConfigModel,
  resolveCodexModelId,
} from "../codex-paths"

describe("parseCodexConfigModel", () => {
  it("reads the top-level model", () => {
    expect(parseCodexConfigModel('model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"')).toBe(
      "gpt-6.1-sol"
    )
  })

  it("accepts single quotes and ignores comments", () => {
    expect(parseCodexConfigModel("# model = \"ignored\"\nmodel = 'gpt-5.1'")).toBe(
      "gpt-5.1"
    )
  })

  it("ignores a profile model once a table has started", () => {
    const config = '[profiles.work]\nmodel = "gpt-5.2-codex"\n'
    expect(parseCodexConfigModel(config)).toBeNull()
  })

  it("returns null when no model is set", () => {
    expect(parseCodexConfigModel("approval_policy = \"never\"\n")).toBeNull()
  })
})

describe("resolveCodexModelId", () => {
  const originalEnv = { ...process.env }
  let home: string

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "rolespec-codex-home-"))
    process.env = { ...originalEnv, CODEX_HOME: home }
    delete process.env.CODEX_CLI_MODEL
  })

  afterEach(() => {
    process.env = originalEnv
    rmSync(home, { recursive: true, force: true })
  })

  it("prefers the explicit environment override", () => {
    writeFileSync(path.join(home, "config.toml"), 'model = "from-config"\n')
    process.env.CODEX_CLI_MODEL = "from-env"

    expect(resolveCodexModelId()).toBe("from-env")
  })

  it("follows the CLI config when the environment is unset", () => {
    writeFileSync(path.join(home, "config.toml"), 'model = "gpt-6.1-sol"\n')

    expect(resolveCodexModelId()).toBe("gpt-6.1-sol")
  })

  it("falls back when the config is missing", () => {
    expect(resolveCodexModelId()).toBe("gpt-6.1-sol")
  })
})
