/**
 * P1.1 ops migration: rewrites stored `v1` secret-box envelopes (key derived
 * from `AUTH_SECRET`) as `v2` (key derived from the dedicated `ENCRYPTION_KEY`),
 * so rotating `AUTH_SECRET` stops destroying saved LLM API keys.
 *
 * Scans:
 *   - `AiSettings.openaiApiKeyEnc`, `AiSettings.anthropicApiKeyEnc`
 *   - `UserAiSettings.apiKeyEnc`
 *
 * Per value: `v2` (or any non-`v1`) is skipped as already migrated; a `v1`
 * value is decrypted with the AUTH_SECRET key and re-encrypted under the
 * ENCRYPTION_KEY one; a `v1` value that will not decrypt is reported and left
 * alone (it is already unreadable to the app — rewriting it is impossible, and
 * the owner has to re-enter the key).
 *
 * Never prints a plaintext secret; at most its last 4 characters.
 *
 * Modes:
 *   (default)   Dry run. Decrypts and re-encrypts in memory, prints counts and
 *               a per-row plan, writes nothing.
 *   --yes       Required to actually persist the `v2` values.
 *
 * Usage:
 *   npx tsx scripts/reencrypt-secrets.ts            # dry run
 *   npx tsx scripts/reencrypt-secrets.ts --yes      # migrate
 *
 * Env: AUTH_SECRET and ENCRYPTION_KEY both required (refuses to run without
 *      either — the old key is needed to read, the new one to write),
 *      DATABASE_URL.
 *
 * See `src/shared/lib/secret-reencrypt.ts` for the pure per-value transform.
 */
import "dotenv/config"

import { prisma } from "@/shared/lib/prisma"
import {
  emptyCounts,
  reencryptValue,
  type ReencryptCounts,
} from "@/shared/lib/secret-reencrypt"

interface ParsedArgs {
  yes: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { yes: false }

  for (const arg of argv) {
    if (arg === "--yes") args.yes = true
    else throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

function addTo(counts: ReencryptCounts, outcome: keyof ReencryptCounts): void {
  counts[outcome]++
}

/** Describes one value's plan without ever revealing the secret. */
function describe(label: string, outcome: string, last4?: string): string {
  const tail = last4 ? ` (…${last4})` : ""
  return `  ${label}: ${outcome}${tail}`
}

async function migrateAiSettings(dryRun: boolean, counts: ReencryptCounts): Promise<void> {
  const rows = await prisma.aiSettings.findMany({
    select: { id: true, openaiApiKeyEnc: true, anthropicApiKeyEnc: true },
  })

  console.log(`\n=== AiSettings (${rows.length} row(s)) ===`)

  for (const row of rows) {
    const openai = reencryptValue(row.openaiApiKeyEnc)
    const anthropic = reencryptValue(row.anthropicApiKeyEnc)
    addTo(counts, openai.outcome)
    addTo(counts, anthropic.outcome)

    console.log(`AiSettings ${row.id}`)
    console.log(describe("openaiApiKeyEnc", openai.outcome, openai.last4))
    console.log(describe("anthropicApiKeyEnc", anthropic.outcome, anthropic.last4))

    const data: { openaiApiKeyEnc?: string; anthropicApiKeyEnc?: string } = {}
    if (openai.outcome === "reencrypted") data.openaiApiKeyEnc = openai.next
    if (anthropic.outcome === "reencrypted") data.anthropicApiKeyEnc = anthropic.next
    if (Object.keys(data).length === 0) continue

    if (dryRun) {
      console.log(`  [dry-run] would rewrite ${Object.keys(data).join(", ")} as v2`)
    } else {
      await prisma.aiSettings.update({ where: { id: row.id }, data })
      console.log(`  rewrote ${Object.keys(data).join(", ")} as v2`)
    }
  }
}

async function migrateUserAiSettings(
  dryRun: boolean,
  counts: ReencryptCounts
): Promise<void> {
  const rows = await prisma.userAiSettings.findMany({
    select: { id: true, userId: true, apiKeyEnc: true },
  })

  console.log(`\n=== UserAiSettings (${rows.length} row(s)) ===`)

  for (const row of rows) {
    const result = reencryptValue(row.apiKeyEnc)
    addTo(counts, result.outcome)

    if (result.outcome === "empty") continue
    console.log(
      describe(`UserAiSettings ${row.id} (user ${row.userId}) apiKeyEnc`, result.outcome, result.last4)
    )

    if (result.outcome !== "reencrypted") continue

    if (dryRun) {
      console.log("    [dry-run] would rewrite apiKeyEnc as v2")
    } else {
      await prisma.userAiSettings.update({
        where: { id: row.id },
        data: { apiKeyEnc: result.next },
      })
      console.log("    rewrote apiKeyEnc as v2")
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.AUTH_SECRET?.trim()) {
    console.error(
      "AUTH_SECRET is not set. It is needed to read the existing v1 values. Refusing to run."
    )
    process.exitCode = 1
    return
  }

  if (!process.env.ENCRYPTION_KEY?.trim()) {
    console.error(
      "ENCRYPTION_KEY is not set. It is the key the v2 values are written under. Refusing to run.\n" +
        "Generate one with: openssl rand -base64 32"
    )
    process.exitCode = 1
    return
  }

  const args = parseArgs(process.argv.slice(2))
  const dryRun = !args.yes

  console.log(
    dryRun
      ? "Dry run: nothing will be written. Pass --yes to persist the v2 values."
      : "Migrating v1 secrets to v2 ..."
  )

  const counts = emptyCounts()
  await migrateAiSettings(dryRun, counts)
  await migrateUserAiSettings(dryRun, counts)

  console.log("\n=== Summary ===")
  console.log(`  re-encrypted v1 -> v2:      ${counts.reencrypted}`)
  console.log(`  already v2 (skipped):       ${counts.skipped}`)
  console.log(`  empty (nothing stored):     ${counts.empty}`)
  console.log(`  v1 but undecryptable:       ${counts.undecryptable}`)

  if (counts.undecryptable > 0) {
    console.log(
      "\nUndecryptable v1 values were left in place. They were already unreadable to the app (AUTH_SECRET changed at some point); the owner has to re-enter the key at /settings/ai."
    )
  }

  if (dryRun && counts.reencrypted > 0) {
    console.log("\nRe-run with --yes to persist.")
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
