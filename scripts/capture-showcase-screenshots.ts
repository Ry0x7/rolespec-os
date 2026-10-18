import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright"

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3100"
const EMAIL = process.env.DEV_ADMIN_EMAIL ?? "dev-admin@rolespec.local"
const PASSWORD = process.env.DEV_ADMIN_PASSWORD ?? "dev-admin-local-1234"

const OUT_DIR = path.join(process.cwd(), "screenshots")
const STORAGE_STATE = path.join(process.cwd(), "scripts", "screenshots", ".auth.json")

async function signIn(context: BrowserContext) {
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" })

  if (!page.url().includes("/sign-in")) {
    await page.close()
    return
  }

  await page.fill("#email", EMAIL)
  await page.fill("#password", PASSWORD)
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
    page.click('button[type="submit"]:has-text("Sign In")'),
  ])
  await context.storageState({ path: STORAGE_STATE })
  await page.close()
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser: Browser = await chromium.launch()

  // 1. Setup authenticated context
  let context = await browser.newContext({
    viewport: { width: 1560, height: 960 },
    storageState: fs.existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined,
  })

  const checkPage = await context.newPage()
  await checkPage.goto(`${BASE_URL}/workspace`, { waitUntil: "domcontentloaded" })
  if (checkPage.url().includes("/sign-in")) {
    await checkPage.close()
    await context.close()
    context = await browser.newContext({ viewport: { width: 1560, height: 960 } })
    await signIn(context)
  } else {
    await checkPage.close()
  }

  // SCREENSHOT 1: /workspace (Kanban board)
  console.log("Capturing /workspace...")
  {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1600, height: 1120 })
    await page.goto(`${BASE_URL}/workspace`, { waitUntil: "networkidle" })
    await hideDevOverlays(page)
    // Collapse the Quick Add panel so the Pipeline gets center stage
    const collapseButtons = page.locator('button[aria-label="Collapse panel"], button:has-text("Quick add") + div button, div:has-text("Quick add") button')
    const count = await collapseButtons.count()
    if (count > 0) {
      await collapseButtons.first().click().catch(() => {})
    }
    await page.waitForTimeout(600)

    const outPath = path.join(OUT_DIR, "workspace.png")
    await page.screenshot({ path: outPath, fullPage: false })
    console.log(`Saved ${outPath}`)
    await page.close()
  }

  // SCREENSHOT 2: /resumes/showcase_alex_morgan_resume (Resume Editor)
  console.log("Capturing /resumes/showcase_alex_morgan_resume...")
  {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1520, height: 980 })
    await page.goto(`${BASE_URL}/resumes/showcase_alex_morgan_resume`, { waitUntil: "networkidle" })
    await hideDevOverlays(page)
    await page.waitForTimeout(1000)

    const outPath = path.join(OUT_DIR, "resume-editor.png")
    await page.screenshot({ path: outPath, fullPage: false })
    console.log(`Saved ${outPath}`)
    await page.close()
  }

  // SCREENSHOT 3: /jobs (Job Applications & Opportunity Radar)
  console.log("Capturing /jobs...")
  {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1520, height: 980 })
    await page.goto(`${BASE_URL}/jobs`, { waitUntil: "networkidle" })
    await hideDevOverlays(page)
    await page.waitForTimeout(1000)

    const outPath = path.join(OUT_DIR, "jobs-discover.png")
    await page.screenshot({ path: outPath, fullPage: false })
    console.log(`Saved ${outPath}`)
    await page.close()
  }

  await context.close()
  await browser.close()
  console.log("All Playwright screenshots captured successfully!")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
