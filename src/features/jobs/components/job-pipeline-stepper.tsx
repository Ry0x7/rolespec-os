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

interface Props {
  jobApplicationId: string
  status: string
  hasQualification: boolean
  hasCompanyResearch: boolean
  hasTailoredResume: boolean
  hasCoverLetter: boolean
  hasMatchScore: boolean
  hasFollowUp: boolean
  isFollowUpDue: boolean
  chosenResumeId?: string | null
}

export function JobPipelineStepper({
  jobApplicationId,
  status,
  hasQualification,
  hasCompanyResearch,
  hasTailoredResume,
  hasCoverLetter,
  hasMatchScore,
  hasFollowUp,
  isFollowUpDue,
  chosenResumeId,
}: Props) {
  const isAppliedOrBeyond = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"].includes(status)

  const steps: PipelineStepState[] = [
    {
      id: "profile",
      label: "1. Career Profile",
      shortDesc: "Confirmed evidence",
      status: "complete",
      href: "/profile",
      icon: UserCheck,
    },
    {
      id: "discovery",
      label: "2. Rank & Match",
      shortDesc: hasMatchScore ? "Match analyzed" : hasQualification ? "Qualified" : "Awaiting match",
      status: hasMatchScore || hasQualification ? "complete" : "current",
      href: "#match",
      icon: Sparkles,
    },
    {
      id: "research",
      label: "3. Company Research",
      shortDesc: hasCompanyResearch ? "Verified citations" : "Research role",
      status: hasCompanyResearch ? "complete" : hasQualification ? "current" : "pending",
      href: "#research",
      icon: Building2,
    },
    {
      id: "resume",
      label: "4. Resume Tailoring",
      shortDesc: hasTailoredResume ? "Tailored resume ready" : "Tailor from evidence",
      status: hasTailoredResume ? "complete" : hasCompanyResearch ? "current" : "pending",
      href: chosenResumeId ? `/resumes/${chosenResumeId}?jobId=${jobApplicationId}` : "#resume",
      icon: FileText,
    },
    {
      id: "materials",
      label: "5. Application Prep",
      shortDesc: hasCoverLetter ? "Materials drafted" : "Cover letter / Email",
      status: hasCoverLetter ? "complete" : hasTailoredResume ? "current" : "pending",
      href: "#outreach",
      icon: Mail,
    },
    {
      id: "review",
      label: "6. Review & Autofill",
      shortDesc: isAppliedOrBeyond ? "Application reviewed" : "Extension review queue",
      status: isAppliedOrBeyond ? "complete" : hasTailoredResume ? "current" : "pending",
      href: "#tasks",
      icon: ShieldCheck,
    },
    {
      id: "tracking",
      label: "7. Tracking",
      shortDesc: `Status: ${status.toLowerCase()}`,
      status: isAppliedOrBeyond ? "complete" : "current",
      href: "#timeline",
      icon: Clock,
    },
    {
      id: "followup",
      label: "8. Follow-up",
      shortDesc: isFollowUpDue ? "Action due today!" : hasFollowUp ? "Follow-up scheduled" : "Set schedule",
      status: hasFollowUp && !isFollowUpDue ? "complete" : isAppliedOrBeyond ? "current" : "pending",
      href: "#outreach",
      icon: BellRing,
    },
  ]

  const completedCount = steps.filter((s) => s.status === "complete").length
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
            Single connected workflow: Profile → Match → Research → Tailor → Apply → Review → Track → Follow-up.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{completedCount} of {steps.length} stages ready</span>
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
              href={step.href ?? "#"}
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
                  {isComplete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </div>
                {isCurrent && (
                  <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
                )}
              </div>
              <div className="mt-1">
                <p className="text-xs font-medium text-foreground line-clamp-1">{step.label}</p>
                <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{step.shortDesc}</p>
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}
