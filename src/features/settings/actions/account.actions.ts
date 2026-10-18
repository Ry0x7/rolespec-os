"use server"

import bcrypt from "bcryptjs"
import { z } from "zod"

import { auth, signOut } from "@/features/auth/config"
import { deleteExportFilesForResumes } from "@/features/export/services/store-export"
import { prisma } from "@/shared/lib/prisma"

import { DELETE_CONFIRMATION_PHRASE } from "../constants/data"

/**
 * Self-service account deletion, for the right to erasure the privacy policy
 * commits to. Previously only an admin could delete a user.
 *
 * Hard delete, not a soft flag. Every user-owned relation in `schema.prisma`
 * declares `onDelete: Cascade`, so one `user.delete()` removes résumés, sections,
 * items, ATS analyses, exports, applications, cover letters, todos, notes,
 * ratings, LinkedIn suggestions and OAuth links. `AdminAuditLog` deliberately has
 * no foreign key to `User`, so the admin trail survives — a deleted account must
 * not be able to erase the record of an admin action.
 *
 * The cascade only reaches database rows. Export PDFs sit in blob storage or on
 * disk, so they are collected separately by `deleteExportFilesForResumes`.
 */

const schema = z.object({
  confirmation: z.string(),
  // Present for credentials accounts; absent for OAuth-only ones.
  password: z.string().optional(),
})

export type DeleteAccountResult = { ok: false; message: string }

/**
 * Deletes the caller's account. On success it does not return — `signOut`
 * redirects — so the only resolved value is a failure.
 */
export async function deleteMyAccountAction(formData: FormData): Promise<DeleteAccountResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, message: "You are not signed in." }

  const parsed = schema.safeParse({
    confirmation: formData.get("confirmation"),
    password: formData.get("password") ?? undefined,
  })
  if (!parsed.success) return { ok: false, message: "Could not read the confirmation." }

  if (parsed.data.confirmation.trim() !== DELETE_CONFIRMATION_PHRASE) {
    return {
      ok: false,
      message: `Type ${DELETE_CONFIRMATION_PHRASE} exactly to confirm.`,
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, password: true, role: true },
  })
  if (!user) return { ok: false, message: "Account not found." }

  // A credentials account must re-enter its password: a stolen session cookie
  // must not be enough to destroy someone's data. An OAuth-only account has no
  // password to check, so the typed phrase is the whole confirmation.
  if (user.password) {
    const password = parsed.data.password ?? ""
    if (!password) return { ok: false, message: "Enter your password to confirm." }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return { ok: false, message: "That password is not correct." }
  }

  // An admin deleting themselves can leave the deployment with no way into
  // /admin. Refused rather than handled: demoting or promoting someone first is a
  // decision, not something to infer.
  if (user.role === "ADMIN") {
    const otherAdmins = await prisma.user.count({
      where: { role: "ADMIN", id: { not: user.id } },
    })
    if (otherAdmins === 0) {
      return {
        ok: false,
        message:
          "This is the only admin account. Promote another admin first, or the deployment will have no administrator.",
      }
    }
  }

  // Read the resume ids before the cascade removes them — every status,
  // archived included, because an archived resume keeps its export files. The
  // PDFs live outside the database, so nothing else would ever collect them.
  const resumes = await prisma.resume.findMany({
    where: { userId: user.id },
    select: { id: true },
  })

  await prisma.user.delete({ where: { id: user.id } })

  // Best-effort and never throws: the account is already gone, and a storage
  // failure must not turn a completed deletion into an error. Runs before
  // signOut, which never returns.
  await deleteExportFilesForResumes(resumes.map((resume) => resume.id))

  // Clears the session cookies and redirects. Throws internally, so nothing after
  // this line runs.
  await signOut({ redirectTo: "/?deleted=1" })

  return { ok: false, message: "Unreachable." }
}
