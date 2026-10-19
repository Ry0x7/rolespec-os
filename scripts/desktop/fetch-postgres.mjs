#!/usr/bin/env node
/**
 * Fetches the PostgreSQL 17 Windows x64 binaries used by the desktop runtime.
 *
 *   desktop/vendor/postgresql-<version>-windows-x64-binaries.zip
 *   desktop/src-tauri/resources/postgres/{bin,lib,share}
 *
 * The archive is pinned by version and SHA-256. `get.enterprisedb.com` serves
 * the same bytes as the official installer; a different hash is treated as a
 * failed download, not as a newer build.
 *
 * The staged output is gitignored: it is ~250 MB and belongs in the installer
 * build, not in the repository. Developers who already have PostgreSQL can set
 * ROLESPEC_PG_DIR instead of running this.
 *
 * Usage:
 *   node scripts/desktop/fetch-postgres.mjs
 *   node scripts/desktop/fetch-postgres.mjs --force   # re-extract
 */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const vendor = path.join(root, "desktop", "vendor")
const resources = path.join(root, "desktop", "src-tauri", "resources")
const out = path.join(resources, "postgres")
const force = process.argv.includes("--force")

const POSTGRES = {
  version: "17.11-1",
  url: "https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip",
  sha256: "6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3",
}

const archive = path.join(
  vendor,
  `postgresql-${POSTGRES.version}-windows-x64-binaries.zip`
)

function formatMegabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function directorySize(target) {
  let total = 0
  const stack = [target]
  while (stack.length > 0) {
    const current = stack.pop()
    const stats = statSync(current)
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(path.join(current, entry))
    } else {
      total += stats.size
    }
  }
  return total
}

async function sha256(file) {
  const hash = createHash("sha256")
  await pipeline(createReadStream(file), hash)
  return hash.digest("hex")
}

async function download() {
  mkdirSync(vendor, { recursive: true })
  const temporary = `${archive}.partial`
  console.log(`Downloading PostgreSQL ${POSTGRES.version} (${POSTGRES.url})...`)

  const response = await fetch(POSTGRES.url, { redirect: "follow" })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}.`)
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))

  const actual = await sha256(temporary)
  if (POSTGRES.sha256.startsWith("SHA256_")) {
    rmSync(temporary, { force: true })
    throw new Error(
      `No SHA-256 is pinned for PostgreSQL ${POSTGRES.version}. ` +
        `Downloaded hash: ${actual}. Update POSTGRES.sha256 before shipping.`
    )
  }
  if (actual !== POSTGRES.sha256) {
    rmSync(temporary, { force: true })
    throw new Error(
      `PostgreSQL ${POSTGRES.version} checksum mismatch.\n` +
        `Expected: ${POSTGRES.sha256}\nActual:   ${actual}\n` +
        "The download or the pinned artifact changed; do not ship it."
    )
  }

  renameSync(temporary, archive)
  console.log(`Verified SHA-256 ${actual}`)
}

function extract() {
  const temporary = path.join(vendor, `postgresql-${POSTGRES.version}-extracted`)
  rmSync(temporary, { recursive: true, force: true })
  mkdirSync(temporary, { recursive: true })

  console.log("Extracting the PostgreSQL archive...")
  // Windows 10+ ships bsdtar in System32, which reads zip. A Git Bash PATH
  // usually puts GNU tar first, and GNU tar cannot open a zip archive.
  const tar =
    process.platform === "win32"
      ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar"
  execFileSync(tar, ["-xf", archive, "-C", temporary], { stdio: "inherit" })

  const source = path.join(temporary, "pgsql")
  if (!existsSync(path.join(source, "bin", "pg_ctl.exe"))) {
    throw new Error("The archive did not contain pgsql\\bin\\pg_ctl.exe.")
  }

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  // initdb and postgres need bin, the runtime DLLs in lib, and the data
  // templates/locale/timezone files in share. Docs, headers, pgAdmin and
  // Stack Builder are installer conveniences, not runtime dependencies.
  for (const entry of ["bin", "lib", "share"]) {
    cpSync(path.join(source, entry), path.join(out, entry), { recursive: true })
  }
  for (const entry of ["share/doc", "share/man"]) {
    rmSync(path.join(out, entry), { recursive: true, force: true })
  }

  rmSync(temporary, { recursive: true, force: true })
}

if (!existsSync(archive)) {
  await download()
} else {
  const actual = await sha256(archive)
  if (!POSTGRES.sha256.startsWith("SHA256_") && actual !== POSTGRES.sha256) {
    throw new Error(
      `Cached PostgreSQL archive has the wrong checksum.\nExpected: ${POSTGRES.sha256}\nActual:   ${actual}\nDelete ${archive} and retry.`
    )
  }
}

if (force || !existsSync(path.join(out, "bin", "pg_ctl.exe"))) {
  extract()
}

console.log("")
console.log(`PostgreSQL:  ${formatMegabytes(directorySize(out))}  (${out})`)
console.log(`Version:     ${POSTGRES.version}`)
console.log("")
console.log("Run `npm run desktop:stage` to include it in the desktop resources.")
