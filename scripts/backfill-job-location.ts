/**
 * Maintenance: fills `Job.location` for legacy browser-captured rows that were
 * saved without one, from the job board the posting was captured on.
 *
 * Manual and extension captures made before location capture existed carry
 * `location = NULL`. For boards that only publish for one country (see
 * `MARKET_HOSTS` in the market-fit service) the host alone names that country,
 * so this writes that country's plain name ("Philippines") using the same host
 * lookup the fit check already uses as its last-resort hint.
 *
 * It only ever writes `location`, and only on rows where it is NULL and the
 * source is MANUAL or EXTENSION. It never touches `url`, the title, the status
 * or anything else, and never deletes a row. Rows whose host maps to no known
 * market are reported as unresolved and left exactly as they are.
 *
 * A board host is the weakest location signal the fit check has; an explicit
 * location outranks a restriction stated in the description, and the host hint
 * does not. So a row whose description states a restriction ("USA only") is
 * skipped rather than given an inferred location that would outrank it.
 *
 * Usage:
 *   npx tsx scripts/backfill-job-location.ts            # dry run (default)
 *   npx tsx scripts/backfill-job-location.ts --dry-run  # explicit
 *   npx tsx scripts/backfill-job-location.ts --apply    # writes
 */
import "dotenv/config"

import { prisma } from "@/shared/lib/prisma"
import {
  deriveLocationFromHost,
  descriptionStatesRestriction,
} from "@/features/discovery/services/market-fit.service"

interface PlannedUpdate {
  jobId: string
  userId: string
  title: string
  source: string
  host: string
  label: string
}

interface SkippedRow {
  jobId: string
  source: string
  host: string
}

function hostOf(url: string | null): string {
  if (!url) return "(no url)"
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return "(unparseable url)"
  }
}

async function main() {
  const apply = process.argv.includes("--apply")

  const jobs = await prisma.job.findMany({
    where: { location: null, source: { in: ["MANUAL", "EXTENSION"] } },
    select: { id: true, userId: true, title: true, url: true, source: true, description: true },
  })

  const updates: PlannedUpdate[] = []
  const unresolved: SkippedRow[] = []
  const restricted: SkippedRow[] = []

  for (const job of jobs) {
    const label = deriveLocationFromHost(job.url)
    if (!label) {
      unresolved.push({ jobId: job.id, source: job.source, host: hostOf(job.url) })
      continue
    }
    if (descriptionStatesRestriction(job.description)) {
      restricted.push({ jobId: job.id, source: job.source, host: hostOf(job.url) })
      continue
    }
    updates.push({
      jobId: job.id,
      userId: job.userId,
      title: job.title,
      source: job.source,
      host: hostOf(job.url),
      label,
    })
  }

  console.log(`mode:        ${apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`)
  console.log(`scanned:     ${jobs.length} MANUAL/EXTENSION jobs with no location`)
  console.log(`resolvable:${apply ? " (applying)" : ""} ${updates.length}`)
  console.log(`skipped (stated restriction): ${restricted.length}`)
  console.log(`unresolved:  ${unresolved.length}`)

  for (const update of updates) {
    console.log(`  ${update.jobId} / ${update.source} / ${update.host} / ${update.label}`)
  }
  for (const row of restricted) {
    console.log(`  ${row.jobId} / ${row.source} / ${row.host} / SKIPPED: description states a restriction`)
  }
  for (const row of unresolved) {
    console.log(`  ${row.jobId} / ${row.source} / ${row.host} / unresolved`)
  }

  if (!apply) {
    console.log("\nDry run: nothing was written. Re-run with --apply to write.")
    return
  }

  let written = 0
  for (const update of updates) {
    await prisma.job.update({
      where: { id: update.jobId },
      data: { location: update.label },
    })
    written += 1
  }
  console.log(`\nwritten:     ${written} location values.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
