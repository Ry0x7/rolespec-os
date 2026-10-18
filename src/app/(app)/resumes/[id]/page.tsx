import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { redirect, notFound } from "next/navigation"
import { ResumeEditor } from "@/features/resume/components/resume-editor"
import { sanitizeTemplateUrls } from "@/features/export/services/store-export"
import type { ResumeData, ATSScores, ATSIssue, ATSSuggestion, LastExport } from "@/features/resume/hooks/use-resume-store"
import { analysisModeFromDb } from "@/features/resume/lib/ats-score"
import { isAnalysisOutdated } from "@/features/resume/lib/ats-staleness"

interface Props {
  params: Promise<{ id: string }>
  /** `?jobId=` deep-links the Job Target panel to a saved job application. */
  searchParams: Promise<{ jobId?: string }>
}

/**
 * Set at page level as well as on the (app) layout because the Next.js docs
 * specify page-level `maxDuration` as the lever for Server Action timeouts, and
 * this page hosts the heaviest action in the app: `generateResume` runs an AI
 * optimize pass, a per-item transaction, four template PDF renders
 * and four Blob uploads in a single request. Raise to 300 once Fluid compute is
 * enabled on the Vercel project — this path can legitimately exceed 60s.
 */
export const maxDuration = 60

export default async function ResumeEditorPage({ params, searchParams }: Props) {
  const session = await auth()
  if (!session?.user) redirect("/sign-in")

  const { id } = await params
  const { jobId } = await searchParams

  const resume = await prisma.resume.findUnique({
    where: { id, userId: session.user.id },
    include: {
      sections: {
        where: { visible: true },
        orderBy: { order: "asc" },
        include: {
          items: { orderBy: { order: "asc" } },
        },
      },
      // Named in the editor header beside the kind badge.
      roleFamily: { select: { name: true } },
      // Lineage for the header's "From ..." line. Written only by the owner-
      // checked create actions, so the source is the same user's resume.
      sourceResume: { select: { id: true, title: true, status: true } },
    },
  })

  // Archived resumes are soft-deleted: treat them exactly like a missing row.
  if (!resume || resume.status === "ARCHIVED") notFound()

  const [latestAnalysis, latestExport, jobApplications] = await Promise.all([
    prisma.aTSAnalysis.findFirst({
      where: { resumeId: id, userId: session.user.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.resumeExport.findFirst({
      where: { resumeId: id, userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { templateUrls: true, version: true, createdAt: true },
    }).catch(() => null),
    prisma.jobApplication.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        job: { select: { companyName: true, title: true, description: true } },
      },
    }),
  ])

  // Only the *availability* of a stored job description reaches the client; the
  // text itself is fetched on demand by `getJobDescriptionForResume`. The
  // posting fields come off the `job` relation; the option shape is unchanged.
  const jobOptions = jobApplications.map((application) => ({
    id: application.id,
    companyName: application.job.companyName,
    jobTitle: application.job.title,
    hasJobDescription: !!application.job.description?.trim(),
  }))

  // A deep-link only prefills when it points at a job this user owns that
  // actually has a description to load.
  const initialJobId = jobOptions.some((job) => job.id === jobId && job.hasJobDescription)
    ? jobId
    : undefined

  // A JOB_TAILORED resume keeps its `jobApplicationId`, so the editor can offer
  // the way back to the job it was made for. The title comes off the options
  // already fetched above rather than a second query; the list is scoped to this
  // user, so an id that is not in it does not resolve.
  //
  // Any other resume opened from a job (`?jobId=`) gets the same way back to
  // that job. It resolves against the same user-scoped options, so a foreign or
  // unknown id silently yields no link rather than an error.
  const linkedJobId =
    resume.jobApplicationId ?? (resume.variant !== "JOB_TAILORED" ? jobId : undefined)
  const linkedJobOption = linkedJobId
    ? jobOptions.find((job) => job.id === linkedJobId)
    : undefined
  const linkedJob = linkedJobOption
    ? { id: linkedJobOption.id, title: linkedJobOption.jobTitle }
    : null

  const storedSuggestions = latestAnalysis?.suggestions as unknown as
    | ATSSuggestion[]
    | { items?: ATSSuggestion[]; missingKeywords?: string[] }
    | undefined
  const suggestions = Array.isArray(storedSuggestions)
    ? storedSuggestions
    : storedSuggestions?.items ?? []
  const missingKeywords = Array.isArray(storedSuggestions)
    ? []
    : storedSuggestions?.missingKeywords ?? []

  // Only provide export data if template URLs are available. Rows written
  // before commit d5f65ff can still hold legacy absolute blob URLs, so this
  // strips anything that isn't the current same-origin /api/exports shape —
  // see `sanitizeTemplateUrls`.
  const sanitizedTemplateUrls = sanitizeTemplateUrls(latestExport?.templateUrls)
  const initialExport: LastExport | null = sanitizedTemplateUrls
    ? { templateUrls: sanitizedTemplateUrls }
    : null

  // Staleness is client state, so a reload has to be told about it. `save`
  // stamps `resume.updatedAt` while `generateResume` writes the resume first and
  // only creates the export row after rendering all four templates — so a fresh
  // export always carries the later timestamp and reads as current.
  const initialStale =
    !!initialExport && !!latestExport && resume.updatedAt > latestExport.createdAt

  const data: ResumeData = {
    id: resume.id,
    title: resume.title,
    targetRole: resume.targetRole,
    targetCompany: resume.targetCompany,
    template: resume.template,
    atsScore: resume.atsScore,
    variant: resume.variant,
    roleFamilyName: resume.roleFamily?.name ?? null,
    sourceResume: resume.sourceResume ?? null,
    // Only a master that records its Career Profile says so; legacy masters
    // carry no origin and show nothing.
    origin: resume.variant === "MASTER" && resume.careerProfileId ? "profile" : null,
    jobDescription: latestAnalysis?.jobDescription ?? null,
    latestAnalysisOutdated: latestAnalysis
      ? isAnalysisOutdated(resume.updatedAt, latestAnalysis.createdAt)
      : false,
    latestAnalysis: latestAnalysis
      ? {
          overallScore: latestAnalysis.overallScore,
          scores: latestAnalysis.scores as unknown as ATSScores,
          issues: latestAnalysis.issues as unknown as ATSIssue[],
          suggestions,
          missingKeywords,
          // Read off the persisted column, so the label survives a reload.
          mode: analysisModeFromDb(latestAnalysis.mode),
        }
      : null,
    sections: resume.sections.map((s) => ({
      id: s.id,
      resumeId: s.resumeId,
      type: s.type,
      title: s.title,
      order: s.order,
      visible: s.visible,
      items: s.items.map((item) => ({
        id: item.id,
        sectionId: item.sectionId,
        content: item.content as Record<string, unknown>,
        metadata: item.metadata as Record<string, unknown> | null,
        order: item.order,
      })),
    })),
  }

  return (
    // The editor is a full-height split-pane surface, so it does not use
    // `PageShell` (which adds vertical rhythm it does not want) and it is not
    // held to the `max-w-6xl` measure the other routes share: it is the one
    // full-bleed route, so a wide display goes to the document instead of to
    // empty gutters. The negative margin cancels `main`'s own `p-4 lg:p-6`
    // ((app)/layout.tsx) — each pane supplies its own padding instead, which is
    // also what lets the split reach the viewport edges.
    <div className="-m-4 lg:-m-6">
      <ResumeEditor
        resume={data}
        initialExport={initialExport}
        initialStale={initialStale}
        jobOptions={jobOptions}
        initialJobId={initialJobId}
        linkedJob={linkedJob}
      />
    </div>
  )
}
