"use client"

import { useState } from "react"
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Sparkles,
  BarChart3,
  ShieldCheck,
  Briefcase,
  DollarSign,
  MapPin,
  Clock,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import type { IntelligentMatchingResult } from "../services/intelligent-matching.service"

interface Props {
  matchingResult: IntelligentMatchingResult
}

export function IntelligentMatchingCard({ matchingResult }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { compositeScore, priority, summary, dimensions, strengths, gaps } = matchingResult

  const priorityBadge = () => {
    switch (priority) {
      case "HIGH":
        return <Badge variant="success">High Priority</Badge>
      case "MODERATE":
        return <Badge variant="info">Moderate Match</Badge>
      case "LOW":
        return <Badge variant="warning">Low Priority</Badge>
      case "INELIGIBLE":
        return <Badge variant="error">Ineligible / Blocker</Badge>
    }
  }

  const dimensionIcon = (key: string) => {
    switch (key) {
      case "eligibility":
        return <ShieldCheck className="h-4 w-4 text-primary" />
      case "skills":
        return <Sparkles className="h-4 w-4 text-primary" />
      case "evidence":
        return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      case "experience":
        return <Briefcase className="h-4 w-4 text-primary" />
      case "locationAndWorkMode":
        return <MapPin className="h-4 w-4 text-primary" />
      case "salary":
        return <DollarSign className="h-4 w-4 text-primary" />
      case "freshness":
        return <Clock className="h-4 w-4 text-primary" />
      default:
        return <BarChart3 className="h-4 w-4 text-primary" />
    }
  }

  const statusBadge = (status: "GOOD" | "NEUTRAL" | "CONCERN" | "BLOCKED") => {
    switch (status) {
      case "GOOD":
        return <span className="inline-flex items-center text-xs font-medium text-emerald-600 dark:text-emerald-400 gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Aligned</span>
      case "NEUTRAL":
        return <span className="inline-flex items-center text-xs font-medium text-muted-foreground gap-1"><HelpCircle className="h-3.5 w-3.5" /> Neutral</span>
      case "CONCERN":
        return <span className="inline-flex items-center text-xs font-medium text-amber-600 dark:text-amber-400 gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Gap</span>
      case "BLOCKED":
        return <span className="inline-flex items-center text-xs font-medium text-destructive gap-1"><XCircle className="h-3.5 w-3.5" /> Blocker</span>
    }
  }

  return (
    <Card id="match-analysis" className="border-border">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <CardTitle className="text-base font-semibold">Intelligent Multi-Factor Matching</CardTitle>
          {priorityBadge()}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-foreground">{compositeScore}%</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-8 px-2 text-xs text-muted-foreground"
          >
            {expanded ? (
              <>
                Less <ChevronUp className="h-3.5 w-3.5 ml-1" />
              </>
            ) : (
              <>
                Score Breakdown <ChevronDown className="h-3.5 w-3.5 ml-1" />
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">{summary}</p>

        {/* Strengths and Gaps Quick Chips */}
        <div className="grid gap-2 sm:grid-cols-2 text-xs">
          {strengths.length > 0 && (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2.5">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Key Strengths
              </p>
              <ul className="space-y-1 list-disc pl-4 text-foreground/85">
                {strengths.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {gaps.length > 0 && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
              <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Gaps to Address
              </p>
              <ul className="space-y-1 list-disc pl-4 text-foreground/85">
                {gaps.map((g, idx) => (
                  <li key={idx}>{g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Detailed Factor Breakdown */}
        {expanded && (
          <div className="pt-2 border-t space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Explainable Dimension Scores (Weighted)
            </p>
            <div className="space-y-2.5">
              {Object.entries(dimensions).map(([key, dim]) => (
                <div key={key} className="rounded-md border p-2.5 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                      {dimensionIcon(key)}
                      {dim.label}
                    </span>
                    <div className="flex items-center gap-2">
                      {statusBadge(dim.status)}
                      <span className="font-bold text-foreground">{dim.score}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        dim.status === "GOOD"
                          ? "bg-emerald-500"
                          : dim.status === "BLOCKED"
                            ? "bg-destructive"
                            : dim.status === "CONCERN"
                              ? "bg-amber-500"
                              : "bg-sky-500"
                      }`}
                      style={{ width: `${dim.score}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">{dim.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
