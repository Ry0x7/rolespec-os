/* eslint-disable @typescript-eslint/no-require-imports -- Directly executable CommonJS QA driver. */
// Functional journeys against a loopback production server and a disposable
// database: node scripts/qa/release-journeys.cjs
// Evidence: .unlazy/qa/release-journeys/{report.json,*.png}
//
// Onboarding is the only mutating journey. It snapshots the rows it touches and
// restores them in a finally block, so a rerun starts from the same fixture.
const { chromium } = require("playwright")
const { Client } = require("pg")
const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")

const base = process.env.QA_BASE_URL || "http://127.0.0.1:3100"
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) {
  throw new Error("QA drivers must target a loopback server with a disposable database")
}
const dir = path.resolve(process.env.QA_EVIDENCE_DIR || ".unlazy/qa/release-journeys")
fs.mkdirSync(dir, { recursive: true })

const report = { startedAt: new Date().toISOString(), base, checks: [], failures: [], console: [] }
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
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(300)
}

function databaseUrl() {
  if (process.env.QA_DATABASE_URL) return process.env.QA_DATABASE_URL
  return fs.readFileSync(".unlazy/qa/discovery-feedback/qa-db-url.txt", "utf8").trim()
}

async function snapshotOnboarding(db) {
  const user = (await db.query("SELECT id FROM users LIMIT 1")).rows[0]
  assert(user, "the QA database has no user")
  const player = (
    await db.query(
      `SELECT "currentRole", "targetRole", "experienceLevel", "applicationGoalTarget", "applicationGoalPeriod", "onboardedAt"
       FROM player_profiles WHERE "userId" = $1`,
      [user.id]
    )
  ).rows[0]
  const career = (
    await db.query('SELECT "experienceLevel" FROM career_profiles WHERE "userId" = $1', [user.id])
  ).rows[0]
  const roles = (await db.query('SELECT title FROM career_target_roles WHERE "careerProfileId" = (SELECT id FROM career_profiles WHERE "userId" = $1)', [user.id])).rows
  return { userId: user.id, player: player ?? null, career: career ?? null, titles: roles.map((row) => row.title) }
}

async function prepareOnboarding(db, snapshot) {
  await db.query(
    'UPDATE player_profiles SET "onboardedAt" = NULL, "experienceLevel" = NULL, "targetRole" = NULL WHERE "userId" = $1',
    [snapshot.userId]
  )
  await db.query('UPDATE career_profiles SET "experienceLevel" = NULL WHERE "userId" = $1', [snapshot.userId])
}

async function restoreOnboarding(db, snapshot) {
  const p = snapshot.player
  if (p) {
    await db.query(
      `UPDATE player_profiles SET "currentRole" = $2, "targetRole" = $3, "experienceLevel" = $4,
        "applicationGoalTarget" = $5, "applicationGoalPeriod" = $6, "onboardedAt" = $7 WHERE "userId" = $1`,
      [snapshot.userId, p.currentRole, p.targetRole, p.experienceLevel, p.applicationGoalTarget, p.applicationGoalPeriod, p.onboardedAt]
    )
  }
  await db.query('UPDATE career_profiles SET "experienceLevel" = $2 WHERE "userId" = $1', [
    snapshot.userId,
    snapshot.career?.experienceLevel ?? null,
  ])
  await db.query(
    'DELETE FROM career_target_roles WHERE "careerProfileId" = (SELECT id FROM career_profiles WHERE "userId" = $1) AND title = $2 AND NOT (title = ANY($3::text[]))',
    [snapshot.userId, "QA Onboarding Engineer", snapshot.titles]
  )
}

;(async () => {
  const browser = await chromium.launch({ channel: "chromium", headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" })
  await context.addInitScript(() => {
    window.localStorage.setItem("rolespec-mode", "dark")
    window.localStorage.setItem("rolespec-tour", "skipped")
    window.localStorage.removeItem("rolespec-accent")
    window.localStorage.removeItem("rolespec-preset")
  })
  page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on("console", (message) => {
    if (message.type() === "error") report.console.push({ text: message.text().slice(0, 300), url: page.url() })
  })
  page.on("pageerror", (error) => report.console.push({ type: "pageerror", text: error.message, url: page.url() }))

  const db = new Client({ connectionString: databaseUrl() })
  await db.connect()
  let onboardingSnapshot = null

  try {
    onboardingSnapshot = await snapshotOnboarding(db)
    await prepareOnboarding(db, onboardingSnapshot)

    await check("Onboarding: welcome, validation, seniority and completion", async () => {
      await goto("/onboarding")
      await page.getByRole("heading", { name: /Welcome,/ }).waitFor()
      await page.getByRole("button", { name: "Get started" }).click()
      await page.getByRole("button", { name: "Continue", exact: true }).waitFor()
      await page.getByRole("button", { name: "Continue", exact: true }).click()

      await page.locator("#targetRole").waitFor()
      await page.locator("#targetRole").fill("QA Onboarding Engineer")
      await page.locator("#experienceLevel").selectOption("SENIOR")
      await page.locator("#applicationGoalTarget").fill("0")
      await page.getByRole("button", { name: "Continue", exact: true }).click()
      const alert = page.locator('p[role="alert"]').first()
      await alert.waitFor()
      assert.match(await alert.innerText(), /between 1 and 200/i, "invalid goal was accepted")

      await page.locator("#applicationGoalTarget").fill("3")
      await page.getByRole("button", { name: "Continue", exact: true }).click()
      await page.getByRole("heading", { name: /You.re ready/ }).waitFor()
      // The onboarding shell has no <main> landmark; read the rendered body.
      const summary = await page.locator("body").innerText()
      assert.match(summary, /QA Onboarding Engineer/)
      // The review step names the role but not the seniority; the database
      // assertion below is what proves the level reached the Career Profile.
      await shot("onboarding-ready")
      await page.getByRole("button", { name: /Open RoleSpec/ }).click()
      await page.waitForURL(/\/dashboard/, { timeout: 45000 })

      let profile = null
      for (let i = 0; i < 30; i += 1) {
        profile = (
          await db.query(
            `SELECT pp."onboardedAt", pp."experienceLevel" AS "playerLevel", cp."experienceLevel" AS "careerLevel",
              (SELECT count(*)::int FROM career_target_roles WHERE "careerProfileId" = cp.id AND title = 'QA Onboarding Engineer') AS "roleCount"
             FROM player_profiles pp JOIN career_profiles cp ON cp."userId" = pp."userId" WHERE pp."userId" = $1`,
            [onboardingSnapshot.userId]
          )
        ).rows[0]
        if (profile?.onboardedAt && profile.careerLevel === "SENIOR" && profile.roleCount === 1) break
        await page.waitForTimeout(300)
      }
      assert(profile?.onboardedAt, "onboarding did not stamp onboardedAt")
      assert.equal(profile.careerLevel, "SENIOR", "onboarding seniority did not reach the Career Profile")
      assert.equal(profile.roleCount, 1, "onboarding did not create the target role")

      // A completed account must not be shown the wizard again.
      await goto("/onboarding")
      await page.waitForURL(/\/dashboard/, { timeout: 30000 })
      return { ...profile, role: "QA Onboarding Engineer", completedRedirect: page.url() }
    })

    await restoreOnboarding(db, onboardingSnapshot)
    await check("Onboarding: fixture restoration reopens the unfinished wizard", async () => {
      await goto("/onboarding")
      // The wizard keeps its draft and step in localStorage; that is intended
      // state restoration, so clear it to inspect the restored database state.
      await page.evaluate(() =>
        window.localStorage.removeItem("rolespec-onboarding-draft-v1")
      )
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.getByRole("heading", { name: /Welcome,/ }).waitFor({ timeout: 30000 })
      return "restored player profile has no onboardedAt"
    })

    await check("Career profile: invalid salary is rejected without clearing the edit", async () => {
      await goto("/career-profile?setup=0#preferences")
      const tab = page.getByRole("tab", { name: "Work preferences" })
      if ((await tab.count()) > 0) await tab.click()
      const salary = page.locator("#salaryMin")
      await salary.waitFor()
      const original = await salary.inputValue()
      await salary.fill("not-a-number")
      await page.getByRole("button", { name: "Save preferences" }).click()
      const error = page.locator("p.text-destructive").filter({ hasText: /\S/ }).first()
      await error.waitFor({ timeout: 15000 })
      assert.equal(await salary.inputValue(), "not-a-number", "the rejected value was cleared")
      const text = (await error.innerText()).trim()
      assert(text.length > 0, "the form showed an empty error")
      await shot("career-profile-invalid-salary")
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.locator("#salaryMin").waitFor()
      const restored = await page.locator("#salaryMin").inputValue()
      assert.notEqual(restored, "not-a-number", "invalid edit persisted after reload")
      return { original, error: text.trim(), restored }
    })

    await check("Career paths: groups with keyboard tabs, or the honest sparse-evidence state", async () => {
      await goto("/career-profile?setup=0#career-paths")
      const tab = page.getByRole("tab", { name: "Career paths" })
      if ((await tab.count()) > 0) await tab.click()
      const qualified = page.getByRole("tab", { name: /Qualified now/ })
      if ((await qualified.count()) === 0) {
        const empty = page.getByText("Not enough confirmed evidence yet", { exact: false })
        await empty.waitFor({ timeout: 20000 })
        await shot("career-paths-empty")
        return "honest empty state: the seeded profile has no confirmed career evidence"
      }
      assert.equal(await qualified.getAttribute("aria-selected"), "true")
      assert.equal(await page.getByRole("tab", { name: /Adjacent careers/ }).count(), 1)
      const growth = page.getByRole("tab", { name: /Growth paths/ })
      await growth.focus()
      await page.keyboard.press("ArrowRight")
      await page.waitForTimeout(300)
      const selected = await page.getByRole("tab", { name: /Growth paths/ }).getAttribute("aria-selected")
      await shot("career-paths-groups")
      assert.equal(selected, "true", "ArrowRight did not move the career-path tab")
      return "Qualified / Adjacent / Growth tabs render and respond to arrow keys"
    })

    await check("Saved jobs: malformed minimum-pay URL degrades instead of crashing", async () => {
      await goto("/jobs?paymin=%20&paycur=USD")
      assert.equal(await page.getByRole("heading", { name: "Saved jobs" }).count(), 1)
      const panel = page.getByRole("region", { name: "Filter opportunities" })
      await panel.waitFor()
      const text = await panel.innerText()
      assert.match(text, /eligible/)
      assert.equal(report.console.filter((entry) => entry.type === "pageerror").length, 0)
      await shot("jobs-malformed-pay-url")
      return "rendered with the default floor"
    })

    await check("Filters: a currency no posting uses lands in Needs more info, not below floor", async () => {
      await goto("/jobs")
      const panel = page.getByRole("region", { name: "Filter opportunities" })
      await panel.getByRole("button", { name: /^Filters/ }).click()
      await page.getByLabel("Minimum pay (annual)").fill("1000000")
      await page.getByLabel("Minimum pay currency").selectOption("JPY")
      await page.waitForTimeout(700)
      const text = await panel.innerText()
      const counts = text.match(/(\d+)\s+eligible\s+·\s+(\d+)\s+need more info\s+·\s+(\d+)\s+excluded/)
      assert(counts, `counts missing: ${text}`)
      assert.equal(Number(counts[1]), 0)
      assert.equal(Number(counts[3]), 0)
      assert(Number(counts[2]) > 0, `unknown count is ${counts[2]}`)
      await page.getByText(/Needs more info/).first().waitFor()
      await shot("jobs-unknown-currency")
      return { eligible: Number(counts[1]), unknown: Number(counts[2]), excluded: Number(counts[3]) }
    })

    await check("Currency switch: salary equivalent survives reload and names its rate date", async () => {
      await goto("/settings/preferences")
      const currency = page.locator("#preferredCurrency")
      await currency.waitFor()
      const original = await currency.inputValue()
      // The seeded postings quote USD, so switch to a different supported
      // currency; switching to the current one would render nothing to convert.
      const target = original === "PHP" ? "EUR" : "PHP"
      await currency.selectOption(target)
      await page.getByRole("button", { name: "Save preferences" }).click()
      await page.getByText("Preferences saved", { exact: false }).first().waitFor({ timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(800)
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.locator("#preferredCurrency").waitFor()
      assert.equal(await page.locator("#preferredCurrency").inputValue(), target)

      // Earlier checks left a minimum-pay filter in localStorage; clear it so
      // the equivalent line is not hidden under "Needs more info".
      await page.evaluate(() =>
        window.localStorage.removeItem("rolespec:opportunity-filters:jobs:v1")
      )
      await goto("/jobs")
      const equivalent = page.locator('[data-testid="salary-equivalent"]').first()
      await equivalent.waitFor({ timeout: 20000 })
      const line = (await equivalent.innerText()).replace(/\s+/g, " ")
      assert.match(line, /≈\s.+·\s\d{4}-\d{2}-\d{2}/, `rate date missing from: ${line}`)
      await shot("jobs-usd-equivalent")

      await goto("/settings/preferences")
      await page.locator("#preferredCurrency").selectOption(original)
      await page.getByRole("button", { name: "Save preferences" }).click()
      await page.waitForTimeout(800)
      return { from: original, to: target, equivalent: line.slice(0, 160) }
    })

    await check("Opportunity value: evidence states and excerpts are visible on a job", async () => {
      const job = (
        await db.query(
          `SELECT ja.id FROM job_applications ja JOIN jobs j ON j.id = ja."jobId"
           ORDER BY ja."updatedAt" DESC LIMIT 1`
        )
      ).rows[0]
      assert(job, "no saved job on the fixture")
      await goto(`/jobs/${job.id}#decide`)
      const value = page.getByTestId("opportunity-value")
      await value.waitFor({ timeout: 20000 })
      const text = await value.innerText()
      assert.match(text, /Stated|Uncertain|Unknown/)
      assert.match(text, /“/)
      assert.match(text, /Opportunity value/)
      await shot("job-opportunity-value")
      return { jobId: job.id, signalCount: await page.locator('[data-testid^="opportunity-signal-"]').count() }
    })

    await check("Feedback: a failed write reverts the select and reports the error", async () => {
      await goto("/jobs")
      const select = page.getByLabel(/^Your feedback on /).first()
      await select.waitFor({ timeout: 20000 })
      const label = await select.getAttribute("aria-label")
      let aborted = false
      await page.route("**/jobs", async (route) => {
        if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
          aborted = true
          await route.abort("failed")
          return
        }
        await route.continue()
      })
      await select.selectOption("INTERESTED")
      await page.getByText("Could not save your feedback.", { exact: false }).first().waitFor({ timeout: 15000 })
      await page.waitForTimeout(500)
      assert(aborted, "the server action was not intercepted")
      const current = await page.getByLabel(label).inputValue()
      assert.equal(current, "", "the optimistic verdict did not roll back")
      await page.unroute("**/jobs")
      await shot("feedback-error-recovery")
      return { intercepted: aborted, revertedTo: current }
    })

    await check("Ranking: explanation exposes score factors and is deterministic across reloads", async () => {
      await goto("/dashboard")
      const rank = page.getByRole("button", { name: /^(Rank saved jobs|Refresh ranking)$/ })
      if ((await rank.count()) > 0) await rank.first().click()
      const why = page.getByText("Why this rank?").first()
      await why.waitFor({ timeout: 60000 })
      await why.click()
      const explanation = page.getByText("Ranking score").first().locator("xpath=ancestor::div[1]")
      await explanation.waitFor()
      const first = await page.locator("main").innerText()
      assert.match(first, /Ranking score/i)
      assert.match(first, /Profile fit/)
      await shot("dashboard-ranking-explained")
      const scoreBefore = (first.match(/(\d+)\s*\/\s*100/) || [])[1]
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.getByText("Why this rank?").first().waitFor({ timeout: 60000 })
      const second = await page.locator("main").innerText()
      const scoreAfter = (second.match(/(\d+)\s*\/\s*100/) || [])[1]
      assert.equal(scoreAfter, scoreBefore, "the ranking score changed on reload")
      return { score: scoreBefore }
    })

    const application = (
      await db.query(
        `SELECT ja.id, j.title FROM job_applications ja
         JOIN jobs j ON j.id = ja."jobId" ORDER BY ja."updatedAt" DESC LIMIT 1`
      )
    ).rows[0]
    await check("ATS preparation and tracking: tabs, preparation tools and source posting render", async () => {
      assert(application, "no saved application on the fixture")
      await goto(`/jobs/${application.id}#prepare`)
      assert.equal(await page.getByRole("tab", { name: "Prepare" }).count(), 1)
      await page.getByRole("tab", { name: "Prepare" }).click()
      await page.getByText("Apply with the agent", { exact: false }).first().waitFor({ timeout: 20000 })
      const body = await page.locator("main").innerText()
      assert.match(body, /Agent-assisted|Manual/)
      await page.getByRole("tab", { name: "Track" }).click()
      await page.waitForTimeout(400)
      assert.equal(await page.getByRole("tab", { name: "Track" }).getAttribute("aria-selected"), "true")
      await page.getByRole("tab", { name: "Posting" }).click()
      await page.waitForTimeout(400)
      await shot("job-detail-tabs")
      return { applicationId: application.id, title: application.title }
    })

    await check("Workspace tracking: list or explicit empty state, no crash", async () => {
      await goto("/workspace?view=tracking")
      assert.equal(await page.getByRole("heading", { name: "Workspace" }).count(), 1)
      const body = await page.locator("main").innerText()
      assert.match(body, /Prepared applications|Staging & follow-ups|Follow-ups|No staged attempts/i)
      await shot("workspace-tracking")
      return body.slice(0, 200)
    })

    const pageErrors = report.console.filter((entry) => entry.type === "pageerror")
    await check("No uncaught page errors during the journeys", async () => {
      assert.equal(pageErrors.length, 0, pageErrors.map((entry) => entry.text).join("\n"))
      return { consoleErrors: report.console.length }
    })
  } finally {
    if (onboardingSnapshot) {
      await restoreOnboarding(db, onboardingSnapshot).catch((error) => {
        report.limitations.push(`onboarding restore failed: ${error.message}`)
      })
    }
    await db.end()
    report.finishedAt = new Date().toISOString()
    save()
    await browser.close()
  }

  console.log(
    JSON.stringify(
      { checks: report.checks.length, failures: report.failures, limitations: report.limitations, console: report.console.slice(0, 5) },
      null,
      2
    )
  )
  if (report.failures.length > 0) process.exitCode = 1
})()
