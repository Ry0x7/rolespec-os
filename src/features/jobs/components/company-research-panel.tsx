"use client"

import { useState, useTransition } from "react"
import { Building2, CheckCircle2, ExternalLink, Globe, Loader2, Sparkles, Tag, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import type { CompanyResearchResult } from "../services/company-research.service"
import { isSourceCheckedResearch, isVerifiedCompanyResearch } from "../lib/company-research"
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

  const verified = research ? isVerifiedCompanyResearch(research) : false
  // A fresh run that fetched nothing is not the same as a legacy row written
  // before source checking existed. Keep those two review states apart.
  const sourceChecked = research ? isSourceCheckedResearch(research) : false
  const legacy = Boolean(research && !sourceChecked)

  // Facts in a row written before citations were fetched were never checked
  // against a source. Showing them under an "Unverified" badge still presents
  // guesses as company facts, so the factual blocks are withheld until the
  // research is re-run and its sources are actually fetched.
  const showVerifiedFacts = Boolean(research && verified)
  // Rows are persisted JSON. A legacy or partially written row may not carry
  // every list, so render from safe copies rather than crashing the page.
  const citations = research?.citations ?? []
  const techStack = research?.techStack ?? []
  const keyProducts = research?.keyProducts ?? []
  const missionOrValues = research?.statedMissionOrValues ?? []
  const interviewTips = research?.interviewTips ?? []

  const confidenceBadge = (confidence: "HIGH" | "MEDIUM" | "LOW") => {
    // Legacy rows can carry a HIGH written before sources were fetched. Never
    // dress that up as verified today.
    if (legacy) return <Badge variant="neutral">Unverified / Legacy</Badge>
    // A high model-written label cannot stand in for a source that was never
    // fetched. The panel says what is actually known.
    if (!verified) return <Badge variant="neutral">No verified sources</Badge>
    switch (confidence) {
      case "HIGH":
        return <Badge variant="success">High Confidence</Badge>
      case "MEDIUM":
        return <Badge variant="warning">Medium Confidence</Badge>
      case "LOW":
        return <Badge variant="neutral">Low Confidence</Badge>
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
            {legacy && (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Saved research is unverified</p>
                <p className="mt-1">
                  This result predates source verification. Company facts are hidden because no
                  fetched source backs them; re-run research to replace them with verified facts.
                </p>
              </div>
            )}

            {sourceChecked && !verified && (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">No verified sources</p>
                <p className="mt-1">
                  Research checked its sources, but none could be fetched and verified. Company
                  facts stay unknown; add the posting link or try again when the source is reachable.
                </p>
              </div>
            )}

            {/* Overview */}
            {showVerifiedFacts && (
            <div className="rounded-md bg-muted/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Overview</p>
              <p className="mt-1 leading-relaxed text-foreground">{research.overview}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  📍 HQ:{" "}
                  <strong className={research.headquarters ? "text-foreground" : "font-normal italic"}>
                    {research.headquarters ?? "Not disclosed in verified sources"}
                  </strong>
                </span>
                <span>
                  🏢 Industry:{" "}
                  <strong className={research.industry ? "text-foreground" : "font-normal italic"}>
                    {research.industry ?? "Not disclosed"}
                  </strong>
                </span>
                <span>
                  👥 Size:{" "}
                  <strong className={research.companySize ? "text-foreground" : "font-normal italic"}>
                    {research.companySize ?? "Not disclosed"}
                  </strong>
                </span>
              </div>
            </div>
            )}

            {/* Tech Stack */}
            {showVerifiedFacts && techStack.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Detected Tech Stack</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {techStack.map((tech) => (
                    <Badge key={tech} variant="neutral" className="text-xs font-normal">
                      <Tag className="mr-1 h-3 w-3 opacity-60" />
                      {tech}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Key Products / Values */}
            {showVerifiedFacts && (keyProducts.length > 0 || missionOrValues.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {keyProducts.length > 0 && (
                  <div className="rounded-md border p-2.5">
                    <p className="text-xs font-semibold text-muted-foreground">Key Products / Services</p>
                    <ul className="mt-1 space-y-1 text-xs list-disc pl-4 text-foreground">
                      {keyProducts.map((p, idx) => (
                        <li key={idx}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {missionOrValues.length > 0 && (
                  <div className="rounded-md border p-2.5">
                    <p className="text-xs font-semibold text-muted-foreground">Stated Mission & Values</p>
                    <ul className="mt-1 space-y-1 text-xs list-disc pl-4 text-foreground">
                      {missionOrValues.map((v, idx) => (
                        <li key={idx}>{v}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Interview Pointers */}
            {showVerifiedFacts && interviewTips.length > 0 && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Interview Focus & Preparation
                </p>
                <ul className="mt-1.5 space-y-1 text-xs list-disc pl-4 text-foreground/90">
                  {interviewTips.map((tip, idx) => (
                    <li key={idx}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Citations & Evidence Grounding */}
            <div className="border-t pt-2.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span className="font-semibold flex items-center gap-1">
                  <ShieldCheck className={verified ? "h-3.5 w-3.5 text-emerald-600" : "h-3.5 w-3.5 text-muted-foreground"} />
                  {verified ? "Verified Citations & Sources" : "Citations & Sources"} ({citations.length})
                </span>
                <span className="text-[11px] italic">
                  {verified
                    ? research.confidenceExplanation
                    : legacy
                      ? "Unverified saved result; cited pages were not fetched when it was written."
                      : "No source could be fetched and verified; unknown company facts stay unknown."}
                </span>
              </div>
              {citations.length > 0 ? (
                <div className="space-y-1.5">
                  {citations.map((cite, idx) => (
                    <div key={idx} className="flex items-baseline justify-between gap-2 text-xs rounded bg-muted/20 px-2 py-1">
                      <a
                        href={cite.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary hover:underline flex items-center gap-1 truncate max-w-[70%]"
                      >
                        <Globe className="h-3 w-3 shrink-0" />
                        {cite.title || cite.url}
                        <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
                      </a>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {cite.quote && (
                          <span className="max-w-[220px] truncate text-[10px] italic text-muted-foreground" title={cite.quote}>
                            &quot;{cite.quote}&quot;
                          </span>
                        )}
                        <Badge
                          variant={cite.verified ? "success" : "neutral"}
                          className="px-1.5 py-0 text-[10px] font-normal"
                        >
                          {cite.verified ? "Verified" : "Unverified"}
                        </Badge>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No source could be fetched and verified. Company facts are shown as unknown.
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
