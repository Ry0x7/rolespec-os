#!/usr/bin/env node
/**
 * Writes the Tauri update manifest (`latest.json`) that installed copies read
 * from `releases/latest/download/latest.json`.
 *
 * The Tauri CLI produces the `*.sig` next to the installer but not this
 * manifest, and the manifest is what maps a platform to that signature. The
 * version here must match the executable's version exactly: the app runs with
 * `requireSignedVersion`, which rejects an artifact whose signature names a
 * different version than the manifest announces.
 *
 * Usage (from the directory holding the installer):
 *   node scripts/write-update-manifest.mjs <installer> <signature> <version> <tag> <owner/repo>
 */

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const [installer, signatureFile, version, tag, repo] = process.argv.slice(2)

function fail(message) {
  console.error(`write-update-manifest: ${message}`)
  process.exit(1)
}

if (!installer || !signatureFile || !version || !tag || !repo) {
  fail(
    "usage: write-update-manifest.mjs <installer> <signature> <version> <tag> <owner/repo>"
  )
}
if (!/^v\d+\.\d+\.\d+/.test(tag)) fail(`tag ${tag} is not a version tag`)
if (tag !== `v${version}`) {
  fail(
    `tag ${tag} does not match tauri.conf.json version ${version}; the updater compares both`
  )
}

const installFile = path.resolve(installer)
const signature = readFileSync(path.resolve(signatureFile), "utf8").trim()
if (!signature) fail(`${signatureFile} is empty`)
// The `.sig` file is base64; the trusted comment inside it carries the
// version that `requireSignedVersion` compares against the manifest.
const decoded = Buffer.from(signature, "base64").toString("utf8")
if (!decoded.includes("version:")) {
  fail(
    `${signatureFile} has no trusted version comment, so clients with requireSignedVersion enabled would reject it`
  )
}

const manifest = {
  version,
  pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  notes: `RoleSpec ${tag}. See the release notes.`,
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${path.basename(installFile)}`,
    },
  },
}

const output = path.join(path.dirname(installFile), "latest.json")
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Wrote ${output}`)
console.log(
  `  installer sha256 ${createHash("sha256").update(readFileSync(installFile)).digest("hex")}`
)
console.log(`  ${manifest.platforms["windows-x86_64"].url}`)
