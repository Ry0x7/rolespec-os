// Verifies the Apple-style app overhaul (gate A2). Usage:
//   node scripts/verify-app-apple.mjs  -> prints APP-APPLE-OK
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8")
}

// 1. Logo is a real glyph, not an empty gradient tile.
const logo = read("src/features/marketing/components/logo-mark.tsx")
if (!logo.includes("<svg")) fail("LogoMark has no SVG glyph")
if (logo.includes("bg-gradient")) fail("LogoMark still a gradient tile")

// 2. Default accent is Apple blue.
const css = read("src/app/globals.css")
if (!css.includes("--color-brand-700: #1447E6")) fail("default brand ramp is not Apple blue")
if (!css.includes("--color-accent: #1447E6")) fail("default accent token is not Apple blue")

// 3. Display face is Inter/system (no Space Grotesk).
if (css.includes("Space Grotesk")) fail("globals.css still references Space Grotesk")
const layout = read("src/app/layout.tsx")
if (layout.includes("Space_Grotesk")) fail("layout.tsx still loads Space Grotesk")

// 4. Landing + marketing carry no glow shadows or gradient text.
const banned = ["shadow-glow", "text-gradient", "bg-gradient-to-", "from-brand-", "via-brand-", "to-brand-"]
for (const rel of [
  "src/app/page.tsx",
  "src/features/marketing/components/marketing-footer.tsx",
  "src/features/marketing/components/marketing-nav.tsx",
  "src/features/marketing/components/interactive-preview.tsx",
  "src/features/marketing/components/animated-badge.tsx",
  "src/features/marketing/components/model-showcase.tsx",
  "src/features/marketing/components/spotlight-card.tsx",
]) {
  const content = read(rel)
  for (const token of banned) {
    if (content.includes(token)) fail(`${rel} still contains ${token}`)
  }
}

// 5. Landing follows the user's theme (no forced dark).
const page = read("src/app/page.tsx")
if (page.includes("force-dark")) fail("landing still forces dark")

// 6. Press physics exist on the shared button.
const button = read("src/shared/ui/button.tsx")
if (!button.includes("active:scale-[0.97]")) fail("button has no press scale")

console.log("APP-APPLE-OK")
