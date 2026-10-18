import { redirect } from "next/navigation"
import Link from "next/link"
import { FileText, Plus } from "lucide-react"
import { auth } from "@/features/auth/config"
import { prisma } from "@/shared/lib/prisma"
import { buttonVariants } from "@/shared/ui/button"
import { EmptyState } from "@/shared/components/empty-state"
import { CoverLetterList } from "@/features/jobs/components/cover-letter-list"
import { PageShell } from "@/shared/components/page-shell"

export default async function CoverLettersPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  const coverLetters = await prisma.coverLetter.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      content: true,
      resume: { select: { title: true } },
      jobApplication: {
        select: { id: true, job: { select: { companyName: true, title: true } } },
      },
    },
  })

  // The posting lives on `Job` now; flattened here so the card gets the
  // application id (for the link to the job) beside the labels. Only the
  // excerpt crosses to the client, never the full letter.
  const items = coverLetters.map(({ jobApplication, content, ...cl }) => ({
    ...cl,
    jobApplication: jobApplication && {
      id: jobApplication.id,
      companyName: jobApplication.job.companyName,
      jobTitle: jobApplication.job.title,
    },
    contentExcerpt: content.slice(0, 120),
  }))

  return (
    <PageShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cover Letters</h1>
          <p className="text-sm text-muted-foreground">
            Letters you have generated, newest first
          </p>
        </div>
        <Link
          href="/jobs/cover-letter/new"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          New Cover Letter
        </Link>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No cover letters yet"
          description="Generate one from your resume and we will tailor it to the job."
          action={
            <Link
              href="/jobs/cover-letter/new"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New Cover Letter
            </Link>
          }
        />
      ) : (
        <CoverLetterList coverLetters={items} />
      )}
    </PageShell>
  )
}
