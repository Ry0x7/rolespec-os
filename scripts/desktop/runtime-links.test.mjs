import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, lstatSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { materializeRuntimeLinks } from "./runtime-links.mjs"

test("staged junctions become independent directories without modifying source packages", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "rolespec-runtime-links-"))
  try {
    const source = path.join(temporary, "pg")
    const runtime = path.join(temporary, "runtime")
    mkdirSync(source)
    mkdirSync(runtime)
    writeFileSync(path.join(source, "package.json"), '{"name":"pg"}')
    const alias = path.join(runtime, "pg-hash")
    symlinkSync(source, alias, process.platform === "win32" ? "junction" : "dir")
    materializeRuntimeLinks(runtime)
    assert.equal(lstatSync(alias).isSymbolicLink(), false)
    assert.equal(readFileSync(path.join(alias, "package.json"), "utf8"), '{"name":"pg"}')
    writeFileSync(path.join(alias, "package.json"), '{"name":"independent"}')
    assert.equal(readFileSync(path.join(source, "package.json"), "utf8"), '{"name":"pg"}')
    materializeRuntimeLinks(runtime)
    assert.equal(lstatSync(alias).isSymbolicLink(), false)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
