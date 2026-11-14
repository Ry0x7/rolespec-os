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
  const required = [
    "CNAME",
    "index.html",
    "bundle.js",
    "styles.css",
    ".nojekyll",
    "robots.txt",
    "sitemap.xml",
    "favicon.svg",
    path.join("RoleSpecOS", "banner.png"),
  ]
  for (const rel of required) {
    if (!fs.existsSync(path.join(OUT, rel))) fail(`missing deploy artifact: ${rel}`)
  }
  if (fs.readFileSync(path.join(OUT, "CNAME"), "utf8").trim() !== "rolespec.ry0x7.dev") fail("CNAME mismatch")
  if (!fs.existsSync(path.join(OUT, "_next"))) fail("missing _next dir")
  const html = fs.readFileSync(path.join(OUT, "index.html"), "utf8")
  if (!html.includes("bundle.js") || !html.includes("styles.css")) fail("index.html missing bundle/styles refs")
  if (!html.includes('rel="icon"') || !html.includes("favicon.svg")) fail("index.html does not reference favicon.svg")

  // The favicon must be the square app mark, not the wide README banner.
  const favicon = fs.readFileSync(path.join(OUT, "favicon.svg"), "utf8")
  const bannerPath = path.join(ROOT, "public", "banner.svg")
  if (fs.existsSync(bannerPath) && favicon === fs.readFileSync(bannerPath, "utf8")) {
    fail("favicon.svg is the README banner; expected public/icon.svg")
  }
  if (!favicon.includes("<svg") || !favicon.includes("viewBox")) fail("favicon.svg is not an SVG with a viewBox")
  const iconSource = fs.readFileSync(path.join(ROOT, "public", "icon.svg"), "utf8")
  if (favicon !== iconSource) fail("favicon.svg was not copied from public/icon.svg")
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
  const banned = ["lucide-react", "TiltCard", "TiltShot", "hero-blob", "hero-ambient", "text-gradient", "grid", "glow", "backdrop-blur"]
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
  if (fs.existsSync(path.join(SRC, "components", "tilt-shot.tsx"))) fail("tilt-shot.tsx still present")
  const home = fs.readFileSync(path.join(SRC, "index.tsx"), "utf8")
  if (!home.includes("<DashboardMock")) fail("hero does not lead with the interactive dashboard mock")
  if (!home.includes("hero-demo-frame")) fail("hero mock is not inside the device frame")
  const featureSource = fs.readFileSync(path.join(SRC, "components", "feature-sections.tsx"), "utf8")
  if (!featureSource.includes("FeatureMock")) fail("feature sections do not use readable product mocks")
  if (featureSource.includes("PreviewFrame")) fail("feature sections still depend on a screenshot preview")
  const mockSource = fs.readFileSync(path.join(SRC, "components", "feature-mocks.tsx"), "utf8")
  for (const kind of ["resume", "board", "agent", "ats", "pipeline"]) {
    if (!mockSource.includes(`${kind}:`)) fail(`feature mocks are missing the ${kind} view`)
  }
  const workflowPreview = fs.readFileSync(path.join(SRC, "components", "workflow-preview.tsx"), "utf8")
  if (!workflowPreview.includes("MockStage")) fail("product tour does not use the live mock stage")
  if (!workflowPreview.includes("MockDialog")) fail("product tour does not provide a full-size mock dialog")
  if (workflowPreview.includes(".png")) fail("product tour still references a screenshot")
  const stageSource = fs.readFileSync(path.join(SRC, "components", "mock-stage.tsx"), "utf8")
  if (!stageSource.includes("mock-stage-expand")) fail("mock stages do not expose an expand button")
  if (!stageSource.includes("showModal")) fail("mock dialog does not open as a native pop-up")
  for (const removed of ["shot-image.tsx", "preview-frame.tsx", "preview-lightbox.tsx", "tilt-shot.tsx", "hyperframe.tsx"]) {
    if (fs.existsSync(path.join(SRC, "components", removed))) fail(`${removed} is a removed or renamed showcase component and must not return`)
  }
  if (!workflowPreview.includes('id="workflows"')) fail("workflow preview section lost its public #workflows anchor")
  const sourceFiles = readTree(SRC, [".tsx", ".css"])
  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, "utf8")
    if (content.includes("<img")) fail(`${path.relative(ROOT, file)} still ships a downscaled image; use a live mock`)
    if (content.includes("data-preview-trigger")) fail(`${path.relative(ROOT, file)} still uses the old screenshot preview trigger`)
  }
  const styleSheet = fs.readFileSync(path.join(SRC, "styles.css"), "utf8")
  if (!styleSheet.includes(".mock-stage-bezel")) fail("styles.css is missing the popping mock frame")
  if (!styleSheet.includes(".mock-dialog")) fail("styles.css is missing the mock dialog")
  if (styleSheet.includes(".preview-card")) fail("styles.css still carries the old screenshot card")
  for (const stale of ["jobs-discover.png", "ats-chips.png"]) {
    if (featureSource.includes(stale) || mockSource.includes(stale)) fail(`feature section still references stale screenshot: ${stale}`)
  }
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
