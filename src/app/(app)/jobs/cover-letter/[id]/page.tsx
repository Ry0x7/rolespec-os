import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { buttonVariants } from "@/shared/ui/button"
import { CoverLetterEditor } from "@/features/jobs/components/cover-letter-editor"
import type { CoverLetterSuggestions } from "@/features/jobs/components/cover-letter-suggestions-panel"
import { PageShell } from "@/shared/components/page-shell"

interface Props {
  params: Promise<{ id: string }>
}

export default async function CoverLetterDetailPage({ params }: Props) {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const { id } = await params

  const coverLetter = await prisma.coverLetter.findUnique({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      content: true,
      jobDescription: true,
      suggestions: true,
      resume: { select: { title: true } },
      jobApplication: {
        select: { id: true, job: { select: { companyName: true, title: true } } },
      },
    },
  })

  if (!coverLetter) notFound()

  const suggestions = coverLetter.suggestions as CoverLetterSuggestions | null
  // The posting lives on `Job` now; flattened here so the editor gets the
  // application id (for the link back to the job) beside the labels.
  const { jobApplication, ...rest } = coverLetter
  const detail = {
    ...rest,
    suggestions,
    jobApplication: jobApplication && {
      id: jobApplication.id,
      companyName: jobApplication.job.companyName,
      jobTitle: jobApplication.job.title,
    },
  }

  return (
    <PageShell>
      <Link
        href="/jobs/cover-letter"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        ← Cover Letters
      </Link>
      <CoverLetterEditor coverLetter={detail} />
    </PageShell>
  )
}
