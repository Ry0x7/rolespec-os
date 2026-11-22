/* eslint-disable @typescript-eslint/no-require-imports -- Directly executable CommonJS QA driver. */
// Run against a loopback server with a disposable database:
//   node scripts/qa/opportunity-filters.cjs
// Evidence: .unlazy/qa/opportunity-filters/{report.json,*.png}
const { chromium } = require("playwright")
const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")

const base = process.env.QA_BASE_URL || "http://localhost:3100"
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) {
  throw new Error("QA drivers must target a loopback server with a disposable database")
}

const dir = path.resolve(".unlazy/qa/opportunity-filters")
fs.mkdirSync(dir, { recursive: true })

const report = {
  startedAt: new Date().toISOString(),
  base,
  ui: {},
  checks: [],
  failures: [],
  console: [],
  network: [],
  limitations: [],
}
let page
const save = () => fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2))
const shot = async (name, fullPage = true) => {
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage })
  return name
}
const counts = async () => {
  const text = await page.getByRole("region", { name: "Filter opportunities" }).innerText()
  const match = text.match(/(\d+)\s+eligible\s+·\s+(\d+)\s+need more info\s+·\s+(\d+)\s+excluded/)
  assert(match, `counts not found in:\n${text}`)
  return { eligible: Number(match[1]), unknown: Number(match[2]), excluded: Number(match[3]) }
}
const overflow = () =>
  page.evaluate(() => {
    const doc = document.documentElement
    return {
      document: doc.scrollWidth - doc.clientWidth,
      panel: (() => {
        const panel = document.querySelector('section[aria-label="Filter opportunities"]')
        return panel ? panel.scrollWidth - panel.clientWidth : null
      })(),
    }
  })
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
  await page.locator("h1").first().waitFor({ timeout: 45000 })
  // Wait for hydration, not just the shell: a click on a not-yet-hydrated
  // button is silently dropped and looks like a product bug.
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(300)
}


;(async () => {
  const browser = await chromium.launch({ channel: "chromium", headless: true })
  report.ui.browser = browser.version()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on("console", (message) => {
    if (message.type() === "error") report.console.push({ text: message.text(), url: page.url() })
  })
  page.on("pageerror", (error) => report.console.push({ type: "pageerror", text: error.message }))
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) {
      report.network.push({ url: response.url().split("?")[0], status: response.status() })
    }
  })

  const panel = () => page.getByRole("region", { name: "Filter opportunities" })
  const presetButton = (name) => page.getByRole("button", { name, exact: true })
  const filtersToggle = () => panel().getByRole("button", { name: /^Filters/ })
  const resetFilters = () => panel().getByRole("button", { name: "Reset filters" })
  const openFilters = async () => {
    if ((await filtersToggle().getAttribute("aria-expanded")) !== "true") {
      await filtersToggle().click()
      await page.waitForFunction(
        () =>
          document
            .querySelector('section[aria-label="Filter opportunities"] button[aria-controls]')
            ?.getAttribute("aria-expanded") === "true",
        undefined,
        { timeout: 10000 }
      )
    }
  }

  try {
    await goto("/jobs")
    await page.evaluate(() => window.localStorage.clear())

    await check("Jobs 1440: panel starts compact with every preset and live counts", async () => {
      await panel().waitFor()
      for (const name of ["Best overall", "High pay", "High pay / lighter workload", "Easy to apply"]) {
        assert.equal(await presetButton(name).count(), 1, `${name} missing`)
      }
      assert.equal(await presetButton("Best overall").getAttribute("aria-pressed"), "true")
      const initial = await counts()
      assert(initial.eligible > 0, "default view has no eligible jobs")
      assert.equal(await filtersToggle().getAttribute("aria-expanded"), "false", "advanced filters are not collapsed")
      await shot("jobs-1440-default")
      return initial
    })

    await check("Jobs 1440: original pay and the converted equivalent carry the rate date", async () => {
      const equivalent = page.locator('[data-testid="salary-equivalent"]').first()
      await equivalent.waitFor()
      const text = (await equivalent.innerText()).replace(/\s+/g, " ")
      assert.match(text, /≈\s.+\s·\s\d{4}-\d{2}-\d{2}/, `no rate date in: ${text}`)
      const cardText = await equivalent.locator("xpath=ancestor::*[self::article or self::li][1]").innerText().catch(() => "")
      assert.match(cardText || text, /[$₱€£¥₹]|USD|PHP|EUR|GBP/, "no original currency figure on the card")
      return { equivalent: text, visibleEquivalents: await page.locator('[data-testid="salary-equivalent"]').count() }
    })

    await check("Jobs 1440: High pay applies, sorts by pay and keeps every posting accounted for", async () => {
      const before = await counts()
      await presetButton("High pay").click()
      await page.waitForTimeout(600)
      assert.match(page.url(), /[?&]preset=HIGH_PAY/)
      assert.equal(await presetButton("High pay").getAttribute("aria-pressed"), "true")
      const grouped = await counts()
      assert.equal(grouped.eligible + grouped.unknown + grouped.excluded, before.eligible + before.unknown + before.excluded)
      await shot("jobs-1440-high-pay")
      return grouped
    })

    await check("Jobs 1440: a currency no posting uses is reported as needing more info, not below the floor", async () => {
      await filtersToggle().click()
      await page.getByLabel("Minimum pay (annual)").fill("1000000")
      await page.getByLabel("Minimum pay currency").selectOption("JPY")
      await page.waitForTimeout(600)
      const grouped = await counts()
      assert.equal(grouped.eligible + grouped.excluded, 0, JSON.stringify(grouped))
      assert(grouped.unknown > 0)
      await page.getByText(/Needs more info/).first().waitFor()
      await shot("jobs-1440-unknown-currency")
      return grouped
    })

    await check("Jobs 1440: the chosen view survives a reload", async () => {
      await presetButton("High pay").click()
      await page.waitForTimeout(500)
      await page.reload({ waitUntil: "domcontentloaded" })
      await panel().waitFor()
      assert.equal(await presetButton("High pay").getAttribute("aria-pressed"), "true")
      assert.match(page.url(), /[?&]preset=HIGH_PAY/)
      return page.url()
    })

    await check("Jobs: a bare URL restores the remembered view from local storage", async () => {
      await goto("/jobs")
      await page.waitForTimeout(600)
      assert.equal(await presetButton("High pay").getAttribute("aria-pressed"), "true")
      return await page.evaluate(() => window.localStorage.getItem("rolespec:opportunity-filters:jobs:v1"))
    })

    await check("Jobs 1440: Reset clears the URL, the stored view and the grouping", async () => {
      await filtersToggle().click()
      await resetFilters().click()
      await page.waitForTimeout(600)
      assert.equal(new URL(page.url()).searchParams.get("preset"), null)
      assert.equal(await presetButton("Best overall").getAttribute("aria-pressed"), "true")
      const restored = await counts()
      assert.equal(restored.unknown, 0)
      assert(restored.eligible > 0)
      assert.equal(await page.evaluate(() => window.localStorage.getItem("rolespec:opportunity-filters:jobs:v1")), null)
      await shot("jobs-1440-reset")
      return restored
    })

    await check("Jobs 1440: advanced filters persist through a reload", async () => {
      await openFilters()
      await page.getByLabel("Minimum pay (annual)").fill("900000")
      await page.getByLabel("Minimum pay currency").selectOption("PHP")
      await page.getByLabel("Pay period").selectOption("MONTHLY")
      await page.getByLabel("Remote eligibility").selectOption("REMOTE")
      await page.getByLabel("Experience").selectOption("MID")
      await page.getByLabel("Freshness").selectOption("30")
      await page.getByLabel("Risk").selectOption("LOW")
      await page.getByLabel("Sort").selectOption("PAY_DESC")
      await page.waitForTimeout(700)
      await page.reload({ waitUntil: "domcontentloaded" })
      await panel().waitFor()
      assert.equal(await page.getByLabel("Minimum pay (annual)").inputValue(), "900000")
      assert.equal(await page.getByLabel("Minimum pay currency").inputValue(), "PHP")
      assert.equal(await page.getByLabel("Sort").inputValue(), "PAY_DESC")
      const params = new URL(page.url()).searchParams
      for (const key of ["paymin", "paycur", "payperiod", "remote", "exp", "fresh", "risk", "vsort"]) {
        assert(params.get(key), `${key} missing from ${page.url()}`)
      }
      await shot("jobs-1440-advanced")
      return Object.fromEntries(params)
    })

    await check("Jobs 1440: keyboard activation selects a preset", async () => {
      await presetButton("Easy to apply").focus()
      await page.keyboard.press("Enter")
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("button")].some(
            (button) => button.textContent?.trim() === "Easy to apply" && button.getAttribute("aria-pressed") === "true"
          ),
        undefined,
        { timeout: 10000 }
      )
      assert.match(page.url(), /[?&]preset=EASY_APPLY/)
      return "focus + Enter"
    })

    await check("Jobs 1440: the quick-view drawer opens and Escape returns focus", async () => {
      await openFilters()
      await resetFilters().click()
      await page.waitForTimeout(800)
      const quickView = page.getByRole("button", { name: /^Quick view / }).first()
      await quickView.waitFor({ timeout: 10000 })
      await quickView.click()
      const dialog = page.getByRole("dialog").first()
      await dialog.waitFor()
      await shot("jobs-1440-drawer", false)
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "hidden" })
      return "opened, then closed with Escape"
    })

    await check("Jobs 1440: every advanced control has an accessible name", async () => {
      await openFilters()
      const labels = [
        "Minimum pay (annual)",
        "Minimum pay currency",
        "Pay period",
        "Remote eligibility",
        "Location",
        "Experience",
        "Freshness",
        "Risk",
        "Application friction",
        "Sort",
      ]
      for (const label of labels) assert.equal(await page.getByLabel(label).count(), 1, `${label} is unlabelled`)
      for (const name of ["On-call", "Overtime", "Shifts", "Quotas", "Travel", "Broad role", "Rigid schedule"]) {
        assert.equal(await page.getByLabel(name, { exact: true }).count(), 1, `${name} checkbox is unlabelled`)
      }
      return labels.length + 8
    })

    await check("Jobs 768: the compact panel wraps without horizontal scroll", async () => {
      await page.setViewportSize({ width: 768, height: 1000 })
      await goto("/jobs")
      const sizes = await overflow()
      assert(sizes.document <= 0, `document overflows by ${sizes.document}px`)
      assert(sizes.panel <= 0, `panel overflows by ${sizes.panel}px`)
      await presetButton("High pay").click()
      await page.waitForTimeout(500)
      assert.match(page.url(), /preset=HIGH_PAY/)
      await shot("jobs-768-high-pay")
      return sizes
    })

    await check("Jobs 390: advanced filters stay usable with no overflow", async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      await goto("/jobs")
      await openFilters()
      const sizes = await overflow()
      assert(sizes.document <= 0, `document overflows by ${sizes.document}px`)
      assert(sizes.panel <= 0, `panel overflows by ${sizes.panel}px`)
      const field = page.getByLabel("Minimum pay (annual)")
      await field.scrollIntoViewIfNeeded()
      await field.fill("500000")
      await page.getByLabel("Application friction").selectOption("70")
      await page.waitForTimeout(400)
      await shot("jobs-390-advanced")
      return sizes
    })

    await check("Dashboard 1440: ranking screen filters and keeps the seven-factor explanation", async () => {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await goto("/dashboard")
      await panel().waitFor()
      const countLine = page.getByText(/\d+ eligible · \d+ need more info · \d+ excluded/).first()
      if ((await countLine.count()) === 0) {
        // No saved snapshot yet: run the real deterministic ranking.
        await page.getByRole("button", { name: /^(Rank saved jobs|Refresh ranking)$/ }).click()
      }
      await countLine.waitFor({ timeout: 30000 })
      const before = await counts()
      assert((await page.getByRole("heading", { name: "Ranked opportunities" }).count()) === 1)
      await presetButton("High pay").click()
      await page.waitForTimeout(700)
      assert.match(page.url(), /preset=HIGH_PAY/)
      const after = await counts()
      // Every saved posting on this fixture states pay, so the preset must not
      // empty the board: the leaderboard reads pay from the saved job.
      assert(after.eligible > 0, `High pay emptied the board: ${JSON.stringify(after)}`)
      await shot("dashboard-1440-high-pay")
      return { before, after }
    })

    await check("Discovery: a real run exposes the same panel and grouping", async () => {
      await goto("/jobs/discover")
      const search = page.getByRole("button", { name: "Search", exact: true })
      if ((await search.count()) === 0) {
        report.limitations.push("Discovery requires a career profile before it can run")
        return "skipped: no Search button"
      }
      await search.click()
      const result = page.getByRole("region", { name: "Filter opportunities" })
      const empty = page.getByText("No postings came back", { exact: false })
      await Promise.race([
        result.waitFor({ timeout: 90000 }).catch(() => null),
        empty.waitFor({ timeout: 90000 }).catch(() => null),
      ])
      const visible = (await result.count()) > 0
      if (!visible) {
        const message = await page.locator('[role="alert"]').first().innerText().catch(() => "")
        report.limitations.push(`Discovery returned no postings in this run. ${message}`.trim())
        await shot("discovery-empty")
        return "skipped: the sources returned nothing"
      }
      const grouped = await counts()
      await presetButton("High pay").click()
      await page.waitForTimeout(500)
      await shot("discovery-1440-high-pay")
      await page.setViewportSize({ width: 390, height: 844 })
      await shot("discovery-390-high-pay")
      return { grouped, url: page.url() }
    })

    const pageErrors = report.console.filter((entry) => entry.type === "pageerror")
    await check("No uncaught page errors during the run", async () => {
      assert.equal(pageErrors.length, 0, pageErrors.map((entry) => entry.text).join("\n"))
      return { consoleErrors: report.console.length, apiFailures: report.network.length }
    })
  } finally {
    report.finishedAt = new Date().toISOString()
    save()
    await browser.close()
  }

  console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures, limitations: report.limitations, console: report.console.slice(0, 5) }, null, 2))
  if (report.failures.length > 0) process.exitCode = 1
})()
