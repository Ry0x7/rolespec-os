import type { Metadata } from "next"

import { getLinkedinData } from "@/features/linkedin/actions/get-linkedin-data.action"
import { LinkedinView } from "@/features/linkedin/components/linkedin-view"
import { requireUser } from "@/features/auth/guards"
import { prisma } from "@/shared/lib/prisma"
import { PageShell } from "@/shared/components/page-shell"

export const metadata: Metadata = {
  title: "LinkedIn",
  description:
    "Rate your LinkedIn profile against your resume and turn the gaps into concrete rewrites.",
}

export const dynamic = "force-dynamic"

/**
 * LinkedIn workspace.
 *
 * The view, routes and services already existed but the route itself answered
 * 404, so the whole feature was unreachable from the app. This page is the
 * missing composition point: the latest persisted rating/suggestions plus the
 * caller's own resumes for the optional rating context.
 */
export default async function LinkedinPage() {
  const session = await requireUser()

  const [{ data }, resumes] = await Promise.all([
    getLinkedinData(),
    prisma.resume.findMany({
      where: { userId: session.user.id, status: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, atsScore: true },
    }),
  ])

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl font-bold">LinkedIn</h1>
        <p className="text-sm text-muted-foreground">
          Rate your profile against your resume, then rewrite the sections that
          hiring managers actually read.
        </p>
      </div>

      {data ? (
        <LinkedinView
          initialLinkedin={data.linkedin}
          initialLinkedinSuggestions={data.linkedinSuggestions}
          resumeOptions={resumes}
        />
      ) : (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          LinkedIn data could not be loaded. Reload the page and try again.
        </p>
      )}
    </PageShell>
  )
}
