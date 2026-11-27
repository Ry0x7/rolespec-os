// Drives the built showcase in a real browser. Run after `npm run showcase:build`:
//   node scripts/test-showcase.mjs   -> prints SHOWCASE-DEMO-OK
// Checks every viewport and theme for console errors and sideways scroll, then
// exercises the interactive parts: the scroll-linked hero tilt, its flat
// reduced-motion fallback, the mode switch mock, the mock dialog, the theme
// toggle and the pointer light.
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT = path.join(ROOT, "dist-showcase")
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".xml": "application/xml", ".txt": "text/plain" }
const SECTIONS = ["#workflows", "#features", "#beyond", "#models", "#quickstart"]
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]
// Web fonts load from Google; a sandbox without network still renders the
// fallback stack, so a refused font request is not a page error.
const IGNORED = /fonts\.(googleapis|gstatic)\.com|ERR_TUNNEL|ERR_PROXY|ERR_NAME_NOT_RESOLVED|Failed to load resource/

const failures = []
function check(condition, message) {
  if (!condition) failures.push(message)
}

function serve() {
  if (!fs.existsSync(path.join(OUT, "index.html"))) {
    console.error("FAIL: dist-showcase/index.html is missing; run npm run showcase:build first")
    process.exit(1)
  }
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname)
    const file = path.join(OUT, pathname.endsWith("/") ? `${pathname}index.html` : pathname)
    if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)))
}

async function open(browser, url, options) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (err) => errors.push(err.message))
  page.on("console", (msg) => {
    if (msg.type() === "error" && !IGNORED.test(msg.text())) errors.push(msg.text())
  })
  await page.goto(url, { waitUntil: "load" })
  await page.waitForSelector("#hero-heading")
  return { context, page, errors }
}

function tiltOf(page) {
  return page.evaluate(() => {
    const plane = document.querySelector(".scroll-showcase-plane")
    const match = /rotateX\((-?[\d.]+)deg\)/.exec(plane?.style.transform ?? "")
    return match ? Number(match[1]) : 0
  })
}

async function main() {
  const server = await serve()
  const url = `http://127.0.0.1:${server.address().port}/`
  // CI installs Playwright's own Chromium; elsewhere point at any Chrome build.
  const executablePath = process.env.SHOWCASE_CHROMIUM_PATH || undefined
  const browser = await chromium.launch({ executablePath, args: executablePath ? ["--headless=new", "--no-sandbox"] : [] })

  try {
    for (const viewport of VIEWPORTS) {
      for (const colorScheme of ["light", "dark"]) {
        const label = `${viewport.width}px ${colorScheme}`
        const { context, page, errors } = await open(browser, url, { viewport, colorScheme })
        check((await page.getAttribute("html", "data-theme")) === colorScheme, `${label}: theme does not follow the system`)
        for (const id of SECTIONS) check((await page.locator(id).count()) === 1, `${label}: section ${id} is missing`)
        await page.waitForTimeout(300)
        const topOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        check(topOverflow <= 0, `${label}: page scrolls sideways by ${topOverflow}px before scrolling`)
        // Walk the page so every in-view animation and scroll effect runs.
        const height = await page.evaluate(() => document.documentElement.scrollHeight)
        for (let y = 0; y < height; y += viewport.height / 2) {
          await page.evaluate((top) => window.scrollTo(0, top), y)
          await page.waitForTimeout(40)
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        check(overflow <= 0, `${label}: page scrolls sideways by ${overflow}px`)
        check(errors.length === 0, `${label}: console errors: ${errors.join(" | ")}`)
        await context.close()
      }
    }

    // Scroll-linked hero: tipped back at the top, flat once scrolled to.
    {
      const { context, page } = await open(browser, url, { viewport: { width: 1440, height: 900 } })
      check((await page.getAttribute(".scroll-showcase", "data-depth")) === "scroll", "hero does not use the scroll effect with full motion")
      await page.waitForTimeout(300)
      const start = await tiltOf(page)
      check(start > 5, `hero should start tilted, got ${start}deg`)
      await page.locator(".scroll-showcase").scrollIntoViewIfNeeded()
      await page.evaluate(() => {
        const el = document.querySelector(".scroll-showcase")
        const rect = el.getBoundingClientRect()
        window.scrollBy(0, rect.top + rect.height / 2 - window.innerHeight / 2)
      })
      await page.waitForTimeout(400)
      const settled = await tiltOf(page)
      check(Math.abs(settled) < 1, `hero should settle flat when centred, got ${settled}deg`)

      // Pointer light: moving a mouse over a mock frame writes its position.
      const bezel = page.locator("#features .mock-stage-bezel").first()
      await bezel.scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      const box = await bezel.boundingBox()
      await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25)
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3)
      const mx = await bezel.evaluate((el) => el.style.getPropertyValue("--mx"))
      check(mx.endsWith("%"), "mock frame does not track the pointer")

      // Mode switch mock: each mode says what happens at the review step.
      const modes = page.locator("#beyond [aria-label='Preparation mode']")
      await modes.scrollIntoViewIfNeeded()
      await modes.getByRole("button", { name: "Agent-assisted" }).click()
      check(await page.locator("#beyond").getByText("Waiting for you").isVisible(), "Agent-assisted mock does not wait for review")
      await modes.getByRole("button", { name: "Full AI" }).click()
      check(await page.locator("#beyond").getByText("Approved by policy").isVisible(), "Full AI mock does not show the policy approval")
      check((await modes.getByRole("button", { name: "Full AI" }).getAttribute("aria-pressed")) === "true", "Full AI button is not pressed")

      // Mock dialog opens large and closes on Escape.
      await page.locator(".mock-stage-expand").first().click()
      check(await page.locator("dialog[open]").count() === 1, "Expand does not open the mock dialog")
      await page.keyboard.press("Escape")
      await page.waitForTimeout(200)
      check(await page.locator("dialog[open]").count() === 0, "Escape does not close the mock dialog")

      // Theme toggle flips the page and remembers it.
      const before = await page.getAttribute("html", "data-theme")
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.getByRole("button", { name: /Switch to (dark|light) appearance/ }).click()
      const after = await page.getAttribute("html", "data-theme")
      check(before !== after, "theme toggle does not change the theme")
      await context.close()
    }

    // Reduced motion: the same content, flat and still.
    {
      const { context, page, errors } = await open(browser, url, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
      check((await page.getAttribute(".scroll-showcase", "data-depth")) === "flat", "hero still animates with reduced motion")
      const transform = await page.evaluate(() => getComputedStyle(document.querySelector(".scroll-showcase-plane")).transform)
      check(transform === "none", `hero plane is transformed with reduced motion: ${transform}`)
      check((await page.locator(".scroll-turn").count()) === 0, "feature mocks still turn with reduced motion")
      check(errors.length === 0, `reduced motion: console errors: ${errors.join(" | ")}`)
      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL: ${failure}`)
    process.exit(1)
  }
  console.log("SHOWCASE-DEMO-OK")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
