/**
 * Maintenance: re-derives `Job.canonicalUrl` from `Job.url` with the current
 * canonicalizer.
 *
 * Rows written before a canonicalizer change keep the key they were saved with,
 * so a link that normalizes differently today no longer dedupes against them —
 * which is how one posting ends up tracked twice. This recomputes the key.
 *
 * It only ever writes `canonicalUrl`. It never touches `url`, the title, the
 * status or anything else, never deletes a row, and never merges two postings:
 * where two of a user's jobs would end up on the same key it reports a
 * collision and leaves both rows exactly as they are, because deciding which of
 * two tracked applications survives is the user's call, not a script's.
 *
 * Usage:
 *   npx tsx scripts/backfill-canonical-urls.ts            # dry run (default)
 *   npx tsx scripts/backfill-canonical-urls.ts --dry-run  # explicit
 *   npx tsx scripts/backfill-canonical-urls.ts --apply    # writes
 */
import "dotenv/config"

import { prisma } from "@/shared/lib/prisma"
import { canonicalizeUrl } from "@/features/discovery/services/normalize.service"

interface PlannedUpdate {
  jobId: string
  userId: string
  title: string
  from: string | null
  to: string | null
}

interface Collision {
  userId: string
  key: string
  jobId: string
  title: string
  heldByJobId: string
  heldByTitle: string
}

async function main() {
  const apply = process.argv.includes("--apply")

  const jobs = await prisma.job.findMany({
    where: { url: { not: null } },
    select: { id: true, userId: true, title: true, url: true, canonicalUrl: true },
    // Oldest first: when two rows want the same key, the one that has been
    // tracked longest keeps it.
    orderBy: { createdAt: "asc" },
  })

  /** Keys already spoken for per user — both the stored ones and this run's. */
  const claimed = new Map<string, Map<string, { jobId: string; title: string }>>()
  for (const job of jobs) {
    if (!job.canonicalUrl) continue
    const forUser = claimed.get(job.userId) ?? new Map()
    forUser.set(job.canonicalUrl, { jobId: job.id, title: job.title })
    claimed.set(job.userId, forUser)
  }

  const updates: PlannedUpdate[] = []
  const collisions: Collision[] = []

  for (const job of jobs) {
    const next = canonicalizeUrl(job.url) || null
    if (next === job.canonicalUrl) continue

    const forUser = claimed.get(job.userId) ?? new Map()
    const holder = next ? forUser.get(next) : undefined
    if (holder && holder.jobId !== job.id) {
      collisions.push({
        userId: job.userId,
        key: next!,
        jobId: job.id,
        title: job.title,
        heldByJobId: holder.jobId,
        heldByTitle: holder.title,
      })
      continue
    }

    updates.push({
      jobId: job.id,
      userId: job.userId,
      title: job.title,
      from: job.canonicalUrl,
      to: next,
    })
    if (job.canonicalUrl) forUser.delete(job.canonicalUrl)
    if (next) forUser.set(next, { jobId: job.id, title: job.title })
    claimed.set(job.userId, forUser)
  }

  console.log(`mode:        ${apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`)
  console.log(`scanned:     ${jobs.length} jobs with a url`)
  console.log(`would-update:${apply ? " (applying)" : ""} ${updates.length}`)
  console.log(`collisions:  ${collisions.length}`)

  for (const update of updates) {
    console.log(`  update ${update.jobId} "${update.title}"`)
    console.log(`    from ${update.from ?? "(null)"}`)
    console.log(`    to   ${update.to ?? "(null)"}`)
  }
  for (const collision of collisions) {
    console.log(`  collision user=${collision.userId} key=${collision.key}`)
    console.log(`    job ${collision.jobId} "${collision.title}"`)
    console.log(`    held by job ${collision.heldByJobId} "${collision.heldByTitle}"`)
  }

  if (!apply) {
    console.log("\nDry run: nothing was written. Re-run with --apply to write.")
    return
  }

  let written = 0
  for (const update of updates) {
    await prisma.job.update({
      where: { id: update.jobId },
      data: { canonicalUrl: update.to },
    })
    written += 1
  }
  console.log(`\nWrote ${written} canonicalUrl values.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
