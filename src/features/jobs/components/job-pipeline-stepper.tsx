"use client"

import {
  UserCheck,
  Sparkles,
  Building2,
  FileText,
  Mail,
  ShieldCheck,
  CheckCircle2,
  Clock,
  BellRing,
} from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { Badge } from "@/shared/ui/badge"

export interface PipelineStepState {
  id: string
  label: string
  shortDesc: string
  status: "complete" | "current" | "pending"
  href?: string
  icon: React.ComponentType<{ className?: string }>
}

export interface PipelineEvidence {
  jobApplicationId: string
  status: string
  hasCareerProfile: boolean
  hasQualification: boolean
  hasCompanyResearch: boolean
  hasTailoredResume: boolean
  hasCoverLetter: boolean
  hasMatchScore: boolean
  hasApplied: boolean
  /** The application has actually moved past "applied" in the tracker. */
  hasTracking: boolean
  hasFollowUp: boolean
  hasFollowedUp: boolean
  isFollowUpDue: boolean
  chosenResumeId?: string | null
}

type Props = PipelineEvidence

/**
 * Builds the eight stages from evidence that was actually persisted.
 *
 * Status is sequential on purpose: a completed stage only counts when every
 * stage before it is complete too, and the first gap is the one `current`
 * stage. The old version marked profile complete unconditionally and let
 * tracking stay current forever, so the bar could show three "current" stages
 * and a completion percentage that did not describe the application.
 */
export function buildPipelineSteps(evidence: PipelineEvidence): PipelineStepState[] {
  const completed = [
    evidence.hasCareerProfile,
    evidence.hasQualification || evidence.hasMatchScore,
    evidence.hasCompanyResearch,
    evidence.hasTailoredResume,
    evidence.hasCoverLetter,
    evidence.hasApplied,
    // Applying starts tracking; the stage is done once the record has actually
    // moved. Marking it complete on `hasApplied` made stage 6 and 7 the same
    // fact, so the bar claimed progress the tracker never recorded.
    evidence.hasTracking,
    // Scheduling a future chase is preparation, not completion. The stage is
    // done only once a follow-up has actually been logged.
    evidence.hasFollowedUp,
  ]

  const firstIncomplete = completed.findIndex((done) => !done)
  // No gap means every stage is done. The old fallback pointed at the last
  // stage and reported 7 of 8 forever, which is why a finished application
  // could never read as finished.
  const allComplete = firstIncomplete === -1
  const currentIndex = allComplete ? -1 : firstIncomplete

  const stageStatus = (index: number): PipelineStepState["status"] => {
    if (allComplete || index < currentIndex) return "complete"
    if (index === currentIndex) return "current"
    return "pending"
  }

  const resumeHref = evidence.chosenResumeId
    ? `/resumes/${evidence.chosenResumeId}?jobId=${evidence.jobApplicationId}`
    : "#prepare"

  return [
    {
      id: "profile",
      label: "1. Career Profile",
      shortDesc: evidence.hasCareerProfile ? "Profile evidence saved" : "Add profile evidence",
      status: stageStatus(0),
      href: "/career-profile",
      icon: UserCheck,
    },
    {
      id: "discovery",
      label: "2. Rank & Match",
      shortDesc:
        evidence.hasMatchScore
          ? "Match analyzed"
          : evidence.hasQualification
            ? "Qualification saved"
            : "Rank the opportunity",
      status: stageStatus(1),
      href: "#decide",
      icon: Sparkles,
    },
    {
      id: "research",
      label: "3. Company Research",
      shortDesc: evidence.hasCompanyResearch ? "Verified sources saved" : "Research the company",
      status: stageStatus(2),
      href: "#research",
      icon: Building2,
    },
    {
      id: "resume",
      label: "4. Resume Tailoring",
      shortDesc: evidence.hasTailoredResume ? "Tailored resume ready" : "Tailor from evidence",
      status: stageStatus(3),
      href: resumeHref,
      icon: FileText,
    },
    {
      id: "materials",
      label: "5. Application Prep",
      shortDesc: evidence.hasCoverLetter ? "Cover letter drafted" : "Cover letter / email",
      status: stageStatus(4),
      href: "#prepare",
      icon: Mail,
    },
    {
      id: "review",
      label: "6. Review & Apply",
      shortDesc: evidence.hasApplied ? "Application submitted" : "Review and submit",
      status: stageStatus(5),
      href: "#prepare",
      icon: ShieldCheck,
    },
    {
      id: "tracking",
      label: "7. Tracking",
      shortDesc: evidence.hasApplied
        ? evidence.hasTracking
          ? `Status: ${evidence.status.toLowerCase()}`
          : "Applied — awaiting a move"
        : "Track the application",
      status: stageStatus(6),
      href: "#track",
      icon: Clock,
    },
    {
      id: "followup",
      label: "8. Follow-up",
      shortDesc: evidence.isFollowUpDue
        ? "Follow-up due"
        : evidence.hasFollowedUp
          ? "Follow-up logged"
          : evidence.hasFollowUp
            ? "Follow-up scheduled"
            : "Set a follow-up",
      status: stageStatus(7),
      href: "#track",
      icon: BellRing,
    },
  ]
}

export function JobPipelineStepper(props: Props) {
  const steps = buildPipelineSteps(props)
  const completedCount = steps.filter((step) => step.status === "complete").length
  const progressPct = Math.round((completedCount / steps.length) * 100)

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span>Unified Job Application Pipeline</span>
            <Badge variant="outline" className="text-xs font-normal">
              {progressPct}% complete
            </Badge>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Profile → Match → Research → Tailor → Prepare → Review → Track → Follow-up
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {completedCount} of {steps.length} stages complete
          </span>
          <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-3">
        {steps.map((step) => {
          const Icon = step.icon
          const isComplete = step.status === "complete"
          const isCurrent = step.status === "current"

          return (
            <a
              key={step.id}
              href={step.href ?? "#prepare"}
              aria-current={isCurrent ? "step" : undefined}
              aria-label={`${step.label}: ${step.status}`}
              className={cn(
                "group relative flex flex-col justify-between rounded-lg border p-2.5 transition-all hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                isComplete && "border-emerald-500/30 bg-emerald-500/5",
                isCurrent && "border-primary bg-primary/5 ring-1 ring-primary/20",
                step.status === "pending" && "border-border/60 opacity-70"
              )}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-md text-xs",
                    isComplete && "bg-emerald-500 text-white",
                    isCurrent && "bg-primary text-primary-foreground",
                    step.status === "pending" && "bg-muted text-muted-foreground"
                  )}
                >
                  {isComplete ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                </div>
                {isCurrent && <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />}
              </div>
              <div className="mt-1">
                <p className="text-xs font-medium text-foreground line-clamp-1">{step.label}</p>
                <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                  {step.shortDesc}
                </p>
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}
