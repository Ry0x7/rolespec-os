import { z } from "zod"
import { WorkType } from "@/generated/prisma/enums"

/**
 * The payload the client is allowed to hand back when saving a candidate.
 *
 * Candidates are never persisted during a run, so a save posts the row back.
 * That means the client is a source of untrusted input like any other: the
 * caps mirror `createJobApplicationSchema` (200 for short fields, 20000 for the
 * description) and the server re-derives `canonicalUrl` rather than trusting
 * the one it is given.
 */
export const saveDiscoveredJobSchema = z.object({
  provider: z.string().min(1).max(50),
  externalId: z.string().min(1).max(200),
  title: z.string().min(1, "Job title is required").max(200),
  companyName: z.string().min(1, "Company name is required").max(200),
  url: z.string().url("Must be a valid URL").max(2000),
  location: z.string().max(200).optional(),
  workType: z.nativeEnum(WorkType).optional(),
  salaryText: z.string().max(200).optional(),
  description: z.string().max(20000).optional(),
  /** ISO string; the client only ever echoes back what the server sent it. */
  postedAt: z.string().datetime().optional(),
})

export type SaveDiscoveredJobInput = z.infer<typeof saveDiscoveredJobSchema>

/**
 * The one field "Add by URL" takes. Only the length is checked here — the
 * scheme and host guard lives in `fetch-posting.service`, which is also what a
 * redirect target has to pass, so there is one implementation of it.
 */
export const addJobByUrlSchema = z.object({
  url: z.string().min(1, "Paste a posting URL").max(2000),
})

/** Longest company name worth deriving a board slug from. */
export const MAX_COMPANY_NAME_LENGTH = 100

/**
 * The one field the company → board probe takes. A name, not a slug: turning it
 * into candidate slugs is `deriveBoardSlugs`' job, and the user is not expected
 * to know what the board is called — that is the whole point of the probe.
 */
export const probeCompanyBoardsSchema = z.object({
  name: z.string().trim().min(1, "Enter a company name").max(MAX_COMPANY_NAME_LENGTH),
})
