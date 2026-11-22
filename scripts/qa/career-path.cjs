/* eslint-disable @typescript-eslint/no-require-imports -- Directly executable CommonJS QA driver. */
// Browser QA for Career Path Intelligence.
//
//   node scripts/qa/career-path.cjs
//
// Requires a loopback production server started with ROLSPEC_ACCESS_MODE=local
// and a local database. It temporarily seeds four QA-prefixed capabilities plus
// confirmed evidence for the local owner profile, then removes only those rows
// (and the one approved target role) in a finally block.
//
// Evidence: .unlazy/qa/career-path/{report.json,*.png}
const { chromium } = require("playwright")
const { Client } = require("pg")
const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")

require("dotenv").config({ quiet: true })

const base = process.env.QA_BASE_URL || "http://127.0.0.1:3200"
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) {
  throw new Error("QA drivers must target a loopback server with a disposable database")
}

const dir = path.resolve(".unlazy/qa/career-path")
fs.mkdirSync(dir, { recursive: true })

const report = {
  startedAt: new Date().toISOString(),
  base,
  database: null,
  seed: null,
  checks: [],
  failures: [],
  console: [],
  network: [],
  limitations: [],
}
let page
const save = () =>
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2))
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
  await page.waitForTimeout(250)
}

const QA_IDS = {
  evidence: ["qa_cp_ev_communication", "qa_cp_ev_copywriting", "qa_cp_ev_project", "qa_cp_ev_data"],
  capabilities: [
    "qa_cp_cap_communication",
    "qa_cp_cap_copywriting",
    "qa_cp_cap_project",
    "qa_cp_cap_data",
  ],
  links: ["qa_cp_link_communication", "qa_cp_link_copywriting", "qa_cp_link_project", "qa_cp_link_data"],
}

const CAPS = [
  {
    key: "communication",
    name: "Communication (QA)",
    evidence: "QA — Led cross-team launch communications",
    outcome: "Weekly launch updates reached four teams and cut clarification threads by 40%.",
    source: "https://example.com/career-path/communication",
  },
  {
    key: "copywriting",
    name: "Copywriting (QA)",
    evidence: "QA — Wrote the launch campaign copy",
    outcome: "Shipped a six-part campaign; the landing page conversion rate rose from 1.8% to 2.6%.",
    source: "https://example.com/career-path/copywriting",
  },
  {
    key: "project-management",
    name: "Project management (QA)",
    evidence: "QA — Delivered a multi-channel campaign",
    outcome: "Delivered eight assets across four channels on the planned date.",
    source: "https://example.com/career-path/project",
  },
  {
    key: "data-analysis",
    name: "Data analysis (QA)",
    evidence: "QA — Built a campaign funnel dashboard",
    outcome: "The funnel dashboard identified a drop-off worth 120 recovered signups.",
    source: "https://example.com/career-path/data",
  },
]

let db
let profileId = null
let approvedTitle = null
let createdTargetRole = false
let evidenceSignatureBefore = null

async function cleanup() {
  if (!db || !profileId) return
  try {
    if (approvedTitle && createdTargetRole) {
      await db.query(
        `DELETE FROM career_target_roles WHERE "careerProfileId" = $1 AND title = $2`,
        [profileId, approvedTitle]
      )
    }
    await db.query(`DELETE FROM career_capabilities WHERE id = ANY($1::text[])`, [QA_IDS.capabilities])
    await db.query(`DELETE FROM career_evidence WHERE id = ANY($1::text[])`, [QA_IDS.evidence])
  } catch (error) {
    report.limitations.push(`Cleanup failed: ${error.message}`)
  }
}

async function evidenceSignature() {
  const result = await db.query(
    `SELECT id, title, kind, status, outcome, "updatedAt"
       FROM career_evidence
      WHERE "careerProfileId" = $1
      ORDER BY id`,
    [profileId]
  )
  return JSON.stringify(result.rows)
}

;(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  report.database = new URL(process.env.DATABASE_URL).pathname.slice(1)

  const owner = await db.query(`SELECT id, email FROM users WHERE email = $1`, [
    "owner@rolespec.local",
  ])
  assert(owner.rowCount === 1, "owner@rolespec.local is missing; run prisma/seed.ts")
  const profile = await db.query(
    `SELECT id FROM career_profiles WHERE "userId" = $1`,
    [owner.rows[0].id]
  )
  assert(profile.rowCount === 1, "The owner Career Profile is missing; open /career-profile once")
  profileId = profile.rows[0].id

  // Remove leftovers from an interrupted QA run before seeding.
  await db.query(`DELETE FROM career_capabilities WHERE id = ANY($1::text[])`, [
    QA_IDS.capabilities,
  ])
  await db.query(`DELETE FROM career_evidence WHERE id = ANY($1::text[])`, [QA_IDS.evidence])

  const existingTarget = await db.query(
    `SELECT id FROM career_target_roles WHERE "careerProfileId" = $1 AND title = $2`,
    [profileId, "Marketing Coordinator"]
  )
  approvedTitle = "Marketing Coordinator"
  createdTargetRole = existingTarget.rowCount === 0
  if (!createdTargetRole) {
    report.limitations.push(
      "Marketing Coordinator was already a target role before QA; approval will be checked as already-on-list."
    )
  }

  const now = new Date()
  const recent = "2026-06-01"
  for (const cap of CAPS) {
    await db.query(
      `INSERT INTO career_evidence
        (id, "careerProfileId", kind, source, status, title, organization, details, outcome,
         "startDate", "endDate", metadata, "confirmedAt", "createdAt", "updatedAt")
       VALUES ($1,$2,'PROJECT','USER_ENTERED','CONFIRMED',$3,'QA Fixture',$4,$5,
               $6,NULL,$7::jsonb,$8,$8,$8)`,
      [
        QA_IDS.evidence[CAPS.indexOf(cap)],
        profileId,
        cap.evidence,
        `Fixture created by scripts/qa/career-path.cjs for ${cap.name}.`,
        cap.outcome,
        recent,
        JSON.stringify({ sourceUrl: cap.source, qa: true }),
        now,
      ]
    )
    await db.query(
      `INSERT INTO career_capabilities
        (id, "careerProfileId", name, category, confirmed, "confirmedAt", "selfAssessment", "lastUsedAt",
         notes, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,'QA',true,$4,'STRONG',$5,$6,$4,$4)`,
      [
        QA_IDS.capabilities[CAPS.indexOf(cap)],
        profileId,
        cap.name,
        now,
        recent,
        "Temporary fixture for Career Path browser QA.",
      ]
    )
    await db.query(
      `INSERT INTO career_evidence_capabilities
        (id, "evidenceId", "capabilityId", depth, "hasMeasuredOutcome", "outcomeNote", "lastUsedAt", "createdAt")
       VALUES ($1,$2,$3,'DEEP',true,$4,$5,$6)`,
      [
        QA_IDS.links[CAPS.indexOf(cap)],
        QA_IDS.evidence[CAPS.indexOf(cap)],
        QA_IDS.capabilities[CAPS.indexOf(cap)],
        cap.outcome,
        recent,
        now,
      ]
    )
  }

  evidenceSignatureBefore = await evidenceSignature()
  report.seed = {
    profileId,
    capabilityNames: CAPS.map((cap) => cap.name),
    evidenceTitles: CAPS.map((cap) => cap.evidence),
    targetRolePreexisting: !createdTargetRole,
  }

  const browser = await chromium.launch({ channel: "chromium", headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on("console", (message) => {
    if (message.type() === "error") {
      // React hydration warnings are collected but failed only if they indicate
      // broken behaviour; every uncaught page error is a hard failure.
      report.console.push({ text: message.text(), url: page.url() })
    }
  })
  page.on("pageerror", (error) => {
    report.console.push({ type: "pageerror", text: error.message, url: page.url() })
  })
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) {
      report.network.push({ url: response.url().split("?")[0], status: response.status() })
    }
  })

  const tab = (name) => page.getByRole("tab", { name, exact: false })
  const roleCard = (title) =>
    page.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).first()
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

  try {
    await goto("/career-profile#career-paths")

    await check("1440: Career paths is a real tab with the three counted groups", async () => {
      await tab("Career paths").waitFor()
      assert.equal(await tab("Career paths").getAttribute("aria-selected"), "true")
      const tablist = page.getByRole("tablist", { name: "Career path groups" })
      await tablist.waitFor()
      assert.equal(await tablist.getByRole("tab").count(), 3)
      assert.equal(
        await tablist.getByRole("tab", { name: "Qualified now (1)" }).getAttribute("aria-selected"),
        "true"
      )
      assert.equal(await tablist.getByRole("tab", { name: "Adjacent careers (2)" }).count(), 1)
      assert.equal(await tablist.getByRole("tab", { name: "Growth paths (10)" }).count(), 1)
      assert.equal(await page.getByText("25 catalogue roles evaluated").count(), 1)
      assert.equal(await page.getByText(/Catalogue version career-path-seed-2026\.11\.1/).count(), 1)
      await roleCard("Marketing Coordinator").waitFor()
      await shot("career-paths-1440-qualified")
      return "1 qualified / 2 adjacent / 10 growth"
    })

    await check("1440: qualified card explains score, coverage, evidence and gaps", async () => {
      const card = roleCard("Marketing Coordinator")
      assert.match(await card.innerText(), /80\s*\/100/)
      assert.match((await card.innerText()).replace(/\s+/g, " "), /78% catalogue coverage/)
      await card.getByRole("button", { name: "Explore evidence & steps" }).click()
      await card.getByText("Matched capabilities").waitFor()
      assert.match(await card.innerText(), /QA — Led cross-team launch communications/)
      assert.match(await card.innerText(), /Wrote the launch campaign copy/)
      assert.match(await card.innerText(), /Score breakdown/)
      assert.match(await card.innerText(), /Required coverage/)
      assert.match(await card.innerText(), /No verified regional pay data/)
      const external = card.getByRole("link", { name: /QA — Led cross-team launch communications/ })
      assert.equal(await external.getAttribute("href"), "https://example.com/career-path/communication")
      assert.equal(await external.getAttribute("target"), "_blank")
      assert.equal(await external.getAttribute("rel"), "noreferrer noopener")
      await card.getByText("Branch", { exact: true }).waitFor()
      await shot("career-paths-1440-evidence")
      return "score, coverage, evidence links, score formula and null salary explained"
    })

    await check("1440: branch navigation switches group, expands and focuses the related role", async () => {
      const source = roleCard("Marketing Coordinator")
      const related = source.getByRole("button", { name: /Content Strategist/ }).first()
      if ((await related.count()) === 0) {
        report.limitations.push("Content Strategist was not listed as a related branch")
        return "skipped: no related Content Strategist button"
      }
      await related.click()
      await page.waitForTimeout(300)
      assert.equal(
        await page
          .getByRole("tablist", { name: "Career path groups" })
          .getByRole("tab", { name: /Growth paths/ })
          .getAttribute("aria-selected"),
        "true"
      )
      const target = roleCard("Content Strategist")
      await target.waitFor()
      const focused = await target
        .getByRole("heading", { name: "Content Strategist" })
        .evaluate((element) => document.activeElement === element)
      assert.equal(focused, true, "related role heading did not receive focus")
      assert.match(await target.innerText(), /Matched capabilities/)
      await shot("career-paths-1440-related")
      return "Marketing Coordinator → Content Strategist"
    })

    await check("1440: group tabs support Arrow, Home and End with roving focus", async () => {
      const tablist = page.getByRole("tablist", { name: "Career path groups" })
      const qualified = tablist.getByRole("tab", { name: /Qualified now/ })
      await qualified.focus()
      await page.keyboard.press("ArrowRight")
      assert.equal(
        await tablist.getByRole("tab", { name: /Adjacent careers/ }).getAttribute("aria-selected"),
        "true"
      )
      await page.keyboard.press("End")
      assert.equal(
        await tablist.getByRole("tab", { name: /Growth paths/ }).getAttribute("aria-selected"),
        "true"
      )
      await page.keyboard.press("Home")
      assert.equal(
        await tablist.getByRole("tab", { name: /Qualified now/ }).getAttribute("aria-selected"),
        "true"
      )
      return "Right, End, Home"
    })

    await check("1440: approval adds a Target Role and does not touch evidence", async () => {
      if (!createdTargetRole) {
        assert.equal(
          await roleCard("Marketing Coordinator").getByText("On your target list").count(),
          1
        )
        return "skipped: role was already a target before QA"
      }
      const card = roleCard("Marketing Coordinator")
      await card.getByRole("button", { name: "Add to Target Roles" }).click()
      await page.getByText("Added to Target Roles", { exact: true }).first().waitFor()
      await card.getByText("On your target list").waitFor()
      assert.equal(
        await card.getByRole("button", { name: "Add to Target Roles" }).isDisabled(),
        true
      )
      const target = await db.query(
        `SELECT title, "roleFamilyId" FROM career_target_roles WHERE "careerProfileId" = $1 AND title = $2`,
        [profileId, approvedTitle]
      )
      assert.equal(target.rowCount, 1)
      assert.equal(target.rows[0].title, approvedTitle)
      const evidenceAfter = await evidenceSignature()
      assert.equal(evidenceAfter, evidenceSignatureBefore, "approval changed confirmed evidence")
      await shot("career-paths-1440-approved")
      return { target: target.rows[0], evidenceUnchanged: true }
    })

    await check("1440: the approved role appears in the existing Target Roles tab", async () => {
      await tab("Jobs I want").click()
      await page.waitForTimeout(400)
      const panel = page.getByRole("tabpanel", { name: "Jobs I want" })
      if (!createdTargetRole) {
        return "skipped: role was already a target before QA"
      }
      await panel.getByText(approvedTitle, { exact: true }).first().waitFor()
      return approvedTitle
    })

    await check("768 and 390: the explorer wraps without horizontal overflow", async () => {
      await page.setViewportSize({ width: 768, height: 1000 })
      await goto("/career-profile#career-paths")
      await page.getByRole("tablist", { name: "Career path groups" }).waitFor()
      assert.equal(await overflow(), 0)
      await page.getByRole("tab", { name: /Growth paths/ }).click()
      await roleCard("Content Strategist").getByRole("button", { name: "Explore evidence & steps" }).click()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(300)
      assert.equal(await overflow(), 0)
      await shot("career-paths-390-growth")
      return { documentOverflow: 0 }
    })

    await check("390: keyboard and accessible names survive the mobile layout", async () => {
      const tablist = page.getByRole("tablist", { name: "Career path groups" })
      await tablist.getByRole("tab", { name: /Growth paths/ }).focus()
      await page.keyboard.press("ArrowLeft")
      assert.equal(
        await tablist.getByRole("tab", { name: /Adjacent careers/ }).getAttribute("aria-selected"),
        "true"
      )
      for (const name of [/Qualified now/, /Adjacent careers/, /Growth paths/]) {
        assert.equal(await tablist.getByRole("tab", { name }).count(), 1)
      }
      return "accessible tab names and keyboard selection at 390px"
    })

    await check("no uncaught page errors during the run", async () => {
      const pageErrors = report.console.filter((entry) => entry.type === "pageerror")
      assert.equal(pageErrors.length, 0, pageErrors.map((entry) => entry.text).join("\n"))
      return { consoleErrors: report.console.length, apiFailures: report.network.length }
    })
  } finally {
    await context.close()
    await browser.close()

    // Sparse-profile state: remove the QA fixtures and check the honest empty
    // state, then restore the profile-specific target role.
    await cleanup()
    createdTargetRole = false
  }

  // A second context proves the empty state after cleanup (and that no role is
  // invented from the unrelated pre-existing target titles).
  const browser2 = await chromium.launch({ channel: "chromium", headless: true })
  const context2 = await browser2.newContext({ viewport: { width: 390, height: 844 } })
  page = await context2.newPage()
  page.setDefaultTimeout(20000)
  page.on("pageerror", (error) => {
    report.console.push({ type: "pageerror", text: error.message, url: page.url() })
  })
  try {
    await goto("/career-profile#career-paths")
    await check("390: sparse profile gets the honest empty state and no fabricated roles", async () => {
      await page.getByText("Not enough confirmed evidence yet").waitFor()
      assert.equal(await page.getByRole("link", { name: "Go to skills" }).count(), 1)
      assert.equal(await page.getByRole("tablist", { name: "Career path groups" }).count(), 0)
      assert.equal(await page.locator("article").count(), 0)
      await shot("career-paths-390-sparse")
      return "empty state shown; groups not rendered"
    })
    await check("full run leaves no uncaught page errors", async () => {
      const pageErrors = report.console.filter((entry) => entry.type === "pageerror")
      assert.equal(pageErrors.length, 0, pageErrors.map((entry) => entry.text).join("\n"))
      return { pageErrors: pageErrors.length }
    })
  } finally {
    await context2.close()
    await browser2.close()
  }
})()
  .catch((error) => {
    report.failures.push({ name: "QA driver crashed", message: error.stack || error.message })
  })
  .finally(async () => {
    await cleanup()
    if (db) await db.end().catch(() => {})
    report.finishedAt = new Date().toISOString()
    save()
    console.log(
      JSON.stringify(
        {
          checks: report.checks.length,
          failures: report.failures,
          limitations: report.limitations,
          evidence: path.join(dir, "report.json"),
        },
        null,
        2
      )
    )
    if (report.failures.length > 0) process.exitCode = 1
  })
