"use client"

import Link from "next/link"
import { Badge } from "@/shared/ui/badge"
import { objectValue, readable, safeSourceUrl } from "../client/presentation"
import type { JsonValue, WorkflowStepDTO } from "../types"

const OMITTED = new Set(["resumeId", "tailoredResumeId", "submissionAttemptId", "jobApplicationId", "jobId", "sourceResumeId", "snapshotHash", "tailoringRunId", "manual", "completedBy"])
const LABELS: Record<string, string> = {
  atsFields: "Known profile facts", fields: "Known profile facts", preparedFieldCount: "Known profile facts",
  needsUserAnswer: "Questions for you", resumeExportReady: "Resume PDF exported", validated: "Evidence check recorded",
  coverage: "Known-data coverage (0–1)", score: "Composite score (0–100)", lexicalScore: "BM25 relevance",
  fitScore: "Factor score (0–100)", submitted: "Application submitted", scheduled: "Reminder scheduled", sent: "Message sent",
}

function fieldLabel(key: string) {
  return LABELS[key] || readable(key.replace(/([a-z])([A-Z])/g, "$1 $2"))
}

function Value({ value, field = "", depth = 0 }: { value: JsonValue; field?: string; depth?: number }) {
  if (value === null) return <span className="text-muted-foreground">Not recorded</span>
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>
  if (typeof value === "string" || typeof value === "number") {
    const href = /url/i.test(field) ? safeSourceUrl(value) : null
    return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-brand-400 underline underline-offset-4">{value}</a> : <span className="whitespace-pre-wrap break-words">{String(value)}</span>
  }
  if (depth > 3) return <span className="text-muted-foreground">Additional recorded details available in the saved artifact.</span>
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">None recorded</span>
    return <ul className="space-y-2">{value.map((item, index) => <li key={index} className="min-w-0"><Value value={item} depth={depth + 1} /></li>)}</ul>
  }
  return <dl className="space-y-2">{Object.entries(value).filter(([key]) => !OMITTED.has(key)).map(([key, item]) => <div key={key} className="min-w-0"><dt className="text-xs text-muted-foreground">{fieldLabel(key)}</dt><dd className="mt-0.5 min-w-0"><Value value={item} field={key} depth={depth + 1} /></dd></div>)}</dl>
}

export function WorkflowOutput({ step, applicationId }: { step: WorkflowStepDTO; applicationId: string | null }) {
  const output = objectValue(step.output)
  const resumeId = typeof output.resumeId === "string" ? output.resumeId : typeof output.tailoredResumeId === "string" ? output.tailoredResumeId : null
  const attemptId = typeof output.submissionAttemptId === "string" ? output.submissionAttemptId : null
  return <div className="min-w-0 space-y-4">
    {output.manual === true && <p className="text-sm">Marked done by you. This checklist action did not run a service, save a document, or submit an application.</p>}
    {step.name === "PREPARE_ATS" && <p className="rounded-md bg-muted p-3 text-sm">Employer form has not been scanned. These are known profile facts and questions, not filled employer fields or uploaded files.</p>}
    {(step.name === "TAILOR" || step.name === "HUMAN_REVIEW") && resumeId && <p className="text-sm text-muted-foreground">This draft is not automatically selected for your application. Review it before choosing which resume to use.</p>}
    {attemptId && <p className="text-sm"><Badge variant="warning">Nothing submitted</Badge> <Link className="ml-2 text-brand-400 underline underline-offset-4" href={applicationId ? `/jobs/${encodeURIComponent(applicationId)}#track` : "/planner"}>Open staged application</Link></p>}
    {resumeId && <Link className="inline-flex min-h-11 items-center text-sm font-medium text-brand-400 underline underline-offset-4" href={`/resumes/${encodeURIComponent(resumeId)}`}>Review tailored resume</Link>}
    {step.output === null ? <p className="text-sm text-muted-foreground">{step.status === "PENDING" ? "Waiting to run. No output recorded." : "No output recorded for this step."}</p> : <div className="text-sm"><Value value={step.output} /></div>}
  </div>
}
