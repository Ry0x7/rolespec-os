import { prisma } from "@/shared/lib/prisma"
import { encryptSecret, secretLast4, tryDecryptSecret } from "@/shared/lib/secret-box"

/**
 * Third-party connection settings that can be saved from the Settings screen.
 *
 * The desktop build has no convenient `.env` workflow, so a key entered in the
 * UI must live in the managed Postgres database. It is encrypted with the same
 * AES-256-GCM secret-box as AI keys and never returned to the browser. An
 * environment value is still read as a fallback for self-hosted deployments.
 */

const SETTINGS_ID = "singleton"
const CACHE_TTL_MS = 30_000
const MAX_BASE_URL_LENGTH = 300

interface IntegrationSettingsValue {
  firecrawlApiKeyEnc: string | null
  firecrawlBaseUrl: string | null
}

let cache: { value: IntegrationSettingsValue | null; expiresAt: number } | null = null
let readErrorLogged = false

export function clearIntegrationSettingsCache(): void {
  cache = null
  readErrorLogged = false
}

async function readIntegrationSettings(): Promise<IntegrationSettingsValue | null> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.value

  try {
    const row = await prisma.integrationSettings.findUnique({
      where: { id: SETTINGS_ID },
    })
    const value: IntegrationSettingsValue | null = row
      ? {
          firecrawlApiKeyEnc: row.firecrawlApiKeyEnc ?? null,
          firecrawlBaseUrl: row.firecrawlBaseUrl ?? null,
        }
      : null
    cache = { value, expiresAt: now + CACHE_TTL_MS }
    return value
  } catch (error) {
    if (!readErrorLogged) {
      readErrorLogged = true
      // A missing table (first run before migrations) or a DB hiccup must not
      // break discovery; falling back to the environment is the documented path.
      console.warn("Could not read integration settings; using environment values.", {
        error,
      })
    }
    cache = { value: null, expiresAt: now + CACHE_TTL_MS }
    return null
  }
}

function envFirecrawlKey(): string | null {
  return process.env.FIRECRAWL_API_KEY?.trim() || null
}

function envFirecrawlBaseUrl(): string | null {
  return process.env.FIRECRAWL_BASE_URL?.trim() || null
}

export type IntegrationSettingSource = "settings" | "env" | null

export interface FirecrawlRuntimeConfig {
  /** Decrypted key for this server-side request, or null when unconfigured. */
  apiKey: string | null
  /** Optional self-hosted Firecrawl root. */
  baseUrl: string | null
  source: IntegrationSettingSource
}

/** What the runtime needs. Decrypts at the point of use, never caches plaintext. */
export async function getFirecrawlRuntimeConfig(): Promise<FirecrawlRuntimeConfig> {
  const row = await readIntegrationSettings()
  const storedKey = tryDecryptSecret(row?.firecrawlApiKeyEnc ?? null)
  const envKey = envFirecrawlKey()
  return {
    apiKey: storedKey || envKey,
    baseUrl: row?.firecrawlBaseUrl?.trim() || envFirecrawlBaseUrl(),
    source: storedKey ? "settings" : envKey ? "env" : null,
  }
}

export interface FirecrawlStatus {
  configured: boolean
  source: IntegrationSettingSource
  last4?: string
  baseUrl: string | null
  /** True when an environment key exists as a fallback. */
  envConfigured: boolean
  /** True when this build can encrypt a saved key. */
  canSave: boolean
}

/** Safe status for the Settings card. Never returns the key itself. */
export async function getFirecrawlStatus(): Promise<FirecrawlStatus> {
  const row = await readIntegrationSettings()
  const storedKey = tryDecryptSecret(row?.firecrawlApiKeyEnc ?? null)
  const envKey = envFirecrawlKey()
  return {
    configured: Boolean(storedKey || envKey),
    source: storedKey ? "settings" : envKey ? "env" : null,
    ...(storedKey ? { last4: secretLast4(storedKey) } : {}),
    baseUrl: row?.firecrawlBaseUrl?.trim() || envFirecrawlBaseUrl(),
    envConfigured: Boolean(envKey),
    canSave: Boolean(process.env.AUTH_SECRET?.trim() || process.env.ENCRYPTION_KEY?.trim()),
  }
}

function normalizeBaseUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? ""
  if (!trimmed) return null
  if (trimmed.length > MAX_BASE_URL_LENGTH) {
    throw new Error(`The Firecrawl address cannot be longer than ${MAX_BASE_URL_LENGTH} characters.`)
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error("Enter a full Firecrawl address such as https://api.firecrawl.dev.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The Firecrawl address must start with http:// or https://.")
  }
  if (url.username || url.password) {
    throw new Error("Do not put a username or password in the Firecrawl address.")
  }
  return url.toString().replace(/\/$/, "")
}

export interface SaveFirecrawlSettingsInput {
  /** undefined keeps the stored key; null clears it; a string replaces it. */
  apiKey?: string | null
  /** undefined keeps the stored address; null clears it; a string replaces it. */
  baseUrl?: string | null
}

/**
 * Upserts the singleton connection row. Encryption happens before Prisma sees
 * the value, and the runtime cache is dropped so the next request uses the new
 * key immediately.
 */
export async function saveFirecrawlSettings(
  input: SaveFirecrawlSettingsInput
): Promise<void> {
  const existing = await readIntegrationSettings()
  const apiKeyEnc =
    input.apiKey === undefined
      ? existing?.firecrawlApiKeyEnc ?? null
      : input.apiKey === null
        ? null
        : encryptSecret(input.apiKey.trim())
  const firecrawlBaseUrl =
    input.baseUrl === undefined
      ? existing?.firecrawlBaseUrl ?? null
      : normalizeBaseUrl(input.baseUrl)

  await prisma.integrationSettings.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
      firecrawlApiKeyEnc: apiKeyEnc,
      firecrawlBaseUrl,
    },
    update: { firecrawlApiKeyEnc: apiKeyEnc, firecrawlBaseUrl },
  })

  clearIntegrationSettingsCache()
}
