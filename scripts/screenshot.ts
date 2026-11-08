/**
 * Dev-only screenshot helper.
 *
 * Usage:
 *   npx tsx scripts/screenshot.ts <path> [outfile] [--viewport 1440x900] [--scroll-x 600] [--scroll-selector "..."]
 *
 * Opens the local owner workspace directly (unlocking with
 * ROLSPEC_ACCESS_KEY when the deployment uses the public key gate) and writes a
 * full-page PNG to scripts/screenshots/.
 */
import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { chromium, type Browser, type Page } from "playwright"

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3100"
const ACCESS_KEY = process.env.ROLSPEC_ACCESS_KEY ?? ""

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

async function unlockIfNeeded(page: Page) {
  if (!page.url().includes("/unlock")) return
  if (!ACCESS_KEY) {
    throw new Error(
      "This deployment uses the owner key gate. Set ROLSPEC_ACCESS_KEY to screenshot the workspace."
    )
  }
  await page.fill("#owner-access-key", ACCESS_KEY)
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/unlock"), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ])
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser: Browser = await chromium.launch()
  const viewport = { width: args.width, height: args.height }

  const context = await browser.newContext({
    viewport,
    storageState: fs.existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined,
  })

  const page = await context.newPage()
  await page.goto(`${BASE_URL}${args.targetPath}`, { waitUntil: "domcontentloaded" })

  await unlockIfNeeded(page)

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
