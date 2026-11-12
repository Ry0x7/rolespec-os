#!/usr/bin/env node
/**
 * Gate verifier for the Recruitt feature-parity documentation set.
 *
 * Usage: node scripts/verify-parity-docs.mjs G1
 *
 * Every check reads the committed-ish artifacts in docs/ and the real route
 * tree in src/app/api. It prints a success-only marker and exits 0 only when
 * every assertion for that gate passes; otherwise it prints each failure and
 * exits 1.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const root = process.cwd()
const docs = join(root, "docs")
const gate = process.argv[2]

function read(name) {
  const path = join(docs, name)
  if (!existsSync(path)) throw new Error(`missing ${name}`)
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n")
}

const DOCS = {
  parity: "FEATURE_PARITY.md",
  arch: "ARCHITECTURE.md",
  plan: "IMPLEMENTATION_PLAN.md",
  api: "API_CONTRACTS.md",
  states: "WORKFLOW_STATES.md",
  research: "RESEARCH.md",
}

const failures = []
function ok(condition, message) {
  if (!condition) failures.push(message)
}
function has(text, needle) {
  ok(text.includes(needle), `missing text: ${needle}`)
}

function collectFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collectFiles(full))
    else if (entry === "route.ts") out.push(full)
  }
  return out
}

function routePath(file) {
  let rel = file.slice(join(root, "src/app/api").length).replace(/\\/g, "/")
  rel = rel.replace(/\/route\.ts$/, "")
  rel = rel.replace(/\[\.\.\.([^\]]+)\]/g, "*")
  rel = rel.replace(/\[([^\]]+)\]/g, ":$1")
  return `/api${rel}`
}

const REQUIRED = {
  parity: [
    "# Feature Parity: Recruitt → RoleSpec OS",
    "## Status legend",
    "## Feature matrix",
    "## Recruitt roadmap (not parity requirements)",
    "## Evidence and audit method",
    "## Audit limits",
  ],
  arch: [
    "# Architecture",
    "## Runtime and code layout",
    "## Target architecture",
    "## End-to-end data flow",
    "## Data model additions",
    "## Execution model",
    "## Security and privacy boundaries",
    "## Sources of truth",
  ],
  plan: [
    "# Implementation plan",
    "## Dependency order",
    "## Coverage map",
    "## Test requirements",
    "## Next-phase instructions",
  ],
  api: ["# API contracts", "## Conventions", "## Existing routes", "## New routes", "## Error envelope", "## Idempotency"],
  states: [
    "# Workflow states",
    "## Entities",
    "## Application workflow",
    "## Agent run",
    "## Review task",
    "## Submission",
    "## Follow-up",
    "## Invariants",
  ],
  research: ["# Research", "## Recruitt: demonstrated vs roadmap", "## Technical references", "## Decisions"],
}

const FEATURE_IDS = Array.from({ length: 59 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`)

const REQUIRED_STATUS = {
  // The unified intake implementation is delivered; these rows must stay
  // Implemented so a later doc edit cannot quietly regress the audit.
  F01: ["Implemented"],
  F02: ["Implemented"],
  F03: ["Implemented"],
  F04: ["Implemented"],
  F05: ["Implemented"],
  F06: ["Implemented"],
  F07: ["Implemented"],
  F08: ["Implemented"],
  F09: ["Implemented"],
  F13: ["Implemented"],
  F14: ["Implemented"],
  // Backend complete, first-party leaderboard UI still absent.
  F15: ["Partial"],
  F22: ["Implemented"],
  F25: ["Implemented"],
  F30: ["Implemented"],
  F31: ["Implemented"],
  F32: ["Implemented"],
  F33: ["Implemented"],
  // Attachment works from fixtures; a live employer page was not filled.
  F34: ["Partial"],
  F35: ["Implemented"],
  // Extension queue only; no web review screen.
  F37: ["Partial"],
  F38: ["Implemented"],
  F41: ["Implemented"],
  F42: ["Implemented"],
  F44: ["Implemented"],
  F45: ["Implemented"],
  // Backend complete, dashboard leaderboard still absent.
  F46: ["Partial"],
  F49: ["Not ported"],
  F50: ["Not ported"],
  F53: ["Implemented"],
  F55: ["Partial"],
  F57: ["Roadmap-only", "Not ported"],
  F60: ["Missing"],
}

const STATUSES = new Set(["Implemented", "Partial", "Missing", "Not ported", "Roadmap-only"])

function parityRows(text) {
  const rows = new Map()
  for (const line of text.split("\n")) {
    if (!line.startsWith("| F")) continue
    const cells = line.split("|").map((cell) => cell.trim())
    // '', id, feature, status, evidence, gap, ''
    if (cells.length < 6) continue
    const id = cells[1]
    if (!/^F\d{2}$/.test(id)) continue
    rows.set(id, { status: cells[3].replace(/\*/g, ""), evidence: cells[4], gap: cells[5] })
  }
  return rows
}

const CHECKS = {
  G1() {
    for (const [key, headings] of Object.entries(REQUIRED)) {
      const text = read(DOCS[key])
      for (const heading of headings) has(text, heading)
      ok(text.length > 1200, `${DOCS[key]} is too short to be substantive`)
    }
    for (const phase of ["P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]) {
      has(read(DOCS.plan), `## Phase ${phase}`)
    }
  },

  G2() {
    const text = read(DOCS.parity)
    const rows = parityRows(text)
    for (const id of FEATURE_IDS) ok(rows.has(id), `feature matrix missing row ${id}`)
    for (const [id, row] of rows) {
      ok(STATUSES.has(row.status), `${id} has unknown status "${row.status}"`)
      ok(row.evidence.length > 3, `${id} has no evidence`)
      ok(row.gap.length > 3, `${id} has no gap/next column`)
    }
    for (const [id, allowed] of Object.entries(REQUIRED_STATUS)) {
      const row = rows.get(id)
      if (!row) continue
      ok(allowed.includes(row.status), `${id} must be ${allowed.join("/")} (found ${row.status})`)
    }
    // Safety invariants are the rows that must never regress to a weaker label.
    for (const id of ["F24", "F51", "F52", "F53", "F36"]) {
      const row = rows.get(id)
      if (row) ok(row.status === "Implemented", `${id} safety invariant must stay Implemented`)
    }
    // The two intentionally unclosed gaps must stay visible, not be papered over.
    for (const id of ["F49", "F50", "F60"]) {
      const row = rows.get(id)
      if (row) ok(row.status !== "Implemented", `${id} must not claim parity`)
    }
  },

  G3() {
    const text = read(DOCS.parity)
    const rows = parityRows(text)
    const dirs = ["src/", "prisma/", "extension/", "scripts/", "docs/", "desktop/"]
    let cited = 0
    for (const [id, row] of rows) {
      const tokens = row.evidence.match(/`([^`]+)`/g) ?? []
      for (const raw of tokens) {
        const token = raw.slice(1, -1).split("#")[0].trim()
        if (!dirs.some((dir) => token.startsWith(dir))) continue
        if (token.includes("*")) continue
        cited += 1
        ok(existsSync(join(root, token)), `${id} cites a path that does not exist: ${token}`)
      }
    }
    ok(cited >= 40, `expected at least 40 grounded path citations, found ${cited}`)
  },

  G4() {
    const text = read(DOCS.arch)
    for (const needle of [
      "WorkflowRun",
      "WorkflowStep",
      "ReviewTask",
      "SubmissionAttempt",
      "ApprovedAnswer",
      "FOR UPDATE SKIP LOCKED",
      "BM25",
      "pg_search",
      "Redis",
      "Convex",
      "single-owner",
      "in-process",
      "Tauri",
      "PostgreSQL",
    ]) {
      has(text, needle)
    }
    has(text, "Intake → Profile → Discover → Rank → Research → Tailor → Autofill → Review → Submission staging → Track → Follow up")
    has(text, "No new infrastructure service")
  },

  G5() {
    const text = read(DOCS.api)
    const files = collectFiles(join(root, "src/app/api"))
    const routes = [...new Set(files.map(routePath))].sort()
    ok(routes.length >= 15, `expected at least 15 existing API routes, found ${routes.length}`)
    for (const route of routes) has(text, route)
    for (const route of [
      "/api/workflows",
      "/api/workflows/:id",
      "/api/workflows/:id/advance",
      "/api/review-tasks",
      "/api/review-tasks/:id",
      "/api/answers",
      "/api/submissions",
      "/api/intake",
      "/api/ranking",
    ]) {
      has(text, route)
    }
  },

  G6() {
    const text = read(DOCS.states)
    for (const state of ["MANUAL", "ASSISTED", "PAUSED", "FAILED", "AWAITING_REVIEW", "COMPLETED", "CANCELLED"]) {
      ok(text.includes(state), `missing state ${state}`)
    }
    for (const pair of [
      "MANUAL → ASSISTED",
      "MANUAL → COMPLETED",
      "ASSISTED → AWAITING_REVIEW",
      "AWAITING_REVIEW → ASSISTED",
      "AWAITING_REVIEW → PAUSED",
      "ASSISTED → PAUSED",
      "PAUSED → ASSISTED",
      "ASSISTED → FAILED",
      "PAUSED → AWAITING_REVIEW",
      "FAILED → ASSISTED",
      "ASSISTED → COMPLETED",
      "COMPLETED → ASSISTED",
    ]) {
      ok(text.includes(pair), `missing transition ${pair}`)
    }
    has(text, "COMPLETED is terminal for the attempt")
    has(text, "No transition may write a submission")
  },

  G7() {
    const text = read(DOCS.research)
    const urls = text.match(/https:\/\/[^\s)>\]]+/g) ?? []
    ok(urls.length >= 18, `expected at least 18 source URLs, found ${urls.length}`)
    for (const needle of [
      "k1 = 1.2",
      "b = 0.75",
      "ASVS 5.0.0",
      "LLM06:2025",
      "Chrome 114",
      "Prisma 7",
      "pg-boss",
      "Graphile Worker",
      "SKIP LOCKED",
      "ParadeDB",
      "Greenhouse",
      "Lever",
      "Ashby",
    ]) {
      has(text, needle)
    }
    const decisions = (text.match(/\*\*Decision:\*\*/g) ?? []).length
    ok(decisions >= 10, `expected at least 10 explicit decisions, found ${decisions}`)
  },

  G8() {
    const plan = read(DOCS.plan)
    let last = -1
    for (const phase of ["P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]) {
      const index = plan.indexOf(`## Phase ${phase}`)
      ok(index > last, `phase ${phase} missing or out of order`)
      last = index
      const section = plan.slice(index, plan.indexOf("\n## Phase ", index + 1) === -1 ? plan.length : plan.indexOf("\n## Phase ", index + 1))
      has(section, "**Files:**")
      has(section, "**Tests:**")
      has(section, "**Exit criteria:**")
    }
    const parity = parityRows(read(DOCS.parity))
    for (const [id, row] of parity) {
      if (["Implemented", "Not ported", "Roadmap-only"].includes(row.status)) continue
      ok(plan.includes(id), `plan does not cover non-implemented feature ${id}`)
    }
  },

  G9() {
    for (const name of Object.values(DOCS)) {
      const text = read(name)
      for (const [label, pattern] of [
        ["local user path", /C:\\Users|C:\/Users/],
        ["API key", /\bsk-[A-Za-z0-9_-]{16,}/],
        ["connection string", /postgres(?:ql)?:\/\/[^\s]*@/],
        ["private key", /BEGIN (?:RSA |EC )?PRIVATE KEY/],
        ["bearer token", /Bearer rspec_[A-Za-z0-9]/],
        ["GitHub token", /ghp_[A-Za-z0-9]{20,}/],
      ]) {
        ok(!pattern.test(text), `${name} contains a ${label}`)
      }
    }
  },

  G10() {
    for (const name of Object.values(DOCS)) {
      const text = read(name)
      for (const match of text.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)) {
        const target = resolve(docs, match[1])
        ok(existsSync(target), `${name} links to missing document ${match[1]}`)
      }
    }
    const readme = readFileSync(join(root, "README.md"), "utf8")
    for (const match of readme.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)) {
      const target = resolve(root, match[1])
      ok(existsSync(target), `README links to missing document ${match[1]}`)
    }
  },

  G11() {
    const files = [
      "src/features/workflows/types.ts",
      "src/features/workflows/pipeline.ts",
      "src/features/workflows/services/workflow.service.ts",
      "src/features/workflows/services/workflow-worker.ts",
      "src/features/workflows/services/schedule.ts",
      "src/features/workflows/executors/index.ts",
      "src/features/workflows/executors/profile.executor.ts",
      "src/features/workflows/executors/discovery.executor.ts",
      "src/features/workflows/executors/rank.executor.ts",
      "src/features/workflows/executors/research.executor.ts",
      "src/features/workflows/executors/tailor.executor.ts",
      "src/features/workflows/executors/validate.executor.ts",
      "src/features/workflows/executors/prepare-ats.executor.ts",
      "src/features/workflows/executors/human-review.executor.ts",
      "src/features/workflows/executors/staging.executor.ts",
      "src/features/workflows/executors/tracking.executor.ts",
      "src/features/workflows/executors/follow-up.executor.ts",
      "src/app/api/workflows/route.ts",
      "src/app/api/workflows/[id]/route.ts",
      "src/app/api/workflows/[id]/advance/route.ts",
      "src/app/api/workflows/[id]/events/route.ts",
      "src/app/api/workflows/[id]/stream/route.ts",
      "src/app/api/review-tasks/route.ts",
      "src/app/api/review-tasks/[id]/route.ts",
      "src/instrumentation.ts",
      "prisma/migrations/20261111170000_add_workflow_runs/migration.sql",
      "src/features/workflows/__tests__/workflow-engine.test.ts",
      "src/app/api/workflows/__tests__/route.test.ts",
    ]
    for (const file of files) ok(existsSync(join(root, file)), `missing workflow file ${file}`)

    const api = read(DOCS.api)
    for (const route of [
      "/api/workflows/:id/events",
      "/api/workflows/:id/stream",
      "/api/review-tasks/:id",
    ]) {
      has(api, route)
    }
    for (const needle of ["COMPLETE_STEP", "approved: true", "AWAITING_REVIEW", "SSE"]) {
      has(api, needle)
    }

    const states = read(DOCS.states)
    for (const status of [
      "PENDING",
      "RUNNING",
      "WAITING_FOR_USER",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "SKIPPED",
    ]) {
      has(states, `\`${status}\``)
    }
    for (const needle of [
      "Worker semantics (implemented)",
      "expired lease",
      "refunds the interrupted attempt",
      "COMPLETE_STEP",
    ]) {
      has(states, needle)
    }

    const arch = read(DOCS.arch)
    for (const needle of [
      "Workflow engine (implemented)",
      "src/features/workflows/executors",
      "leaseOwner",
      "leaseExpiresAt",
      "WorkflowEvent",
    ]) {
      has(arch, needle)
    }

    const parity = parityRows(read(DOCS.parity))
    for (const id of ["F24", "F35", "F37", "F38", "F40", "F53"]) {
      const row = parity.get(id)
      ok(row && /workflow/i.test(row.evidence), `${id} does not cite workflow evidence`)
    }
  },
}

if (!gate || !CHECKS[gate]) {
  console.error(`usage: node scripts/verify-parity-docs.mjs <${Object.keys(CHECKS).join("|")}>`)
  process.exit(2)
}

try {
  CHECKS[gate]()
} catch (error) {
  failures.push(String(error && error.message ? error.message : error))
}

if (failures.length > 0) {
  console.error(`${gate} FAILED (${failures.length})`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`PARITY-DOCS-${gate}-PASS`)
