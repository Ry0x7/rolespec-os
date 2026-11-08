"use client"

import { useState, useTransition } from "react"
import { Building2, CheckCircle2, ExternalLink, Globe, Loader2, Sparkles, Tag, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import type { CompanyResearchResult } from "../services/company-research.service"
import { runCompanyResearch } from "../actions/company-research.actions"

interface Props {
  jobApplicationId: string
  companyName: string
  initialResearch?: CompanyResearchResult | null
}

export function CompanyResearchPanel({
  jobApplicationId,
  companyName,
  initialResearch,
}: Props) {
  const [research, setResearch] = useState<CompanyResearchResult | null>(initialResearch ?? null)
  const [isPending, startTransition] = useTransition()

  function handleResearch() {
    startTransition(async () => {
      const res = await runCompanyResearch(jobApplicationId)
      if (res.success) {
        setResearch(res.research)
        toast.success(`Completed research for ${companyName}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  const confidenceBadge = (confidence: "HIGH" | "MEDIUM" | "LOW") => {
    switch (confidence) {
      case "HIGH":
        return <Badge variant="success">High Confidence</Badge>
      case "MEDIUM":
        return <Badge variant="warning">Medium Confidence</Badge>
      case "LOW":
        return <Badge variant="neutral">Unverified / Low</Badge>
    }
  }

  return (
    <Card id="research">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
          <CardTitle className="text-base font-semibold">Company & Role Research</CardTitle>
          {research && confidenceBadge(research.confidence)}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleResearch}
          disabled={isPending}
          className="h-8 gap-1.5 text-xs"
        >
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Researching…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              {research ? "Re-run Research" : `Research ${companyName}`}
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!research ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No factual research generated yet</p>
            <p className="mt-1 text-xs">
              Synthesize factual company overview, tech stack, verified citations, and interview pointers without hallucination.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleResearch}
              disabled={isPending}
              className="mt-3 gap-1.5"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Start Research
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            {/* Overview */}
            <div className="rounded-md bg-muted/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Overview</p>
              <p className="mt-1 leading-relaxed text-foreground">{research.overview}</p>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                {research.headquarters && <span>📍 HQ: <strong className="text-foreground">{research.headquarters}</strong></span>}
                {research.industry && <span>🏢 Industry: <strong className="text-foreground">{research.industry}</strong></span>}
                {research.companySize && <span>👥 Size: <strong className="text-foreground">{research.companySize}</strong></span>}
              </div>
            </div>

            {/* Tech Stack */}
            {research.techStack.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Detected Tech Stack</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {research.techStack.map((tech) => (
                    <Badge key={tech} variant="neutral" className="text-xs font-normal">
                      <Tag className="mr-1 h-3 w-3 opacity-60" />
                      {tech}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Key Products / Values */}
            {(research.keyProducts.length > 0 || research.statedMissionOrValues.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {research.keyProducts.length > 0 && (
                  <div className="rounded-md border p-2.5">
                    <p className="text-xs font-semibold text-muted-foreground">Key Products / Services</p>
                    <ul className="mt-1 space-y-1 text-xs list-disc pl-4 text-foreground">
                      {research.keyProducts.map((p, idx) => (
                        <li key={idx}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {research.statedMissionOrValues.length > 0 && (
                  <div className="rounded-md border p-2.5">
                    <p className="text-xs font-semibold text-muted-foreground">Stated Mission & Values</p>
                    <ul className="mt-1 space-y-1 text-xs list-disc pl-4 text-foreground">
                      {research.statedMissionOrValues.map((v, idx) => (
                        <li key={idx}>{v}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Interview Pointers */}
            {research.interviewTips.length > 0 && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Interview Focus & Preparation
                </p>
                <ul className="mt-1.5 space-y-1 text-xs list-disc pl-4 text-foreground/90">
                  {research.interviewTips.map((tip, idx) => (
                    <li key={idx}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Citations & Evidence Grounding */}
            <div className="border-t pt-2.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span className="font-semibold flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Verified Citations & Sources ({research.citations.length})
                </span>
                <span className="text-[11px] italic">{research.confidenceExplanation}</span>
              </div>
              {research.citations.length > 0 ? (
                <div className="space-y-1.5">
                  {research.citations.map((cite, idx) => (
                    <div key={idx} className="flex items-baseline justify-between text-xs rounded bg-muted/20 px-2 py-1">
                      <a
                        href={cite.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary hover:underline flex items-center gap-1 truncate max-w-[80%]"
                      >
                        <Globe className="h-3 w-3 shrink-0" />
                        {cite.title || cite.url}
                        <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
                      </a>
                      {cite.quote && <span className="text-[10px] text-muted-foreground truncate ml-2 italic">&quot;{cite.quote}&quot;</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No external URLs provided in posting; derived from supplied text.</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
