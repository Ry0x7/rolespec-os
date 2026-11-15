"use server"

import { revalidatePath } from "next/cache"

import {
  CareerCapabilityDepth,
  CareerEvidenceSource,
  CareerEvidenceStatus,
} from "@/generated/prisma/enums"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_MESSAGE,
  consumeRateLimit,
} from "@/shared/lib/rate-limit"

import { getOrCreateCareerProfileId } from "../services/career-profile.service"
import {
  capabilityKey,
  evidenceKey,
} from "../services/import-resume.service"
import {
  WebSourceError,
  mapGitHubToCareerFacts,
  mapPortfolioToCareerFacts,
  scanGitHub,
  scanPortfolio,
  type WebScanFacts,
} from "../services/web-presence.service"
import { CAREER_PROFILE_PATH } from "./shared"

/** Six scans per ten minutes is plenty for a profile the owner is editing. */
const WEB_SCAN_RATE_LIMIT = { max: 6, windowMs: 10 * 60 * 1000 }

export type WebScanSource = "github" | "portfolio"

export interface WebScanCounts {
  evidenceCreated: number
  evidenceSkipped: number
  capabilitiesCreated: number
  capabilitiesSkipped: number
  linksCreated: number
}

export type WebScanResult =
  | { error: string }
  | ({ success: true; source: WebScanSource; label: string } & WebScanCounts)

function friendlyError(error: unknown): string {
  if (error instanceof WebSourceError) {
    switch (error.code) {
      case "INVALID_URL":
      case "BLOCKED_HOST":
      case "TOO_MANY_REDIRECTS":
        return error.message
      case "NOT_FOUND":
        return "That page was not found. Check the address and try again."
      case "RATE_LIMITED":
        return "The source is rate limiting requests right now. Try again later."
      case "TOO_LARGE":
        return "That page is too large to scan."
      case "TIMEOUT":
        return "That address took too long to respond."
      case "UNSUPPORTED_CONTENT":
        return "That address did not return a page RoleSpec can read."
      default:
        return "That source could not be read. Check the address and try again."
    }
  }
  return "The scan failed. Please try again."
}

function isWebSource(value: string): value is WebScanSource {
  return value === "github" || value === "portfolio"
}

/**
 * Opt-in scan of one public source the owner supplied.
 *
 * The target is never stored by this action and no source is scanned on a
 * schedule. Results are written as `*_IMPORT_CANDIDATE` + `CANDIDATE`, exactly
 * like a resume import, so the Evidence card is the only place a fact can become
 * confirmed. Existing evidence is deduplicated by kind + title + organisation.
 */
export async function scanCareerWebSource(formData: FormData): Promise<WebScanResult> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized" }
  const userId = session.user.id

  const sourceValue = String(formData.get("source") ?? "").trim()
  if (!isWebSource(sourceValue)) return { error: "Choose GitHub or a portfolio page." }

  // The checkbox is the opt-in, and it is checked on the server too: a direct
  // POST must not be able to start an outbound scan without it.
  if (formData.get("confirm") !== "on") {
    return { error: "Confirm that the profile belongs to you before scanning." }
  }

  const target = String(formData.get("url") ?? "").trim()
  if (!target) {
    return {
      error:
        sourceValue === "github"
          ? "Enter your GitHub profile address."
          : "Enter your portfolio address.",
    }
  }

  const allowed = await consumeRateLimit(
    RATE_LIMIT_BUCKETS.CAREER_WEB_IMPORT,
    userId,
    WEB_SCAN_RATE_LIMIT
  )
  if (!allowed) return { error: RATE_LIMIT_MESSAGE }

  let facts: WebScanFacts
  let label: string
  try {
    if (sourceValue === "github") {
      const scan = await scanGitHub(target)
      facts = mapGitHubToCareerFacts(scan)
      label = `github.com/${scan.profile.login}`
    } else {
      const scan = await scanPortfolio(target)
      facts = mapPortfolioToCareerFacts(scan)
      label = scan.host
    }
  } catch (error) {
    return { error: friendlyError(error) }
  }

  const profileId = await getOrCreateCareerProfileId(userId)

  try {
    const [existingEvidence, existingCapabilities] = await Promise.all([
      prisma.careerEvidence.findMany({
        where: { careerProfileId: profileId },
        select: { id: true, kind: true, title: true, organization: true },
      }),
      prisma.careerCapability.findMany({
        where: { careerProfileId: profileId },
        select: { id: true, name: true },
      }),
    ])

    const evidenceIdByKey = new Map(existingEvidence.map((row) => [evidenceKey(row), row.id]))
    const capabilityIdByKey = new Map(
      existingCapabilities.map((row) => [capabilityKey(row.name), row.id])
    )

    let evidenceCreated = 0
    let evidenceSkipped = 0
    let capabilitiesCreated = 0
    let capabilitiesSkipped = 0

    // Capabilities first, so evidence links can point at their ids.
    for (const candidate of facts.capabilities) {
      const key = capabilityKey(candidate.name)
      if (!key) continue
      if (capabilityIdByKey.has(key)) {
        capabilitiesSkipped += 1
        continue
      }
      const created = await prisma.careerCapability.create({
        data: {
          careerProfileId: profileId,
          name: candidate.name,
          category: candidate.category,
          // A public page demonstrates the skill; it does not vouch for the
          // owner's own rating of it.
          confirmed: false,
        },
        select: { id: true },
      })
      capabilityIdByKey.set(key, created.id)
      capabilitiesCreated += 1
    }

    const links: {
      evidenceId: string
      capabilityId: string
      depth: CareerCapabilityDepth
    }[] = []

    for (const candidate of facts.evidence) {
      const key = evidenceKey(candidate)
      if (evidenceIdByKey.has(key)) {
        evidenceSkipped += 1
        continue
      }

      const created = await prisma.careerEvidence.create({
        data: {
          careerProfileId: profileId,
          kind: candidate.kind,
          title: candidate.title,
          organization: candidate.organization,
          details: candidate.details,
          startDate: candidate.startDate,
          endDate: candidate.endDate,
          source:
            facts.source === "github"
              ? CareerEvidenceSource.GITHUB_IMPORT_CANDIDATE
              : CareerEvidenceSource.PORTFOLIO_IMPORT_CANDIDATE,
          status: CareerEvidenceStatus.CANDIDATE,
          metadata: candidate.metadata as never,
        },
        select: { id: true },
      })

      evidenceIdByKey.set(key, created.id)
      evidenceCreated += 1

      for (const name of candidate.capabilityNames) {
        const capabilityId = capabilityIdByKey.get(capabilityKey(name))
        if (!capabilityId) continue
        links.push({
          evidenceId: created.id,
          capabilityId,
          depth:
            facts.source === "github"
              ? CareerCapabilityDepth.WORKING
              : CareerCapabilityDepth.EXPOSURE,
        })
      }
    }

    let linksCreated = 0
    if (links.length > 0) {
      const result = await prisma.careerEvidenceCapability.createMany({
        data: links,
        skipDuplicates: true,
      })
      linksCreated = result.count
    }

    if (evidenceCreated > 0 || capabilitiesCreated > 0) {
      revalidatePath(CAREER_PROFILE_PATH)
    }

    return {
      success: true,
      source: facts.source,
      label,
      evidenceCreated,
      evidenceSkipped,
      capabilitiesCreated,
      capabilitiesSkipped,
      linksCreated,
    }
  } catch {
    return { error: "The scan could not be saved. Please try again." }
  }
}
