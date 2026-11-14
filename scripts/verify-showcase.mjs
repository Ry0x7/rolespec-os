// Verifies the showcase overhaul gates (G1-G3). Usage:
//   node scripts/verify-showcase.mjs           -> all checks, prints SHOWCASE-VERIFY-OK
//   node scripts/verify-showcase.mjs classes   -> prints SHOWCASE-CLASSES-OK
//   node scripts/verify-showcase.mjs commands  -> prints SHOWCASE-COMMANDS-OK
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT = path.join(ROOT, "dist-showcase")
const SRC = path.join(ROOT, "src", "showcase")

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

function readTree(dir, exts) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...readTree(full, exts))
    else if (exts.some((e) => entry.name.endsWith(e))) files.push(full)
  }
  return files
}

function checkDeployable() {
  const required = ["CNAME", "index.html", "bundle.js", "styles.css", ".nojekyll", "robots.txt", "sitemap.xml", "favicon.svg", path.join("RoleSpecOS", "workspace.png"), path.join("RoleSpecOS", "resume-editor.png"), path.join("RoleSpecOS", "jobs-discover.png")]
  for (const rel of required) {
    if (!fs.existsSync(path.join(OUT, rel))) fail(`missing deploy artifact: ${rel}`)
  }
  if (fs.readFileSync(path.join(OUT, "CNAME"), "utf8").trim() !== "rolespec.ry0x7.dev") fail("CNAME mismatch")
  if (!fs.existsSync(path.join(OUT, "_next"))) fail("missing _next dir")
  const html = fs.readFileSync(path.join(OUT, "index.html"), "utf8")
  if (!html.includes("bundle.js") || !html.includes("styles.css")) fail("index.html missing bundle/styles refs")
}

function checkClasses() {
  const banned = ["h-4.5", "w-4.5", "py-0.2", "text-gradient", "glow-box", "glass-card", "shadow-[0_0_"]
  const files = readTree(SRC, [".tsx", ".css"])
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8")
    for (const token of banned) {
      if (content.includes(token)) fail(`${path.relative(ROOT, file)} still contains banned token: ${token}`)
    }
  }
}

function checkCommands() {
  const quickstart = fs.readFileSync(path.join(SRC, "components", "quickstart-tabs.tsx"), "utf8")
  const required = [".env.docker.example", "docker compose up -d --build", "prisma migrate deploy", "localhost:3000", "localhost:3100"]
  for (const token of required) {
    if (!quickstart.includes(token)) fail(`quickstart missing correct command token: ${token}`)
  }
  const banned = ["prisma migrate dev", "curl -sSL https://raw.githubusercontent.com/Ry0x7/rolespec-os/main/docker-compose.yml -o docker-compose.yml"]
  for (const token of banned) {
    if (quickstart.includes(token)) fail(`quickstart still contains wrong command: ${token}`)
  }
  const index = fs.readFileSync(path.join(SRC, "index.tsx"), "utf8")
  if (index.includes("v1.0.5")) fail("showcase still pins stale v1.0.5")
  if (!index.includes("releases/latest")) fail("showcase download link does not point at releases/latest")
}

function checkApple() {
  const banned = ["lucide-react", "TiltCard", "hero-blob", "hero-ambient", "text-gradient", "grid", "glow", "backdrop-blur"]
  const files = readTree(SRC, [".tsx", ".css"])
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8")
    // "grid" as a word in copy is fine; only flag the background-grid pattern.
    const hits = banned.filter((t) => t === "grid" ? /backgroundImage.*linear-gradient|linear-gradient.*to right.*1px/.test(content) : content.includes(t))
    if (hits.length) fail(`${path.relative(ROOT, file)} contains Apple-round banned token(s): ${hits.join(", ")}`)
  }
  const css = fs.readFileSync(path.join(SRC, "styles.css"), "utf8").toLowerCase()
  for (const token of ["#f5f5f7", "#0066cc", "#1d1d1f"]) {
    if (!css.includes(token)) fail(`styles.css missing Apple token: ${token}`)
  }
  if (fs.existsSync(path.join(SRC, "components", "tilt-card.tsx"))) fail("tilt-card.tsx still present")
  const home = fs.readFileSync(path.join(SRC, "index.tsx"), "utf8")
  if (!home.includes("RoleSpecOS/workspace.png")) fail("hero does not lead with the real workspace screenshot")
}

function checkDark() {
  const css = fs.readFileSync(path.join(SRC, "styles.css"), "utf8")
  if (!css.includes('[data-theme="dark"]')) fail("styles.css has no dark theme block")
  for (const token of ["--nav-bg", "#2997ff"]) {
    if (!css.toLowerCase().includes(token)) fail(`styles.css missing dark token: ${token}`)
  }
  const icons = fs.readFileSync(path.join(SRC, "components", "icons.tsx"), "utf8")
  for (const name of ["SunIcon", "MoonIcon"]) {
    if (!icons.includes(name)) fail(`icons.tsx missing ${name}`)
  }
  const index = fs.readFileSync(path.join(SRC, "index.tsx"), "utf8")
  if (!index.includes("rolespec-theme") || !index.includes('data-theme')) fail("index.tsx does not wire theme state")
  const build = fs.readFileSync(path.join(ROOT, "scripts", "build-showcase.ts"), "utf8")
  if (!build.includes("rolespec-theme") || !build.includes("data-theme")) fail("build template has no pre-paint theme script")
  const files = readTree(SRC, [".tsx", ".css"])
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8")
    if (content.includes('background: "#fff"') || content.includes("bg-white")) fail(`${path.relative(ROOT, file)} still hardcodes a light surface`)
  }
}

const mode = process.argv[2]
if (mode === "dark") { checkDark(); console.log("SHOWCASE-DARK-OK") }
else if (mode === "apple") { checkApple(); console.log("SHOWCASE-APPLE-OK") }
else if (mode === "classes") { checkClasses(); console.log("SHOWCASE-CLASSES-OK") }
else if (mode === "commands") { checkCommands(); console.log("SHOWCASE-COMMANDS-OK") }
else { checkDeployable(); checkClasses(); checkCommands(); console.log("SHOWCASE-VERIFY-OK") }
