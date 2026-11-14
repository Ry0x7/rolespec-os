import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { buttonVariants } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { cn } from "@/shared/lib/utils"
import { jobDetailHref } from "@/features/jobs/lib/job-detail-href"

interface ResolveNextActionInput {
  hasProfile: boolean
  resumeCount: number
  applicationCount: number
  /** Applications still sitting at `INTERESTED` — saved but not yet decided on. */
  interestedCount: number
  /**
   * A workflow-staged package waiting for the owner to submit it on the
   * employer's site. Ranked above undecided jobs: the preparation is already
   * paid for and the posting can close.
   */
  stagedAttempt?: { jobApplicationId: string; companyName: string | null; jobTitle: string | null }
  /**
   * Live applications whose scheduled follow-up date has already passed. Ranked
   * above undecided saved jobs: a sent application going cold is a commitment
   * already made, and it expires.
   */
  followUpDueCount: number
  /**
   * The best-ranked saved job (first row of the dashboard's decide queue). When
   * present, the decide action names and links that one job instead of the list.
   */
  topDecide?: { id: string; companyName: string; jobTitle: string; reason: string }
  /**
   * The first past interview with no outcome logged (first row of the
   * dashboard's "Interview outcomes" group). Ranked below a due follow-up and
   * above deciding on saved jobs, the same order Needs Attention lists them.
   */
  topAwaitingOutcome?: { id: string; companyName: string; daysSince: number }
  /**
   * `daysOverdue` of the most overdue follow-up (first row of the dashboard's
   * "Follow-ups due" group); 0 = due today. Without it the copy stays generic.
   */
  topFollowUpDaysOverdue?: number
}

export interface NextAction {
  title: string
  description: string
  href: string
  cta: string
}

/**
 * The one thing to do next, in a fixed order: build the profile, then a resume,
 * then find jobs, then finish anything the agent already prepared, then chase
 * the applications already sent, then log a past interview's outcome, then
 * decide on the ones still saved. Deterministic and separate from the markup so
 * the rule is testable — no AI, no scoring.
 */
export function resolveNextAction({
  hasProfile,
  resumeCount,
  applicationCount,
  interestedCount,
  stagedAttempt,
  followUpDueCount,
  topDecide,
  topAwaitingOutcome,
  topFollowUpDaysOverdue,
}: ResolveNextActionInput): NextAction {
  if (!hasProfile) {
    return {
      title: "Set up your career profile",
      description:
        "Resumes, job matches and applications all start from these details.",
      href: "/career-profile",
      cta: "Open career profile",
    }
  }

  if (resumeCount === 0) {
    return {
      title: "Create your first resume",
      description: "Start from your career profile, then make a version for each job.",
      href: "/resumes",
      cta: "Create a resume",
    }
  }

  if (applicationCount === 0) {
    return {
      title: "Find jobs worth applying to",
      description: "We look for roles that fit your career details and goals.",
      href: "/jobs/discover",
      cta: "Discover jobs",
    }
  }

  if (stagedAttempt) {
    const role = [stagedAttempt.companyName, stagedAttempt.jobTitle]
      .filter((value): value is string => Boolean(value && value.trim()))
      .join(" — ")
    return {
      title: role ? `Finish applying — ${role}` : "Finish your prepared application",
      description:
        "The agent prepared the resume and answers. Submit it on the employer’s site, then confirm what happened.",
      href: jobDetailHref(stagedAttempt.jobApplicationId, "track"),
      cta: "Finish application",
    }
  }

  if (followUpDueCount > 0) {
    return {
      title:
        followUpDueCount === 1
          ? "Follow up on 1 application"
          : `Follow up on ${followUpDueCount} applications`,
      // Same day wording as the Needs Attention row; a follow-up dated today
      // is due, not past.
      description:
        topFollowUpDaysOverdue === undefined
          ? "The follow-up date has passed — send the nudge."
          : topFollowUpDaysOverdue <= 0
            ? "Due today — send the nudge."
            : topFollowUpDaysOverdue === 1
              ? "1 day overdue — send the nudge."
              : `${topFollowUpDaysOverdue} days overdue — send the nudge.`,
      // Deep link, not bare /jobs: the list opens filtered to the overdue rows,
      // so the count above is immediately actionable.
      href: "/jobs?filter=follow-up-due",
      cta: "Review applications",
    }
  }

  if (topAwaitingOutcome) {
    const { daysSince } = topAwaitingOutcome
    return {
      title: `Log the interview outcome — ${topAwaitingOutcome.companyName}`,
      description:
        daysSince === 1 ? "Interview was 1 day ago" : `Interview was ${daysSince} days ago`,
      href: jobDetailHref(topAwaitingOutcome.id, "track"),
      cta: "Open job",
    }
  }

  if (interestedCount > 0) {
    if (topDecide) {
      const othersWaiting = interestedCount - 1
      return {
        title: `Decide on ${topDecide.companyName} — ${topDecide.jobTitle}`,
        description:
          othersWaiting > 0
            ? `${topDecide.reason} · ${othersWaiting} more waiting`
            : topDecide.reason,
        href: jobDetailHref(topDecide.id, "decide"),
        cta: "Open job",
      }
    }
    return {
      title:
        interestedCount === 1
          ? "Decide on 1 saved job"
          : `Decide on ${interestedCount} saved jobs`,
      description: "Apply, tailor a resume, or drop it — do not let it sit.",
      href: "/jobs",
      cta: "Review saved jobs",
    }
  }

  return {
    title: "Look for more jobs",
    description: "Nothing is waiting on you. Find a few more roles worth a look.",
    href: "/jobs/discover",
    cta: "Discover more jobs",
  }
}

/**
 * Single next-action row on the dashboard. The checklist below it reports
 * progress; this says what to do now.
 */
export function NextActionCard({ action }: { action: NextAction }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-6">
      <div className="min-w-0 flex-1">
        <Badge variant="brand" size="sm" className="uppercase tracking-wide">
          Next step
        </Badge>
        <h2 className="mt-1 break-words text-base font-semibold text-foreground">
          {action.title}
        </h2>
        <p className="mt-1 break-words text-sm text-muted-foreground">{action.description}</p>
      </div>

      <Link
        href={action.href}
        className={cn(
          buttonVariants({ size: "sm" }),
          "shrink-0 self-start sm:self-auto"
        )}
      >
        {action.cta}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  )
}
