import { prisma } from "@/shared/lib/prisma"

/** The fields a resume row needs to become a `CreateResumeDialog` source option. */
export interface ResumeSourceRow {
  id: string
  title: string
  variant: string
  targetRole: string | null
  roleFamily: { name: string } | null
}

export interface SourceResumeOption {
  id: string
  title: string
  /** Master: target role. Role family: family name. Disambiguates same titles. */
  detail: string | null
}

/**
 * The three lists `CreateResumeDialog` needs to offer a source resume and a role
 * family. Shared so `/resumes` and Job Detail offer exactly the same choices.
 */
export interface ResumeSourceOptions {
  masterResumes: SourceResumeOption[]
  roleFamilies: Array<{ id: string; name: string }>
  roleFamilyResumes: SourceResumeOption[]
}

/**
 * Pure split of an already-loaded resume list into the dialog's source options.
 * `/resumes` uses this because it has the rows in hand for the cards already.
 */
export function buildResumeSourceLists(
  resumes: ResumeSourceRow[]
): Pick<ResumeSourceOptions, "masterResumes" | "roleFamilyResumes"> {
  return {
    masterResumes: resumes
      .filter((resume) => resume.variant === "MASTER")
      .map(({ id, title, targetRole }) => ({ id, title, detail: targetRole })),
    roleFamilyResumes: resumes
      .filter((resume) => resume.variant === "ROLE_FAMILY")
      .map(({ id, title, roleFamily }) => ({
        id,
        title,
        detail: roleFamily?.name ?? null,
      })),
  }
}

/**
 * Loads the dialog's source options for a user. For pages that do not already
 * hold the resume list — Job Detail opens the same dialog in place.
 */
export async function getResumeSourceOptions(
  userId: string
): Promise<ResumeSourceOptions> {
  const [resumes, roleFamilies] = await Promise.all([
    prisma.resume.findMany({
      where: {
        userId,
        status: { not: "ARCHIVED" },
        variant: { in: ["MASTER", "ROLE_FAMILY"] },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        variant: true,
        targetRole: true,
        roleFamily: { select: { name: true } },
      },
    }),
    prisma.careerRoleFamily.findMany({
      where: { careerProfile: { userId } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ])

  return { ...buildResumeSourceLists(resumes), roleFamilies }
}
