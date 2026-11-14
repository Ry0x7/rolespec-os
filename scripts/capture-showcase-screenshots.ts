import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright"

/**
 * Captures the product screenshots used by the GitHub Pages showcase.
 *
 * These are the real authenticated screens, not crops of a marketing page.
 * Each shot is captured twice — light and dark — because the showcase swaps
 * images with its own theme toggle.
 *
 * Usage:
 *   SCREENSHOT_BASE_URL=http://localhost:3100 npx tsx scripts/capture-showcase-screenshots.ts
 *
 * The local workspace is seeded with scripts/seed-showcase-alex.ts so the
 * dashboard, jobs board and resume editor contain realistic data.
 */

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3100"
const ACCESS_KEY = process.env.ROLSPEC_ACCESS_KEY ?? ""
const OUT_DIR = path.join(process.cwd(), "screenshots")
const STORAGE_STATE = path.join(process.cwd(), "scripts", "screenshots", ".auth.json")

type Shot = {
  name: string
  route: string
  /** Taller than the default when the first viewport needs to tell the full story. */
  height?: number
  prepare?: (page: Page) => Promise<void>
}

const SHOTS: Shot[] = [
  {
    name: "dashboard",
    route: "/dashboard",
    // The daily status strip belongs at the top, which pushes the first ranked
    // row just below a 960px viewport. A slightly taller capture keeps both the
    // status and a real ranked result in the screenshot without moving content.
    height: 1080,
    async prepare(page) {
      // Make the hero show the ranked shortlist rather than an empty panel.
      // Re-running the capture still works: the button reads "Refresh ranking".
      const rank = page.getByRole("button", { name: /Rank saved jobs/i })
      if (await rank.count()) {
        await rank.first().click()
        await page.waitForTimeout(2500)
      }
    },
  },
  { name: "jobs", route: "/jobs" },
  {
    name: "resume-editor",
    route: "/resumes/showcase_alex_morgan_resume",
  },
  {
    name: "job-prepare",
    route: "/jobs/app_job_stripe_infra#prepare",
    async prepare(page) {
      await page.getByRole("heading", { name: "Apply with the agent" }).waitFor({ timeout: 15_000 })
    },
  },
  {
    name: "job-ats",
    route: "/resumes/showcase_alex_morgan_resume",
    async prepare(page) {
      // The header labels the chip by the analysis it ran: "Quality score 94"
      // for an overall check or "Match score 88" for a job description.
      const atsButton = page.getByRole("button", { name: /(Quality|Match|ATS) score \d+/ })
      await atsButton.first().click()
      await page.locator('[aria-label="ATS analysis"]').waitFor({ timeout: 15_000 })
      await page.waitForTimeout(400)
    },
  },
  {
    name: "workspace",
    route: "/workspace",
    async prepare(page) {
      // Collapse the goal and quick-add panels so the pipeline, not the forms,
      // is the visible part of the workspace.
      for (const label of ["Collapse Goal panel", "Collapse Quick add panel"]) {
        const button = page.getByRole("button", { name: label })
        if (await button.count()) await button.first().click()
      }
      await page.waitForTimeout(500)
    },
  },
]

async function unlockIfNeeded(page: Page) {
  if (!page.url().includes("/unlock")) return
  if (!ACCESS_KEY) {
    throw new Error("This deployment uses the owner key gate. Set ROLSPEC_ACCESS_KEY to capture the workspace.")
  }
  await page.fill("#owner-access-key", ACCESS_KEY)
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/unlock"), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ])
}

async function hideDevOverlays(page: Page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [data-nextjs-toast],
      [data-nextjs-dev-indicator],
      [data-nextjs-route-announcer],
      #__next-build-watcher,
      div[data-nextjs-dialog-overlay] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `,
  })
}

async function captureMode(browser: Browser, mode: "light" | "dark", suffix: string) {
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    storageState: fs.existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined,
  })

  // The app reads its stored mode before first paint, so set it on the origin
  // once and reload; addInitScript alone would not have an origin yet.
  const page = await context.newPage()
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" })
  await unlockIfNeeded(page)
  await page.evaluate((nextMode) => {
    localStorage.setItem("rolespec-mode", nextMode)
    // The first-run tour card is useful in the app, but it covers the lower
    // third of every marketing capture.
    localStorage.setItem("rolespec-tour", "skipped")
  }, mode)
  await page.close()

  for (const shot of SHOTS) {
    const page = await context.newPage()
    if (shot.height) {
      await page.setViewportSize({ width: 1440, height: shot.height })
    }
    await page.goto(`${BASE_URL}${shot.route}`, { waitUntil: "networkidle" })
    await hideDevOverlays(page)
    if (shot.prepare) await shot.prepare(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)

    const outPath = path.join(OUT_DIR, `${shot.name}${suffix}.png`)
    await page.screenshot({ path: outPath, fullPage: false })
    console.log(`${mode}: ${shot.route} -> ${path.relative(process.cwd(), outPath)}`)
    await page.close()
  }

  await context.close()
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()

  await captureMode(browser, "light", "")
  await captureMode(browser, "dark", "-dark")

  await browser.close()
  console.log("Showcase screenshots captured.")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
