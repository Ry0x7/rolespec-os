// @vitest-environment node
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(process.cwd(), "src")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full)
  }
  return out
}

/**
 * The packaged Windows app runs PostgreSQL locally and has no Redis or Convex
 * service. Intake must stay a PostgreSQL + Next.js subsystem; this guard fails
 * the build if a future adapter imports infrastructure the desktop cannot run.
 */
describe("intake desktop compatibility", () => {
  it("does not import an external queue, cache or hosted backend", () => {
    const banned = [
      /from\s+["']convex\//,
      /from\s+["']ioredis["']/,
      /from\s+["']redis["']/,
      /from\s+["']bullmq["']/,
      /from\s+["']@upstash\/redis["']/,
      /from\s+["']amqplib["']/,
    ]
    const files = [
      ...sourceFiles(join(ROOT, "features", "intake")),
      ...sourceFiles(join(ROOT, "app", "api", "intake")),
    ].filter((file) => !file.includes("__tests__"))

    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(file, "utf8")
      if (banned.some((pattern) => pattern.test(text))) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it("uses PostgreSQL/Prisma for run state rather than an in-memory queue singleton", () => {
    const runService = readFileSync(
      join(ROOT, "features", "intake", "services", "intake-run.service.ts"),
      "utf8"
    )
    expect(runService).toContain("@/shared/lib/prisma")
    expect(runService).not.toContain("new Queue(")
  })
})
