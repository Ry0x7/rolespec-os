/* eslint-disable @typescript-eslint/no-require-imports -- Directly executable CommonJS QA driver. */
// Run against a loopback production server with a disposable database:
//   node scripts/qa/release-matrix.cjs
// Evidence: .unlazy/qa/release-matrix/{report.json,*.png}
//
// This driver is deliberately read-only: no settings are saved, no workflow is
// started and no application status changes. Functional mutations live in
// release-journeys.cjs.
const { chromium } = require("playwright")
const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")

const base = process.env.QA_BASE_URL || "http://127.0.0.1:3100"
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) {
  throw new Error("QA drivers must target a loopback server with a disposable database")
}

const dir = path.resolve(process.env.QA_EVIDENCE_DIR || ".unlazy/qa/release-matrix")
fs.mkdirSync(dir, { recursive: true })

const report = {
  startedAt: new Date().toISOString(),
  base,
  browser: null,
  viewports: [320, 390, 768, 1440, 1920],
  checks: [],
  failures: [],
  console: [],
  limitations: [],
  contrast: [],
}
let page
const save = () => fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2))
const shot = async (name, fullPage = true) => {
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage })
  return name
}
const check = async (name, fn) => {
  try {
    const evidence = await fn()
    report.checks.push({ name, result: "passed", evidence })
  } catch (error) {
    report.failures.push({ name, message: error.message })
    await shot(`failure-${report.failures.length}`, false).catch(() => {})
  }
  save()
}
const goto = async (route) => {
  await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 45000 })
  await page.locator("main, h1").first().waitFor({ timeout: 45000 })
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(250)
}

/** Document-level overflow plus the specific elements leaking past the viewport. */
const overflowAudit = () =>
  page.evaluate(() => {
    const doc = document.documentElement
    const width = doc.clientWidth
    const leaks = []
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      const style = getComputedStyle(element)
      if (style.position === "fixed" || style.visibility === "hidden") continue
      // Intentional horizontal scrollers (tab strips, tables) are allowed to
      // scroll inside themselves, but must not push the page wider.
      if (rect.right > width + 1 && style.overflowX !== "auto" && style.overflowX !== "scroll") {
        leaks.push({
          tag: element.tagName.toLowerCase(),
          className: String(element.className).slice(0, 120),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        })
      }
    }
    return {
      document: doc.scrollWidth - doc.clientWidth,
      viewport: width,
      leaks: leaks.slice(0, 6),
      leakCount: leaks.length,
    }
  })

const ROUTES = [
  ["/dashboard", "Home"],
  ["/jobs", "Saved jobs"],
  ["/jobs/discover", "Discover"],
  ["/career-profile?setup=0", "Career profile"],
  ["/settings/preferences", "Preferences"],
  ["/settings/appearance", "Appearance"],
  ["/planner", "Planner"],
  ["/resumes", "Resumes"],
  ["/workspace?view=tracking", "Workspace"],
]

function parseColor(value) {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split("").map((d) => d + d).join("") : hex[1]
    const n = parseInt(digits, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = value.match(/rgba?\(([^)]+)\)/)
  if (!rgb) return null
  const parts = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number)
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null
  return parts.slice(0, 3)
}

function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

;(async () => {
  const browser = await chromium.launch({ channel: "chromium", headless: true })
  report.browser = browser.version()

  try {
    // ---------------------------------------------------------------------
    // Responsive + theme matrix. A fresh context per mode makes the blocking
    // init script read the stored mode before first paint.
    // ---------------------------------------------------------------------
    for (const mode of ["dark", "light"]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        colorScheme: mode,
      })
      await context.addInitScript((stored) => {
        window.localStorage.setItem("rolespec-mode", stored)
        window.localStorage.removeItem("rolespec-accent")
        window.localStorage.removeItem("rolespec-preset")
        window.localStorage.removeItem("rolespec-motion")
      }, mode)
      page = await context.newPage()
      page.setDefaultTimeout(20000)
      page.on("console", (message) => {
        if (message.type() === "error") {
          report.console.push({ mode, text: message.text().slice(0, 300), url: page.url() })
        }
      })
      page.on("pageerror", (error) =>
        report.console.push({ mode, type: "pageerror", text: error.message, url: page.url() })
      )

      for (const width of report.viewports) {
        await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 })
        for (const [route, label] of ROUTES) {
          await check(`${mode} ${width}px ${label}: renders without page overflow`, async () => {
            await goto(route)
            const sizes = await overflowAudit()
            assert(
              sizes.document <= 0,
              `${route} overflows by ${sizes.document}px at ${width}px: ${JSON.stringify(sizes.leaks)}`
            )
            assert.equal(
              sizes.leakCount,
              0,
              `${route} leaks elements past the viewport: ${JSON.stringify(sizes.leaks)}`
            )
            const applied = await page.evaluate(() => ({
              light: document.documentElement.classList.contains("light"),
              dark: document.documentElement.classList.contains("dark"),
            }))
            assert.equal(applied.light, mode === "light", `stored ${mode} mode did not apply`)
            assert.equal(applied.dark, mode === "dark", `stored ${mode} mode did not apply`)
            return sizes
          })
        }
      }

      if (mode === "dark") {
        await page.setViewportSize({ width: 1440, height: 1000 })
        await goto("/jobs")
        await shot("jobs-1440-dark")
        await page.setViewportSize({ width: 390, height: 844 })
        await goto("/jobs")
        await shot("jobs-390-dark")
        await page.setViewportSize({ width: 320, height: 800 })
        await goto("/jobs/discover")
        await shot("discovery-320-dark")
      } else {
        await page.setViewportSize({ width: 390, height: 844 })
        await goto("/jobs")
        await shot("jobs-390-light")
      }
      await context.close()
    }

    // ---------------------------------------------------------------------
    // Contrast tokens: every accent must keep the focus ring visible on the
    // surfaces it is drawn over, in both modes.
    // ---------------------------------------------------------------------
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    page = await context.newPage()
    await page.goto(base + "/dashboard", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(500)

    for (const mode of ["dark", "light"]) {
      for (const theme of ["blue", "violet", "emerald", "amber", "rose", "cyan"]) {
        const tokens = await page.evaluate(
          ({ modeClass, themeClass }) => {
            const root = document.documentElement
            root.classList.remove("light", "dark")
            for (const candidate of ["blue", "violet", "emerald", "amber", "rose", "cyan"]) {
              root.classList.remove(`theme-${candidate}`)
            }
            root.classList.add(modeClass)
            if (themeClass !== "blue") root.classList.add(`theme-${themeClass}`)
            const style = getComputedStyle(root)
            return {
              ring: style.getPropertyValue("--color-ring").trim(),
              card: style.getPropertyValue("--color-card").trim(),
              muted: style.getPropertyValue("--color-muted").trim(),
              mutedForeground: style.getPropertyValue("--color-muted-foreground").trim(),
            }
          },
          { modeClass: mode, themeClass: theme }
        )
        const ring = parseColor(tokens.ring)
        const card = parseColor(tokens.card)
        const muted = parseColor(tokens.muted)
        const mutedText = parseColor(tokens.mutedForeground)
        const ringRatio = ring && card ? contrast(ring, card) : null
        const mutedRatio = muted && mutedText ? contrast(mutedText, muted) : null
        report.contrast.push({ mode, theme, ...tokens, ringRatio, mutedRatio })
        await check(`${mode} ${theme}: focus ring clears 3:1 on cards`, async () => {
          assert(ringRatio !== null, `could not parse ring/card tokens: ${JSON.stringify(tokens)}`)
          assert(ringRatio >= 3, `ring/card ratio ${ringRatio.toFixed(2)} for ${mode}/${theme}`)
          return Number(ringRatio.toFixed(2))
        })
        await check(`${mode} ${theme}: muted helper text clears 4.5:1`, async () => {
          assert(mutedRatio !== null, `could not parse muted tokens: ${JSON.stringify(tokens)}`)
          assert(mutedRatio >= 4.5, `muted ratio ${mutedRatio.toFixed(2)} for ${mode}/${theme}`)
          return Number(mutedRatio.toFixed(2))
        })
      }
    }
    // Restore the persisted default so later checks do not inherit the probe.
    await page.evaluate(() => {
      const root = document.documentElement
      root.classList.remove("light")
      root.classList.add("dark")
      for (const candidate of ["blue", "violet", "emerald", "amber", "rose", "cyan"]) {
        root.classList.remove(`theme-${candidate}`)
      }
    })
    await context.close()

    // ---------------------------------------------------------------------
    // 200% zoom proxy: 1440 window at 200% gives a 720 CSS-px layout viewport.
    // The device scale factor is doubled so text and controls scale for real.
    // ---------------------------------------------------------------------
    const zoomContext = await browser.newContext({
      viewport: { width: 720, height: 500 },
      deviceScaleFactor: 2,
      colorScheme: "dark",
    })
    page = await zoomContext.newPage()
    page.setDefaultTimeout(20000)
    for (const [route, label] of [
      ["/jobs", "Saved jobs"],
      ["/dashboard", "Home"],
      ["/jobs/discover", "Discover"],
      ["/career-profile?setup=0", "Career profile"],
      ["/settings/preferences", "Preferences"],
    ]) {
      await check(`200% zoom ${label}: no horizontal page scroll`, async () => {
        await goto(route)
        const sizes = await overflowAudit()
        assert(
          sizes.document <= 0,
          `${route} overflows by ${sizes.document}px at 200% zoom: ${JSON.stringify(sizes.leaks)}`
        )
        await shot(`zoom-200-${label.toLowerCase().replace(/\s+/g, "-")}`)
        return sizes
      })
    }

    // Keyboard and focus: the first Tab stop must be visible, the preset
    // buttons must activate with Enter, and the mobile drawer must trap and
    // return focus.
    await check("Keyboard: first Tab stop receives a visible focus indicator", async () => {
      await goto("/jobs")
      await page.evaluate(() => document.body.focus())
      await page.keyboard.press("Tab")
      const focus = await page.evaluate(() => {
        const element = document.activeElement
        if (!element || element === document.body) return null
        const style = getComputedStyle(element)
        return {
          tag: element.tagName.toLowerCase(),
          label: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 80),
          boxShadow: style.boxShadow,
          outline: `${style.outlineStyle} ${style.outlineWidth}`,
          ring: getComputedStyle(document.documentElement).getPropertyValue("--color-ring").trim(),
        }
      })
      assert(focus, "Tab did not move focus off the body")
      assert(
        (focus.boxShadow && focus.boxShadow !== "none") || (focus.outline && !focus.outline.startsWith("none")),
        `focused ${focus.tag} has no visible indicator: ${JSON.stringify(focus)}`
      )
      return focus
    })

    await check("Keyboard: a filter preset activates with Enter and restores the URL state", async () => {
      await goto("/jobs")
      const preset = page.getByRole("button", { name: "High pay", exact: true })
      await preset.focus()
      await page.keyboard.press("Enter")
      await page.waitForTimeout(600)
      assert.match(page.url(), /[?&]preset=HIGH_PAY/)
      assert.equal(await preset.getAttribute("aria-pressed"), "true")
      // Restore the default so this driver leaves no URL/localStorage residue.
      await page.getByRole("button", { name: "Best overall", exact: true }).click()
      await page.waitForTimeout(400)
      return "Enter selected the preset"
    })

    await check("Mobile 390: navigation drawer traps focus, closes with Escape and restores it", async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      await goto("/dashboard")
      const open = page.getByRole("button", { name: "Open navigation", exact: true })
      await open.click()
      const dialog = page.getByRole("dialog").first()
      await dialog.waitFor()
      // The drawer mounts before its focus effect runs. Poll the actual focus
      // target rather than sampling the frame the dialog first appears.
      await page.waitForFunction(
        () => {
          const active = document.activeElement
          const dialogElement = document.querySelector('[role="dialog"]')
          return Boolean(active && dialogElement && dialogElement.contains(active))
        },
        undefined,
        { timeout: 5000 }
      )
      await shot("mobile-navigation-drawer", false)
      const focusInside = await page.evaluate(() => {
        const active = document.activeElement
        const dialogElement = document.querySelector('[role="dialog"]')
        return Boolean(active && dialogElement && dialogElement.contains(active))
      })
      assert(focusInside, "focus did not move into the mobile navigation drawer")
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "hidden" })
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("aria-label") === "Open navigation",
        undefined,
        { timeout: 5000 }
      )
      const returned = await page.evaluate(() => {
        const active = document.activeElement
        return active?.getAttribute("aria-label") === "Open navigation"
      })
      assert(returned, "focus was not returned to the navigation trigger")
      return { focusInside, returned }
    })

    await check("Reduced motion: the OS preference is honoured on first paint", async () => {
      const reduced = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      })
      const reducedPage = await reduced.newPage()
      await reducedPage.goto(base + "/dashboard", { waitUntil: "domcontentloaded" })
      await reducedPage.locator("main, h1").first().waitFor()
      const state = await reducedPage.evaluate(() => {
        const style = getComputedStyle(document.documentElement)
        const animated = [...document.querySelectorAll('[class*="animate-"]')]
        return {
          media: matchMedia("(prefers-reduced-motion: reduce)").matches,
          reduceClass: document.documentElement.classList.contains("reduce-motion"),
          transitionDuration: style.transitionDuration,
          animations: animated.filter((element) => getComputedStyle(element).animationName !== "none").length,
        }
      })
      await reduced.close()
      assert(state.media, "emulated reduced-motion media query did not apply")
      assert(state.reduceClass, "the app did not add reduce-motion")
      assert.equal(state.animations, 0, `${state.animations} animations still run under reduced motion`)
      return state
    })

    const pageErrors = report.console.filter((entry) => entry.type === "pageerror")
    await check("No uncaught page errors across the matrix", async () => {
      assert.equal(pageErrors.length, 0, pageErrors.map((entry) => entry.text).join("\n"))
      return { consoleEntries: report.console.length }
    })
  } finally {
    report.finishedAt = new Date().toISOString()
    save()
    await browser.close()
  }

  const passed = report.checks.filter((entry) => entry.result === "passed").length
  console.log(
    JSON.stringify(
      { passed, checks: report.checks.length, failures: report.failures, limitations: report.limitations },
      null,
      2
    )
  )
  if (report.failures.length > 0) process.exitCode = 1
})()
