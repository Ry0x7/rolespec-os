/**
 * Dashboard visual regression at phone and desktop widths.
 *
 * Usage:
 *   npx tsx scripts/visual-regression-dashboard.ts            # compare
 *   npx tsx scripts/visual-regression-dashboard.ts --update   # write baselines
 *
 * The script drives the deterministic `/visual/dashboard` fixture, so it does
 * not read the database and its date labels never move. Both the normal state
 * and `?state=worst` are captured; the worst-case state also has to pass a real
 * horizontal-overflow check before it can match its baseline.
 *
 * Run it against a local development server:
 *   SCREENSHOT_BASE_URL=http://localhost:3100 npx tsx scripts/visual-regression-dashboard.ts
 */
import fs from "node:fs"
import path from "node:path"
import { chromium, type Page } from "playwright"
import sharp from "sharp"

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3100"
const UPDATE = process.argv.includes("--update")
const BASELINE_DIR = path.join(process.cwd(), "screenshots", "visual-regression")
const EVIDENCE_DIR = path.join(process.cwd(), ".unlazy", "visual-regression")

const MAX_DIFF_RATIO = 0.002
const CHANNEL_TOLERANCE = 8

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, isMobile: true },
  { name: "desktop", width: 1440, height: 1000, isMobile: false },
] as const

const STATES = [
  { name: "default", query: "" },
  { name: "worst", query: "?state=worst" },
] as const

async function waitForStablePage(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor({
    timeout: 45_000,
  })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForTimeout(300)
}

async function hideDevChrome(page: Page) {
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

type OverflowReport = {
  viewportWidth: number
  documentWidth: number
  bodyWidth: number
  offenders: { tag: string; className: string; right: number; text: string }[]
  /** Children wider than their own container are clipped by a card, so the
   * document width alone would miss them. */
  oversizedChildren: {
    tag: string
    className: string
    width: number
    parentWidth: number
    text: string
  }[]
}

async function measureOverflow(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth
    const offenders = Array.from(document.querySelectorAll("*"))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        if (rect.width <= 0 || style.position === "fixed") return false
        return rect.right > viewportWidth + 1
      })
      .slice(0, 20)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          tag: element.tagName.toLowerCase(),
          className:
            typeof element.className === "string" ? element.className : "",
          right: Math.round(rect.right),
          text: (element.textContent ?? "").trim().slice(0, 100),
        }
      })

    const oversizedChildren = Array.from(document.querySelectorAll("main *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        const parentRect = element.parentElement?.getBoundingClientRect()
        if (!parentRect || rect.width <= 0 || rect.height <= 0) return false
        const style = getComputedStyle(element)
        if (style.position === "fixed") return false
        return (
          rect.width > parentRect.width + 2 ||
          rect.right > parentRect.right + 2 ||
          rect.left < parentRect.left - 2
        )
      })
      .slice(0, 20)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const parentRect = element.parentElement?.getBoundingClientRect()
        return {
          tag: element.tagName.toLowerCase(),
          className:
            typeof element.className === "string" ? element.className : "",
          width: Math.round(rect.width),
          parentWidth: Math.round(parentRect?.width ?? 0),
          text: (element.textContent ?? "").trim().slice(0, 100),
        }
      })

    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      offenders,
      oversizedChildren,
    }
  })
}

async function compareWithBaseline(actualPath: string, baselinePath: string) {
  const actual = await sharp(actualPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const baseline = await sharp(baselinePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (
    actual.info.width !== baseline.info.width ||
    actual.info.height !== baseline.info.height
  ) {
    return {
      ok: false,
      reason: `size changed from ${baseline.info.width}x${baseline.info.height} to ${actual.info.width}x${actual.info.height}`,
      ratio: 1,
    }
  }

  let changed = 0
  for (let index = 0; index < actual.data.length; index += 4) {
    if (
      Math.abs(actual.data[index] - baseline.data[index]) > CHANNEL_TOLERANCE ||
      Math.abs(actual.data[index + 1] - baseline.data[index + 1]) >
        CHANNEL_TOLERANCE ||
      Math.abs(actual.data[index + 2] - baseline.data[index + 2]) >
        CHANNEL_TOLERANCE ||
      Math.abs(actual.data[index + 3] - baseline.data[index + 3]) >
        CHANNEL_TOLERANCE
    ) {
      changed += 1
    }
  }

  const pixels = actual.info.width * actual.info.height
  const ratio = changed / pixels
  return { ok: ratio <= MAX_DIFF_RATIO, ratio, changed, pixels }
}

async function writeDiff(
  actualPath: string,
  baselinePath: string,
  outputPath: string,
) {
  await sharp(actualPath)
    .composite([{ input: baselinePath, blend: "difference" }])
    .png()
    .toFile(outputPath)
}

async function main() {
  fs.mkdirSync(BASELINE_DIR, { recursive: true })
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

  const browser = await chromium.launch()
  const failures: string[] = []

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
      colorScheme: "dark",
      reducedMotion: "reduce",
    })

    for (const state of STATES) {
      const page = await context.newPage()
      const url = `${BASE_URL}/visual/dashboard${state.query}`
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 })
      await hideDevChrome(page)
      await waitForStablePage(page)

      const overflow = await measureOverflow(page)
      if (overflow.documentWidth > overflow.viewportWidth + 1) {
        failures.push(
          `${state.name}/${viewport.name}: page scrolls horizontally (${overflow.documentWidth}px in ${overflow.viewportWidth}px)`,
        )
        console.error(
          `${viewport.name}/${state.name} overflow:`,
          JSON.stringify(overflow, null, 2),
        )
      }
      if (overflow.oversizedChildren.length > 0) {
        failures.push(
          `${state.name}/${viewport.name}: ${overflow.oversizedChildren.length} child element(s) wider than their container`,
        )
        console.error(
          `${viewport.name}/${state.name} oversized children:`,
          JSON.stringify(overflow.oversizedChildren, null, 2),
        )
      }

      const fileName = `dashboard-${state.name}-${viewport.width}.png`
      const actualPath = path.join(EVIDENCE_DIR, fileName)
      const baselinePath = path.join(BASELINE_DIR, fileName)
      await page.screenshot({
        path: actualPath,
        fullPage: true,
        animations: "disabled",
        caret: "hide",
      })

      if (UPDATE) {
        fs.copyFileSync(actualPath, baselinePath)
        console.log(`baseline written: ${path.relative(process.cwd(), baselinePath)}`)
      } else if (!fs.existsSync(baselinePath)) {
        failures.push(
          `${state.name}/${viewport.name}: missing baseline ${path.relative(process.cwd(), baselinePath)} (run with --update)`,
        )
      } else {
        const result = await compareWithBaseline(actualPath, baselinePath)
        if (!result.ok) {
          const diffPath = path.join(EVIDENCE_DIR, `diff-${fileName}`)
          await writeDiff(actualPath, baselinePath, diffPath)
          failures.push(
            `${state.name}/${viewport.name}: ${((result.ratio ?? 1) * 100).toFixed(2)}% of pixels changed (limit ${(MAX_DIFF_RATIO * 100).toFixed(2)}%; ${diffPath})`,
          )
        } else {
          console.log(
            `${viewport.name}/${state.name}: ${((result.ratio ?? 0) * 100).toFixed(3)}% pixels changed`,
          )
        }
      }

      await page.close()
    }

    await context.close()
  }

  await browser.close()

  if (failures.length > 0) {
    console.error("\nDashboard visual regression failed:")
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
    return
  }

  console.log("\nDashboard visual regression passed.")
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
