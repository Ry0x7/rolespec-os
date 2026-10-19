#!/usr/bin/env node
/**
 * Stages everything the desktop shell runs at release time:
 *
 *   desktop/src-tauri/resources/app   Next.js standalone output + static assets
 *   desktop/src-tauri/resources/node  the Node runtime the user will not install
 *   desktop/src-tauri/resources/manifest.json
 *
 * The output is generated and gitignored. Use `--build` to produce a fresh
 * standalone build first; otherwise an existing `.next/standalone` is reused.
 */

import { execFileSync } from "node:child_process"
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const tauriDir = path.join(root, "desktop", "src-tauri")
const resourcesDir = path.join(tauriDir, "resources")
const appOut = path.join(resourcesDir, "app")
const nodeOut = path.join(resourcesDir, "node")
const prismaOut = path.join(resourcesDir, "prisma")
// Kept separate from `.next` on purpose: a running `next dev` in the same
// checkout rewrites `.next`, and a desktop bundle built from that tree served
// 404s for every chunk. `DIST_DIR` mirrors next.config.ts.
const DIST_DIR = ".next-desktop"
const standalone = path.join(root, DIST_DIR, "standalone")
const shouldBuild = process.argv.includes("--build")

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options })
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

function formatMegabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Prisma's CLI is a dev dependency, so the standalone bundle does not contain
 * it. Managed-desktop migrations need the real CLI: reimplementing migration
 * ordering or writing a second `_migrations` table would fork the one migration
 * history this project has.
 *
 * Copy the CLI's full declared dependency tree. Prisma 7.9.1 eagerly requires
 * Studio and `@prisma/dev` modules even for `migrate deploy` (observed as
 * MODULE_NOT_FOUND during packaged verification), so pruning "unused"
 * commands is not safe. The adapter packages are small by comparison.
 */

function resolvePackageDir(name, fromDir) {
  const require = createRequire(path.join(fromDir, "package.json"))
  try {
    return path.dirname(require.resolve(`${name}/package.json`))
  } catch {
    // Some packages expose no root entry and hide package.json behind
    // "exports" (e.g. @prisma/studio-core), so `require.resolve` throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED. The hoisted directory is still valid.
    const direct = path.join(fromDir, "node_modules", ...name.split("/"))
    if (existsSync(path.join(direct, "package.json"))) return direct

    const entry = require.resolve(name)
    let dir = path.dirname(entry)
    while (dir !== path.dirname(dir)) {
      const manifest = path.join(dir, "package.json")
      if (existsSync(manifest)) {
        const parsed = JSON.parse(readFileSync(manifest, "utf8"))
        if (parsed.name === name) return dir
      }
      dir = path.dirname(dir)
    }
    throw new Error(`Could not locate the package directory for ${name}`)
  }
}

function stagePrisma() {
  console.log("Staging the Prisma CLI...")
  rmSync(prismaOut, { recursive: true, force: true })
  mkdirSync(path.join(prismaOut, "node_modules"), { recursive: true })

  const copied = new Map()
  const queue = ["prisma"]
  while (queue.length > 0) {
    const name = queue.shift()
    if (copied.has(name)) continue
    const source = resolvePackageDir(name, root)
    const destination = path.join(prismaOut, "node_modules", ...name.split("/"))
    mkdirSync(path.dirname(destination), { recursive: true })
    cpSync(source, destination, { recursive: true })
    copied.set(name, source)

    const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"))
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (!copied.has(dependency)) queue.push(dependency)
    }
  }

  cpSync(path.join(root, "prisma", "schema.prisma"), path.join(prismaOut, "schema.prisma"))
  cpSync(path.join(root, "prisma", "migrations"), path.join(prismaOut, "migrations"), {
    recursive: true,
  })

  // Absolute paths keep the CLI independent of its working directory. The
  // datasource URL is injected by the shell, never written to this file.
  writeFileSync(
    path.join(prismaOut, "prisma.config.mjs"),
    [
      'import { fileURLToPath } from "node:url"',
      'import { defineConfig } from "prisma/config"',
      "",
      "export default defineConfig({",
      '  schema: fileURLToPath(new URL("./schema.prisma", import.meta.url)),',
      '  migrations: { path: fileURLToPath(new URL("./migrations", import.meta.url)) },',
      "  datasource: { url: process.env.DATABASE_URL },",
      "})",
      "",
    ].join("\n")
  )

  console.log(`Prisma CLI: ${formatMegabytes(directorySize(prismaOut))} (${copied.size} packages)`)
}

if (shouldBuild || !existsSync(path.join(standalone, "server.js"))) {
  console.log("Building the Next.js standalone server...")
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
    // Node 24 refuses to spawn a `.cmd` shim without a shell on Windows.
    shell: process.platform === "win32",
    env: {
      ...process.env,
      DOCKER_BUILD: "1",
      DESKTOP_BUILD: "1",
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    },
  })
}

if (!existsSync(path.join(standalone, "server.js"))) {
  throw new Error(
    "No standalone desktop server found. Run `npm run desktop:build`."
  )
}

console.log("Staging the server bundle...")
rmSync(appOut, { recursive: true, force: true })
mkdirSync(appOut, { recursive: true })

// Next 16 copies the whole project root into `.next/standalone` unless the
// build context excludes it (Docker does that with .dockerignore). Copy only
// runtime entries: without this whitelist a local `desktop/src-tauri/target`
// would add gigabytes to the installer.
// With a custom distDir, Next puts the server internals at
// `.next-desktop/standalone/.next-desktop`, mirroring the directory name in the
// app bundle. Copying only `.next` left the server running with no build files.
const RUNTIME_ENTRIES = ["server.js", "package.json", DIST_DIR, "node_modules", "public"]
for (const entry of RUNTIME_ENTRIES) {
  const source = path.join(standalone, entry)
  if (existsSync(source)) {
    cpSync(source, path.join(appOut, entry), { recursive: true })
  }
}

// The generated Prisma client is imported from source paths, so keep it even
// though the rest of `src/` is compile-time only.
const generatedClient = path.join(standalone, "src", "generated")
if (existsSync(generatedClient)) {
  cpSync(generatedClient, path.join(appOut, "src", "generated"), {
    recursive: true,
  })
}

const staticSource = path.join(root, DIST_DIR, "static")
if (!existsSync(staticSource)) {
  throw new Error("Missing .next/static. The standalone build is incomplete.")
}
cpSync(staticSource, path.join(appOut, DIST_DIR, "static"), { recursive: true })

// Kept for Milestone 3 (managed local PostgreSQL), and useful when diagnosing a
// packaged build whose schema is older than its binary.
const migrations = path.join(root, "prisma", "migrations")
if (existsSync(migrations)) {
  cpSync(migrations, path.join(appOut, "prisma", "migrations"), {
    recursive: true,
  })
}

// The server reads its license from the package at build time; ship the notice
// with the app for AGPL compliance even though it is not executed.
const license = path.join(root, "LICENSE")
if (existsSync(license)) {
  cpSync(license, path.join(appOut, "LICENSE"))
}

console.log("Staging the Node runtime...")
rmSync(nodeOut, { recursive: true, force: true })
mkdirSync(nodeOut, { recursive: true })
const nodeBinary = path.join(nodeOut, process.platform === "win32" ? "node.exe" : "node")
cpSync(process.execPath, nodeBinary)
if (process.platform !== "win32") chmodSync(nodeBinary, 0o755)

stagePrisma()

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
const manifest = {
  appVersion: packageJson.version,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  builtAt: new Date().toISOString(),
}
writeFileSync(
  path.join(resourcesDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
)

console.log("")
console.log(`App bundle:  ${formatMegabytes(directorySize(appOut))}  (${appOut})`)
console.log(`Node:        ${formatMegabytes(directorySize(nodeOut))}  (${nodeBinary})`)
console.log(`Manifest:    ${path.join(resourcesDir, "manifest.json")}`)
console.log("")
console.log("Desktop resources are staged. Run `npm run desktop:check` or launch with cargo.")
