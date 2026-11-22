/* eslint-disable @typescript-eslint/no-require-imports -- Directly executable CommonJS QA driver. */
// Run against a loopback server with a disposable database:
//   node scripts/qa/discovery-feedback.cjs
// Evidence: .unlazy/qa/discovery-feedback/{report.json,*.png}
const { chromium } = require("playwright")
const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")

const base = process.env.QA_BASE_URL || "http://127.0.0.1:3110"
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) {
  throw new Error("QA drivers must target a loopback server with a disposable database")
}

const dir = path.resolve(".unlazy/qa/discovery-feedback")
fs.mkdirSync(dir, { recursive: true })

const report = {
  startedAt: new Date().toISOString(),
  base,
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
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(300)
}
const overflow = () =>
  page.evaluate(() => {
    const doc = document.documentElement
    return { document: doc.scrollWidth - doc.clientWidth }
  })

;(async () => {
  const browser = await chromium.launch({ channel: "chromium", headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on("console", (message) => {
    if (message.type() === "error") report.console.push({ text: message.text(), url: page.url() })
  })
  page.on("pageerror", (error) =>
    report.console.push({ type: "pageerror", text: error.message, url: page.url() })
  )
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) {
      report.network.push({ url: response.url().split("?")[0], status: response.status() })
    }
  })

  try {
    await goto("/jobs")
    await page.evaluate(() => window.localStorage.clear())

    await check("Saved jobs: each card has a clearly labelled user-feedback control", async () => {
      const select = page.getByLabel(/^Your feedback on /).first()
      await select.waitFor({ timeout: 15000 })
      const options = await select.locator("option").allTextContents()
      assert.deepEqual(options, [
        "Not set",
        "Interested",
        "Irrelevant",
        "Applied",
        "Rejected",
        "Interviewed",
        "Offered",
      ])
      await shot("jobs-1440-feedback")
      return { label: await select.getAttribute("aria-label"), options }
    })

    await check("Saved jobs: a verdict persists across a reload and can be cleared", async () => {
      const select = page.getByLabel(/^Your feedback on /).first()
      const label = await select.getAttribute("aria-label")
      await select.selectOption("INTERESTED")
      await page.waitForTimeout(900)
      assert.equal(await select.inputValue(), "INTERESTED")
      await page.reload({ waitUntil: "domcontentloaded" })
      const reloaded = page.getByLabel(label)
      await reloaded.waitFor({ timeout: 15000 })
      assert.equal(await reloaded.inputValue(), "INTERESTED", "verdict did not survive reload")
      await reloaded.selectOption("")
      await page.waitForTimeout(900)
      await page.reload({ waitUntil: "domcontentloaded" })
      assert.equal(await page.getByLabel(label).inputValue(), "", "cleared verdict came back")
      return { label, restored: "INTERESTED", cleared: true }
    })

    await goto("/jobs/discover")

    await check("Discovery: a career-path role is visible but not searched until opted in", async () => {
      const summary = page.getByText(/Recommended roles in discovery · \d+ of \d+ enabled/)
      await summary.waitFor({ timeout: 15000 })
      await summary.click()
      const row = page.getByLabel(/Data Analyst/).first()
      await row.waitFor()
      assert.equal(await row.isChecked(), false)
      assert((await page.getByText("Not searched", { exact: true }).count()) > 0)
      // A server action plus router.refresh is asynchronous; click and poll the
      // resolved control rather than asking Playwright's check() to see it flip
      // inside its own click assertion.
      await row.click()
      for (let i = 0; i < 30; i += 1) {
        if (await page.getByLabel(/Data Analyst/).first().isChecked()) break
        await page.waitForTimeout(300)
      }
      assert.equal(await page.getByLabel(/Data Analyst/).first().isChecked(), true)
      assert((await page.getByText("In discovery", { exact: true }).count()) > 0)
      // Restore the seeded opt-out so later runs use the same state.
      await page.getByLabel(/Data Analyst/).first().click()
      for (let i = 0; i < 30; i += 1) {
        if (!(await page.getByLabel(/Data Analyst/).first().isChecked())) break
        await page.waitForTimeout(300)
      }
      await shot("discovery-1440-role-opt-in")
      return "disabled by default; explicit toggle works"
    })

    await check("Discovery: saved search can be created with a daily alert", async () => {
      await page.getByRole("button", { name: "New search" }).click()
      await page.getByLabel("Name").fill("QA search 2026")
      const role = page.locator('fieldset input[type="checkbox"]').first()
      await role.check()
      await page.getByLabel("Alert frequency").selectOption("DAILY")
      await page.getByRole("button", { name: "Save search" }).click()
      await page.getByText("QA search 2026", { exact: true }).waitFor({ timeout: 15000 })
      const alert = page.getByLabel("Alert frequency for QA search 2026")
      assert.equal(await alert.inputValue(), "DAILY")
      await shot("discovery-1440-saved-search")
      return { name: "QA search 2026", alert: "DAILY" }
    })

    await check("Discovery: the alert is editable and both survive a reload", async () => {
      const select = page.getByLabel("Alert frequency for QA search 2026")
      await select.selectOption("WEEKLY")
      await page.waitForTimeout(900)
      await page.reload({ waitUntil: "domcontentloaded" })
      const reloaded = page.getByLabel("Alert frequency for QA search 2026")
      await reloaded.waitFor({ timeout: 15000 })
      assert.equal(await reloaded.inputValue(), "WEEKLY")
      assert.equal(
        await page.getByText("QA search 2026", { exact: true }).count(),
        1,
        "saved search disappeared after reload"
      )
      return "WEEKLY after reload"
    })

    await check("Discovery: saved search can be deleted again", async () => {
      await page.getByRole("button", { name: "Delete saved search QA search 2026" }).click()
      await page.getByRole("button", { name: "Confirm delete" }).click()
      await page.waitForTimeout(1000)
      assert.equal(await page.getByText("QA search 2026", { exact: true }).count(), 0)
      return "deleted"
    })

    await check("Discovery: a real run reports coverage, or records why it could not run", async () => {
      const search = page.getByRole("button", { name: "Search", exact: true })
      if ((await search.count()) === 0) {
        report.limitations.push("Discovery has no runnable target roles on this fixture")
        return "skipped"
      }
      await search.click()
      const results = page.getByText(/Coverage · \d+ unique/)
      const empty = page.getByText("No postings came back", { exact: false })
      await Promise.race([
        results.waitFor({ timeout: 120000 }).catch(() => null),
        empty.waitFor({ timeout: 120000 }).catch(() => null),
      ])
      if ((await results.count()) === 0) {
        report.limitations.push(
          "Discovery returned no postings in this run; coverage was not rendered."
        )
        return "no postings"
      }
      await results.first().click()
      const text = await results.first().locator("xpath=..").innerText()
      assert.match(text, /Postings received/)
      assert.match(text, /duplicate/)
      assert.match(text, /Regional eligibility/)
      assert.match(text, /our inference/)
      await shot("discovery-1440-coverage")
      return text.slice(0, 400)
    })

    await goto("/dashboard")
    await check("Ranking: feedback is applied and explained after a re-rank", async () => {
      const rank = page.getByRole("button", { name: /^(Rank saved jobs|Refresh ranking)$/ })
      if ((await rank.count()) === 0) {
        report.limitations.push("Dashboard ranking unavailable on this fixture")
        return "skipped"
      }
      if ((await page.getByText("Why this rank?").count()) === 0) {
        await rank.first().click()
      }
      await page.getByText("Why this rank?").first().waitFor({ timeout: 45000 })
      const select = page.getByLabel(/^Your feedback on /).first()
      await select.waitFor({ timeout: 15000 })
      assert.equal(await select.inputValue(), "")
      await select.selectOption("INTERVIEWED")
      await page.waitForTimeout(1000)
      // Wait for the actual re-rank response: the old explanation is already on
      // screen, so waiting for its text alone raced the POST and opened the
      // stale details before the feedback-adjusted result arrived.
      const reranked = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/ranking") && response.request().method() === "POST",
        { timeout: 45000 }
      )
      await page.getByRole("button", { name: "Refresh ranking" }).click()
      await reranked
      await page.waitForTimeout(1000)
      await page.getByText("Why this rank?").first().waitFor({ timeout: 45000 })
      await page.getByText("Why this rank?").first().click()
      const applied = page.getByText(/Your feedback · Interviewed/).first()
      // A revalidation can replace the row just after the click and close the
      // native details element; re-open it instead of failing on a harness race.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (await applied.isVisible().catch(() => false)) break
        await page.waitForTimeout(300)
        if (attempt === 3) await page.getByText("Why this rank?").first().click()
      }
      await applied.waitFor({ state: "visible", timeout: 45000 })
      const explanation = await page
        .getByText(/You reached an interview for this posting/)
        .first()
        .innerText()
      assert.match(explanation, /interview/i)
      await shot("dashboard-1440-feedback-adjustment")
      // Leave the fixture clean for a repeat run.
      await page.getByLabel(/^Your feedback on /).first().selectOption("")
      return explanation
    })

    await check("Mobile 390: discovery and feedback controls do not overflow", async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      await goto("/jobs/discover")
      const discovery = await overflow()
      assert(discovery.document <= 0, `discovery overflows by ${discovery.document}px`)
      await shot("discovery-390")
      await goto("/jobs")
      const jobs = await overflow()
      assert(jobs.document <= 0, `jobs overflows by ${jobs.document}px`)
      await shot("jobs-390-feedback")
      return { discovery, jobs }
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

  console.log(
    JSON.stringify(
      {
        checks: report.checks.length,
        failures: report.failures,
        limitations: report.limitations,
        console: report.console.slice(0, 5),
      },
      null,
      2
    )
  )
  if (report.failures.length > 0) process.exitCode = 1
})()
