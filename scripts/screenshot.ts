/**
 * Dev-only screenshot helper.
 *
 * Usage:
 *   npx tsx scripts/screenshot.ts <path> [outfile] [--viewport 1440x900] [--scroll-x 600] [--scroll-selector "..."]
 *
 * Signs in through the real sign-in form as the seeded dev admin
 * (see scripts/seed-dev-admin.ts), caches the session in
 * scripts/screenshots/.auth.json, and writes a full-page PNG to
 * scripts/screenshots/.
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { chromium, type Browser, type BrowserContext } from "playwright"

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3100"
const EMAIL = process.env.DEV_ADMIN_EMAIL ?? "dev-admin@rolespec.local"
const PASSWORD = process.env.DEV_ADMIN_PASSWORD ?? "dev-admin-local-1234"

const OUT_DIR = path.join(process.cwd(), "scripts", "screenshots")
const STORAGE_STATE = path.join(OUT_DIR, ".auth.json")

type Args = {
  targetPath: string
  outFile: string
  width: number
  height: number
  scrollX: number
  scrollSelector: string | null
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  let width = 1440
  let height = 900
  let scrollX = 0
  let scrollSelector: string | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--viewport") {
      const [w, h] = (argv[++i] ?? "").split("x")
      width = Number(w) || width
      height = Number(h) || height
    } else if (arg === "--scroll-x") {
      scrollX = Number(argv[++i]) || 0
    } else if (arg === "--scroll-selector") {
      scrollSelector = argv[++i] ?? null
    } else {
      positional.push(arg)
    }
  }

  const targetPath = positional[0] ?? "/"
  const slug = targetPath.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-") || "home"
  const outFile = positional[1] ?? `${slug}-${width}x${height}.png`

  return { targetPath, outFile, width, height, scrollX, scrollSelector }
}

async function signIn(context: BrowserContext) {
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" })

  // Already authenticated: proxy bounces /sign-in to /dashboard.
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser: Browser = await chromium.launch()
  const viewport = { width: args.width, height: args.height }

  let context = await browser.newContext({
    viewport,
    storageState: fs.existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined,
  })

  let page = await context.newPage()
  await page.goto(`${BASE_URL}${args.targetPath}`, { waitUntil: "domcontentloaded" })

  // Stale/absent session: proxy redirects to /sign-in. Log in and retry.
  if (page.url().includes("/sign-in")) {
    await page.close()
    await context.close()
    context = await browser.newContext({ viewport })
    await signIn(context)
    page = await context.newPage()
    await page.goto(`${BASE_URL}${args.targetPath}`, { waitUntil: "domcontentloaded" })
  }

  await page.waitForLoadState("networkidle").catch(() => {})

  if (args.scrollX > 0 && args.scrollSelector) {
    await page.evaluate(
      ({ selector, scrollX }) => {
        const el = document.querySelector(selector)
        if (el) el.scrollLeft = scrollX
      },
      { selector: args.scrollSelector, scrollX: args.scrollX }
    )
    await page.waitForTimeout(300)
  }

  const outPath = path.join(OUT_DIR, args.outFile)
  await page.screenshot({ path: outPath, fullPage: args.scrollX === 0 })

  console.log(`${page.url()} -> ${outPath}`)
  await context.close()
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
