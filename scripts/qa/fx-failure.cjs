/* eslint-disable @typescript-eslint/no-require-imports -- Directly executable CommonJS QA driver. */
// Requires a loopback server started with fx-failure-preload.cjs so the
// Frankfurter request fails but the persisted rate set is still readable:
//   NODE_OPTIONS="--require ./scripts/qa/fx-failure-preload.cjs" next start -p 3110
//   node scripts/qa/fx-failure.cjs
const { chromium } = require("playwright")
const { Client } = require("pg")
const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")

const base = process.env.QA_BASE_URL || "http://127.0.0.1:3110"
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) {
  throw new Error("QA drivers must target a loopback server with a disposable database")
}
const dir = path.resolve(process.env.QA_EVIDENCE_DIR || ".unlazy/qa/fx-failure")
fs.mkdirSync(dir, { recursive: true })
const report = { startedAt: new Date().toISOString(), base, checks: [], failures: [], limitations: [] }
const save = () => fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2))
const dbUrl =
  process.env.QA_DATABASE_URL ||
  fs.readFileSync(".unlazy/qa/discovery-feedback/qa-db-url.txt", "utf8").trim()

;(async () => {
  const db = new Client({ connectionString: dbUrl })
  await db.connect()
  const user = (await db.query("SELECT id, preferences FROM users LIMIT 1")).rows[0]
  assert(user, "no user in the QA database")
  const original = user.preferences ?? {}
  const browser = await chromium.launch({ channel: "chromium", headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))

  try {
    // A stale set exists for both USD and PHP; reading it after the failed
    // fetch is the graceful-degradation path. The line must say so.
    await db.query("UPDATE users SET preferences = $2 WHERE id = $1", [
      user.id,
      { ...original, preferredCurrency: "PHP" },
    ])

    await page.goto(base + "/jobs", { waitUntil: "domcontentloaded", timeout: 45000 })
    await page.locator("h1").first().waitFor({ timeout: 45000 })
    await page.getByRole("region", { name: "Filter opportunities" }).waitFor()
    const line = page.locator('[data-testid="salary-equivalent"]').first()
    await line.waitFor({ timeout: 30000 })
    const text = (await line.innerText()).replace(/\s+/g, " ")
    assert.match(text, /≈\s.+·\s\d{4}-\d{2}-\d{2}, last known/, `stale caption missing: ${text}`)

    // Every converted figure on the page must carry its date and stale marker;
    // no bare approximate number may survive an FX outage.
    const equivalents = await page.locator('[data-testid="salary-equivalent"]').allInnerTexts()
    for (const entry of equivalents) {
      assert.match(entry.replace(/\s+/g, " "), /≈\s.+·\s\d{4}-\d{2}-\d{2}/, entry)
    }
    await page.screenshot({ path: path.join(dir, "jobs-fx-failure.png"), fullPage: true })
    report.checks.push({
      name: "FX outage: persisted last-known rates are labelled, never invented",
      result: "passed",
      evidence: { sample: text, convertedCards: equivalents.length },
    })
    assert.equal(errors.length, 0, errors.join("\n"))
  } catch (error) {
    report.failures.push({ name: "FX outage fallback", message: error.message })
    await page.screenshot({ path: path.join(dir, "failure.png") }).catch(() => {})
  } finally {
    await db.query("UPDATE users SET preferences = $2 WHERE id = $1", [user.id, original])
    await db.end()
    report.finishedAt = new Date().toISOString()
    save()
    await browser.close()
  }

  console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures }, null, 2))
  if (report.failures.length > 0) process.exitCode = 1
})()
