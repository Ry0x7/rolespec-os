#!/usr/bin/env node
/**
 * Fetches the PostgreSQL 17 binaries used by the desktop runtime.
 *
 *   Windows: desktop/vendor/postgresql-<version>-windows-x64-binaries.zip
 *   macOS:   desktop/vendor/postgresql-<version>-osx-binaries.zip
 *   desktop/src-tauri/resources/postgres/{bin,lib,share}
 *
 * Both archives are pinned by version and SHA-256. `get.enterprisedb.com`
 * serves the same bytes as the official installers; a different hash is treated
 * as a failed download, not as a newer build. The macOS archive is universal
 * (x86_64 + arm64), so one artifact covers Intel and Apple Silicon runners.
 *
 * The staged output is gitignored: it is 250 MB (Windows) to 1 GB (macOS) and
 * belongs in the installer build, not in the repository. Developers who already
 * have PostgreSQL can set ROLESPEC_PG_DIR instead of running this.
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

const PLATFORMS = {
  win32: {
    label: "Windows x64",
    version: "17.11-1",
    url: "https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip",
    sha256: "6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3",
    archive: "postgresql-17.11-1-windows-x64-binaries.zip",
    pgCtl: "pg_ctl.exe",
  },
  darwin: {
    label: "macOS universal",
    version: "17.11-1",
    url: "https://get.enterprisedb.com/postgresql/postgresql-17.11-1-osx-binaries.zip",
    sha256: "a540ac46eea5a2c612a8e097fd9aa75e41ac3f3b49bf10ffd75ecf5b1efc2997",
    archive: "postgresql-17.11-1-osx-binaries.zip",
    pgCtl: "pg_ctl",
  },
}

const POSTGRES = PLATFORMS[process.platform]
if (!POSTGRES) {
  throw new Error(
    `No pinned PostgreSQL runtime for ${process.platform}. ` +
      "The desktop build supports Windows x64 and macOS (universal)."
  )
}

const archive = path.join(vendor, POSTGRES.archive)

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
  console.log(
    `Downloading PostgreSQL ${POSTGRES.version} for ${POSTGRES.label} (${POSTGRES.url})...`
  )

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
  const temporary = path.join(
    vendor,
    `postgresql-${POSTGRES.version}-${process.platform}-extracted`
  )
  rmSync(temporary, { recursive: true, force: true })
  mkdirSync(temporary, { recursive: true })

  console.log("Extracting the PostgreSQL archive...")
  if (process.platform === "darwin") {
    // ditto is the macOS archiver that preserves resource forks and symlinks.
    execFileSync("ditto", ["-x", "-k", archive, temporary], { stdio: "inherit" })
  } else {
    // Windows 10+ ships bsdtar in System32, which reads zip. A Git Bash PATH
    // usually puts GNU tar first, and GNU tar cannot open a zip archive.
    const tar = path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "tar.exe"
    )
    execFileSync(tar, ["-xf", archive, "-C", temporary], { stdio: "inherit" })
  }

  const source = path.join(temporary, "pgsql")
  if (!existsSync(path.join(source, "bin", POSTGRES.pgCtl))) {
    throw new Error(`The archive did not contain pgsql/bin/${POSTGRES.pgCtl}.`)
  }

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  // initdb and postgres need bin, the runtime libraries in lib, and the data
  // templates/locale/timezone files in share. Docs, headers, pgAdmin and
  // Stack Builder are installer conveniences, not runtime dependencies.
  // Dereferencing keeps a symlinked dylib from pointing outside the bundle.
  for (const entry of ["bin", "lib", "share"]) {
    cpSync(path.join(source, entry), path.join(out, entry), {
      recursive: true,
      dereference: true,
    })
  }
  for (const entry of ["share/doc", "share/man"]) {
    rmSync(path.join(out, entry), { recursive: true, force: true })
  }

  rmSync(temporary, { recursive: true, force: true })
}if (!existsSync(archive)) {
  await download()
} else {
  const actual = await sha256(archive)
  if (!POSTGRES.sha256.startsWith("SHA256_") && actual !== POSTGRES.sha256) {
    throw new Error(
      `Cached PostgreSQL archive has the wrong checksum.\nExpected: ${POSTGRES.sha256}\nActual: ${actual}\nDelete ${archive} and retry.`
    )
  }
}

if (force || !existsSync(path.join(out, "bin", POSTGRES.pgCtl))) {
  extract()
}

console.log("")
console.log(`PostgreSQL:  ${formatMegabytes(directorySize(out))}  (${out})`)
console.log(`Platform:    ${POSTGRES.label}`)
console.log(`Version:     ${POSTGRES.version}`)
console.log("")
console.log("Run `npm run desktop:stage` to include it in the desktop resources.")
