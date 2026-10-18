import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/features/auth/config"
import { buttonVariants } from "@/shared/ui/button"
import { CoverLetterForm } from "@/features/jobs/components/cover-letter-form"
import { PageShell } from "@/shared/components/page-shell"
import { getCoverLetterFormOptions } from "@/features/jobs/services/cover-letter-form-options"

interface Props {
  searchParams: Promise<{ jobId?: string }>
}

export default async function NewCoverLetterPage({ searchParams }: Props) {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const { jobId } = await searchParams

  // The same loader the Job Detail drawer uses, so both surfaces preselect the
  // same resume and word the hint identically.
  const { resumes, applications, lockedApplication, defaultResumeId, resumeHint } =
    await getCoverLetterFormOptions(session.user.id, jobId)

  return (
    <PageShell>
      {/* Arrived from a job: go back to that job, not to a list the user was
          never on. The list link stays the way back when there is no job. */}
      {lockedApplication ? (
        <Link
          href={`/jobs/${lockedApplication.id}`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          ← Back to job: {lockedApplication.jobTitle}
        </Link>
      ) : (
        <Link
          href="/jobs/cover-letter"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          ← Cover Letters
        </Link>
      )}
      {/* The shell keeps the page width in step with every other route; the
          form itself stays at a single-column measure. */}
      <div className="max-w-2xl">
        <CoverLetterForm
          resumes={resumes}
          applications={applications}
          defaultJobApplicationId={jobId}
          lockedApplication={lockedApplication}
          defaultResumeId={defaultResumeId}
          resumeHint={resumeHint}
        />
      </div>
    </PageShell>
  )
}
