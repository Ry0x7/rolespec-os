"use server"

import { redirect } from "next/navigation"

import { auth } from "@/features/auth/config"
import { deleteExportFilesForResumes } from "@/features/export/services/store-export"
import { prisma } from "@/shared/lib/prisma"

import { DELETE_CONFIRMATION_PHRASE } from "../constants/data"

export type ResetWorkspaceResult = { ok: false; message: string }

/**
 * Erases every row owned by the single local owner: résumés, sections, ATS
 * analyses, exports, jobs, applications, cover letters, planner data, tokens and
 * the encrypted AI key. Foreign keys cascade from `User`, so one delete reaches
 * all of it.
 *
 * There is no account to close any more. The owner row is deliberately not
 * recreated here: the next request resolves a fresh owner, which sends the app
 * through first-run onboarding again. Export PDFs live outside the database and
 * are collected before the cascade removes the resume ids.
 */
export async function resetWorkspaceAction(
  formData: FormData
): Promise<ResetWorkspaceResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, message: "The workspace is locked." }

  const confirmation = String(formData.get("confirmation") ?? "").trim()
  if (confirmation !== DELETE_CONFIRMATION_PHRASE) {
    return {
      ok: false,
      message: `Type ${DELETE_CONFIRMATION_PHRASE} exactly to confirm.`,
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  })
  if (!user) return { ok: false, message: "Workspace not found." }

  // Read resume ids before the cascade removes them — archived resumes keep
  // their export files, and nothing else would ever collect those PDFs.
  const resumes = await prisma.resume.findMany({
    where: { userId: user.id },
    select: { id: true },
  })

  await prisma.user.delete({ where: { id: user.id } })

  // Best-effort and never throws: the data is already gone, and a storage
  // failure must not turn a completed wipe into an error.
  await deleteExportFilesForResumes(resumes.map((resume) => resume.id))

  redirect("/onboarding?reset=1")
}
