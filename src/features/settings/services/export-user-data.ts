import { prisma } from "@/shared/lib/prisma"

/**
 * Assembles everything the app holds about one user, for the data-portability
 * right the privacy policy commits to.
 *
 * Two rules shape what is included:
 *
 * 1. **Everything the privacy policy claims we hold.** If a category is listed
 *    there and missing here, the export is a false statement. The shape below is
 *    deliberately parallel to that list.
 * 2. **Nothing that belongs to someone else.** Only rows owned by this user are
 *    included; nothing about any other user.
 *
 * The password hash is never exported. It is not useful to the user and handing it
 * out turns a downloaded file into an offline cracking target.
 */

export interface UserDataExport {
  exportedAt: string
  format: 1
  account: Record<string, unknown>
  profile: Record<string, unknown> | null
  resumes: unknown[]
  atsAnalyses: unknown[]
  exports: unknown[]
  jobApplications: unknown[]
  coverLetters: unknown[]
  todos: unknown[]
  notes: unknown[]
  profileRatings: unknown[]
  linkedinSuggestions: unknown[]
}

export async function exportUserData(userId: string): Promise<UserDataExport | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      preferences: true,
      createdAt: true,
      updatedAt: true,
      // password, passwordChangedAt and sessionVersion are deliberately absent:
      // credentials material that is not useful to the user.
      profile: true,
      accounts: {
        // The provider linkage is the user's own data; the OAuth tokens are not
        // theirs to re-use and would be a live credential in a downloaded file.
        select: { provider: true, providerAccountId: true, type: true },
      },
      resumes: {
        include: {
          sections: { include: { items: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
        },
      },
      atsAnalyses: true,
      resumeExports: true,
      // The posting itself lives on `job` now — applications created since the
      // Job/Application split no longer mirror it, so without the relation the
      // export would carry an application with no company, title or description.
      jobApplications: { include: { job: true } },
      coverLetters: true,
      todos: true,
      notes: true,
      profileRatings: true,
      linkedinSuggestions: true,
    },
  })

  if (!user) return null

  const {
    profile,
    resumes,
    atsAnalyses,
    resumeExports,
    jobApplications,
    coverLetters,
    todos,
    notes,
    profileRatings,
    linkedinSuggestions,
    ...account
  } = user

  return {
    exportedAt: new Date().toISOString(),
    // Bumped if the shape changes, so a previously downloaded file stays readable.
    format: 1,
    account,
    profile,
    resumes,
    atsAnalyses,
    exports: resumeExports,
    jobApplications,
    coverLetters,
    todos,
    notes,
    profileRatings,
    linkedinSuggestions,
  }
}

/** `rolespec-export-2026-08-10.json` — dated so repeated downloads do not collide. */
export function exportFilename(now: Date = new Date()): string {
  return `rolespec-export-${now.toISOString().slice(0, 10)}.json`
}
