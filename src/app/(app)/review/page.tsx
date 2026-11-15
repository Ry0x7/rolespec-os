import { PageShell } from "@/shared/components/page-shell"
import { ReviewWorkspace, type ReviewSection } from "@/features/review/components/review-workspace"

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ section?: string; task?: string }> }) {
  const query = await searchParams
  const section: ReviewSection = query.section === "profile" || query.section === "memory" ? query.section : "questions"
  return <PageShell><ReviewWorkspace initialSection={section} initialTaskId={query.task} /></PageShell>
}
