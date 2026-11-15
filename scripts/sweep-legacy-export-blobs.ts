/**
 * P0.8 ops sweep: enumerates Vercel Blob objects and finds the ones written
 * before commit d5f65ff (`access: "public"`, absolute CDN URL persisted in
 * `ResumeExport.templateUrls`), so they can be deleted and the stale absolute
 * URLs cleared from the database.
 *
 * See `src/shared/lib/legacy-export-classifier.ts` for the pure classification
 * logic and why pathname shape alone can only rule OUT "current", never
 * positively confirm "legacy".
 *
 * Modes:
 *   (default)   Dry run. Lists every blob, classifies it, prints a summary and
 *               the exact deletion/DB-fix candidates. Deletes and writes
 *               nothing.
 *   --delete    Actually deletes blobs classified "legacy". Never deletes a
 *               blob classified "current" (either by a live DB reference or
 *               by pathname shape), regardless of any other flag.
 *   --fix-db    Removes legacy (absolute-URL) entries from `templateUrls`
 *               rows. If a row has no entries left afterward, sets
 *               `templateUrls` to null. Current entries are left untouched.
 *   --before <ISO date>   Cutoff on `uploadedAt`: an orphaned blob (not
 *               referenced by any live row, in either direction) older than
 *               this is also classified "legacy". Optional; without it, only
 *               DB-referenced-legacy blobs are eligible for deletion.
 *   --yes       Required alongside --delete or --fix-db to actually mutate
 *               anything. Prod is the intended target for this script, so
 *               there is no environment refusal — only this explicit guard.
 *
 * Usage:
 *   npx tsx scripts/sweep-legacy-export-blobs.ts                          # dry run
 *   npx tsx scripts/sweep-legacy-export-blobs.ts --before 2026-08-20      # dry run w/ cutoff
 *   npx tsx scripts/sweep-legacy-export-blobs.ts --delete --yes
 *   npx tsx scripts/sweep-legacy-export-blobs.ts --fix-db --yes
 *
 * Env: BLOB_READ_WRITE_TOKEN (required — refuses to run without it),
 *      DATABASE_URL (required for the templateUrls cross-reference).
 */
import "dotenv/config"

import { del, list } from "@vercel/blob"

import {
  classifyBlob,
  collectReferencedPathnames,
  type BlobClassification,
  type ReferencedPathnames,
} from "@/shared/lib/legacy-export-classifier"
import { prisma } from "@/shared/lib/prisma"
import { Prisma } from "@/generated/prisma/client"

interface ParsedArgs {
  delete: boolean
  fixDb: boolean
  yes: boolean
  before?: Date
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { delete: false, fixDb: false, yes: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--delete") args.delete = true
    else if (arg === "--fix-db") args.fixDb = true
    else if (arg === "--yes") args.yes = true
    else if (arg === "--before") {
      const value = argv[++i]
      if (!value) throw new Error("--before requires an ISO date value")
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`--before value is not a valid date: ${value}`)
      }
      args.before = parsed
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

interface ListedBlob {
  pathname: string
  uploadedAt: Date
  url: string
}

/** Enumerates every blob in the store under the `exports/` prefix, following pagination. */
async function listAllExportBlobs(): Promise<ListedBlob[]> {
  const blobs: ListedBlob[] = []
  let cursor: string | undefined

  do {
    const page = await list({ prefix: "exports/", cursor })
    for (const blob of page.blobs) {
      blobs.push({ pathname: blob.pathname, uploadedAt: blob.uploadedAt, url: blob.url })
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  return blobs
}

/**
 * Reads every `ResumeExport` row's `templateUrls` value from the database.
 * No `where` filter on the Json column itself — its "is not SQL NULL" filter
 * shape is awkward to express, and every downstream consumer here
 * (`collectReferencedPathnames`, `stripLegacyEntries`) already treats a
 * `null` value as a no-op.
 */
async function loadTemplateUrlsRows(): Promise<
  Array<{ id: string; templateUrls: unknown }>
> {
  return prisma.resumeExport.findMany({
    select: { id: true, templateUrls: true },
  })
}

interface Classified {
  blob: ListedBlob
  classification: BlobClassification
}

function classifyAll(
  blobs: ListedBlob[],
  referenced: ReferencedPathnames,
  cutoff: Date | undefined
): Classified[] {
  return blobs.map((blob) => ({
    blob,
    classification: classifyBlob(blob, referenced, cutoff),
  }))
}

function printSummary(classified: Classified[]): void {
  const counts: Record<BlobClassification, number> = { legacy: 0, current: 0, unknown: 0 }
  for (const { classification } of classified) counts[classification]++

  console.log("\n=== Blob classification summary ===")
  console.log(`Total blobs under exports/: ${classified.length}`)
  console.log(`  legacy  (deletion candidates): ${counts.legacy}`)
  console.log(`  current (never delete):        ${counts.current}`)
  console.log(`  unknown (orphaned, unclear):   ${counts.unknown}`)

  const legacy = classified.filter((c) => c.classification === "legacy")
  if (legacy.length > 0) {
    console.log("\nLegacy blobs (deletion candidates):")
    for (const { blob } of legacy) {
      console.log(`  ${blob.pathname}  uploadedAt=${blob.uploadedAt.toISOString()}`)
    }
  }

  const unknown = classified.filter((c) => c.classification === "unknown")
  if (unknown.length > 0) {
    console.log(
      `\n${unknown.length} orphaned blob(s) could not be classified with confidence (no DB reference, and either no --before cutoff was given or they postdate it). They are never auto-deleted. Sample:`
    )
    for (const { blob } of unknown.slice(0, 10)) {
      console.log(`  ${blob.pathname}  uploadedAt=${blob.uploadedAt.toISOString()}`)
    }
  }
}

async function deleteLegacyBlobs(classified: Classified[]): Promise<void> {
  const pathnames = classified
    .filter((c) => c.classification === "legacy")
    .map((c) => c.blob.pathname)

  if (pathnames.length === 0) {
    console.log("\nNo legacy blobs to delete.")
    return
  }

  console.log(`\nDeleting ${pathnames.length} legacy blob(s)...`)
  await del(pathnames)
  console.log("Delete complete.")
}

/** Removes legacy (absolute-URL) entries from a single templateUrls JSON value. */
function stripLegacyEntries(value: unknown): { changed: boolean; next: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { changed: false, next: value }
  }

  const source = value as Record<string, Record<string, unknown>>
  const next: Record<string, Record<string, unknown>> = {}
  let changed = false

  for (const [template, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== "object") {
      next[template] = entry
      continue
    }
    const cleaned: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(entry)) {
      if (typeof raw === "string" && /^https?:\/\//i.test(raw)) {
        changed = true
        continue
      }
      cleaned[key] = raw
    }
    if (Object.keys(cleaned).length > 0) {
      next[template] = cleaned
    } else {
      changed = true
    }
  }

  return { changed, next: Object.keys(next).length > 0 ? next : null }
}

async function fixDbRows(dryRun: boolean): Promise<void> {
  const rows = await loadTemplateUrlsRows()
  let affected = 0

  for (const row of rows) {
    const { changed, next } = stripLegacyEntries(row.templateUrls)
    if (!changed) continue
    affected++

    if (dryRun) {
      console.log(
        `[dry-run] would update ResumeExport ${row.id}: templateUrls -> ${
          next === null ? "null" : JSON.stringify(next)
        }`
      )
    } else {
      await prisma.resumeExport.update({
        where: { id: row.id },
        data: {
          // `Prisma.DbNull` (not `null`, which Prisma reads as a JSON null
          // literal) clears a `Json?` column to SQL NULL.
          templateUrls: next === null ? Prisma.DbNull : (next as Prisma.InputJsonValue),
        },
      })
    }
  }

  console.log(
    `\n${dryRun ? "[dry-run] Would affect" : "Updated"} ${affected} ResumeExport row(s) out of ${rows.length} total.`
  )
}

async function main(): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is not set. Refusing to run.")
    process.exitCode = 1
    return
  }

  const args = parseArgs(process.argv.slice(2))

  if ((args.delete || args.fixDb) && !args.yes) {
    console.error(
      "--delete and --fix-db require --yes as an explicit confirmation. Nothing was changed."
    )
    process.exitCode = 1
    return
  }

  console.log("Listing blobs under exports/ ...")
  const blobs = await listAllExportBlobs()
  console.log(`Found ${blobs.length} blob(s).`)

  console.log("Loading ResumeExport.templateUrls for cross-reference ...")
  const rows = await loadTemplateUrlsRows()
  const referenced = collectReferencedPathnames(rows.map((r) => r.templateUrls))
  console.log(
    `Cross-reference: ${referenced.current.size} current pathname(s), ${referenced.legacy.size} legacy pathname(s) referenced by ${rows.length} row(s).`
  )

  if (args.before) {
    console.log(`Cutoff: blobs uploaded before ${args.before.toISOString()} without a current reference/shape are also treated as legacy.`)
  }

  const classified = classifyAll(blobs, referenced, args.before)
  printSummary(classified)

  if (args.delete) {
    await deleteLegacyBlobs(classified)
  } else {
    console.log("\nDry run: no blobs deleted. Pass --delete --yes to actually delete.")
  }

  if (args.fixDb) {
    await fixDbRows(false)
  } else {
    console.log("\nDry run: no DB rows changed. Pass --fix-db --yes to actually update templateUrls.")
    await fixDbRows(true)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
