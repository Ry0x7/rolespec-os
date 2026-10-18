import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { redirect } from "next/navigation"
import { ResumeBrowser } from "@/features/resume/components/resume-browser"
import { Plus } from "lucide-react"
import { EmptyState } from "@/shared/components/empty-state"
import { UploadResumeDialog } from "@/features/resume/components/upload-resume-dialog"
import { CreateResumeDialog } from "@/features/resume/components/create-resume-dialog"
import { ArchivedResumeList } from "@/features/resume/components/archived-resume-list"
import { buildResumeSourceLists } from "@/features/resume/services/resume-source-options"
import { analysisModeFromDb } from "@/features/resume/lib/ats-score"
import { PageShell } from "@/shared/components/page-shell"

export default async function ResumesPage({
  searchParams,
}: {
  searchParams: Promise<{ tailorJobId?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/sign-in")

  const { tailorJobId } = await searchParams

  const [resumes, archivedResumes, roleFamilies, jobApplications] =
    await Promise.all([
    prisma.resume.findMany({
      where: { userId: session.user.id, status: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      include: {
        roleFamily: { select: { name: true } },
        // Lineage for the card's "From ..." line; `careerProfileId` (a scalar,
        // already included) marks a master built from the Career Profile.
        sourceResume: { select: { id: true, title: true, status: true } },
        jobApplication: {
          select: { id: true, job: { select: { title: true, companyName: true } } },
        },
        // The card badge has to name the question the score answered, the same
        // way the editor header does. One row per resume, on the existing list
        // query — no second query per card. The persisted mode is read instead
        // of the job description, so the list never fetches posting text.
        analyses: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { overallScore: true, mode: true },
        },
      },
    }),
    prisma.resume.findMany({
      where: { userId: session.user.id, status: "ARCHIVED" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true },
    }),
    prisma.careerRoleFamily.findMany({
      where: { careerProfile: { userId: session.user.id } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.jobApplication.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, job: { select: { title: true, companyName: true } } },
    }),
  ])

  // The posting fields come off the `job` relation now; the dialog still takes
  // the flat shape it always has.
  const jobApplicationOptions = jobApplications.map((application) => ({
    id: application.id,
    jobTitle: application.job.title,
    companyName: application.job.companyName,
  }))

  // Same reshaping for the cards: the posting fields live on `job` now, but
  // ResumeCard still takes the flat `jobApplication` shape.
  const resumeCards = resumes.map(({ analyses, ...resume }) => ({
    ...resume,
    jobApplication: resume.jobApplication
      ? {
          id: resume.jobApplication.id,
          jobTitle: resume.jobApplication.job.title,
          companyName: resume.jobApplication.job.companyName,
        }
      : null,
    // Only a master that records its Career Profile says so; legacy masters
    // carry no origin and show nothing.
    origin:
      resume.variant === "MASTER" && resume.careerProfileId ? ("profile" as const) : null,
    // Mirrors the editor page: the mode comes off the persisted column. Only
    // the score and the mode cross to the client.
    latestAnalysis: analyses[0]
      ? {
          overallScore: analyses[0].overallScore,
          mode: analysisModeFromDb(analyses[0].mode),
        }
      : null,
  }))

  // Shared with Job Detail, which opens the same dialog in place, so both
  // surfaces offer exactly the same source resumes.
  const { masterResumes, roleFamilyResumes } = buildResumeSourceLists(resumes)

  return (
    <PageShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Resumes</h1>
          <p className="text-sm text-muted-foreground">
            Manage your resume builds
          </p>
        </div>
        <div className="flex items-center gap-2">
          <UploadResumeDialog />
          {/* Only this instance takes `tailorJobId`: the empty-state copy below
              would otherwise auto-open a second dialog for the same param. */}
          <CreateResumeDialog
            masterResumes={masterResumes}
            roleFamilies={roleFamilies}
            roleFamilyResumes={roleFamilyResumes}
            jobApplications={jobApplicationOptions}
            tailorJobId={tailorJobId}
          />
        </div>
      </div>

      {resumes.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="No resumes yet"
          description="Create a new resume or upload an existing one to start building your career spec."
          action={
            <div className="flex items-center gap-2">
              <UploadResumeDialog />
              <CreateResumeDialog
                masterResumes={masterResumes}
                roleFamilies={roleFamilies}
                roleFamilyResumes={roleFamilyResumes}
                jobApplications={jobApplicationOptions}
              />
            </div>
          }
        />
      ) : (
        <ResumeBrowser resumes={resumeCards} />
      )}

      {archivedResumes.length > 0 && (
        <ArchivedResumeList resumes={archivedResumes} />
      )}
    </PageShell>
  )
}
