"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { Badge } from "@/shared/ui/badge"
import { objectValue, readable, safeSourceUrl } from "../client/presentation"
import type { JsonObject, JsonValue, WorkflowStepDTO } from "../types"

const OMITTED = new Set(["resumeId", "tailoredResumeId", "submissionAttemptId", "jobApplicationId", "jobId", "sourceResumeId", "snapshotHash", "tailoringRunId", "manual", "completedBy"])
const LABELS: Record<string, string> = {
  atsFields: "Known profile facts", fields: "Known profile facts", preparedFieldCount: "Known profile facts",
  needsUserAnswer: "Questions for you", resumeExportReady: "Resume PDF ready", validated: "Accuracy check recorded",
  coverage: "How much your profile covers (0–1)", score: "Overall score (0–100)", lexicalScore: "Keyword match",
  fitScore: "Match factor (0–100)", submitted: "Application submitted", scheduled: "Reminder scheduled", sent: "Message marked sent",
}

function fieldLabel(key: string) {
  return LABELS[key] || readable(key.replace(/([a-z])([A-Z])/g, "$1 $2"))
}

const FACTOR_STATES: Record<string, string> = {
  MATCH: "Matches",
  PARTIAL: "Partly matches",
  MISS: "Does not match",
  UNKNOWN: "Not enough information",
}

function textValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringList(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

function objectList(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value)
    ? value.map((item) => objectValue(item)).filter((item) => Object.keys(item).length > 0)
    : []
}

function friendlyDate(value: JsonValue | undefined): string | null {
  const raw = textValue(value)
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
}

function validationLabel(value: JsonValue | undefined): string {
  const status = textValue(value)
  if (status === "PASS") return "Checks passed"
  if (status === "FAIL") return "Checks failed"
  if (status) return "Needs your review"
  return "Not checked"
}

function confidenceLabel(value: JsonValue | undefined): string {
  const confidence = textValue(value)
  if (confidence === "HIGH") return "Strong"
  if (confidence === "MEDIUM") return "Moderate"
  if (confidence === "LOW") return "Limited"
  return confidence ? readable(confidence) : "Not recorded"
}

const APPLICATION_FIELD_LABELS: Record<string, string> = {
  fullName: "Full name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  linkedinUrl: "LinkedIn",
  githubUrl: "GitHub",
  websiteUrl: "Website",
  resumeId: "Resume file",
  jobUrl: "Job posting",
}

function applicationFieldLabel(key: string) {
  return APPLICATION_FIELD_LABELS[key] ?? fieldLabel(key)
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function Stats({ items }: { items: Array<{ label: string; value: string | number }> }) {
  if (items.length === 0) return null
  return <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 sm:grid-cols-4">
    {items.map((item) => <div key={item.label}>
      <dt className="text-xs text-muted-foreground">{item.label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{item.value}</dd>
    </div>)}
  </dl>
}

function FoldedDetails({ title, count, children }: { title: string; count: string; children: ReactNode }) {
  return <details className="rounded-lg border border-border">
    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-sm font-medium">
      <span>{title}</span><span className="text-xs font-normal text-muted-foreground">{count}</span>
    </summary>
    <div className="border-t border-border p-3">{children}</div>
  </details>
}

/**
 * The rank step used to fall through to the generic key/value dump, which
 * printed every factor's raw fields — label, id, state, weight, reason,
 * evidence — as a separate heading and paragraph. Seven factors became several
 * screens of JSON. This shows the score first and folds the evidence away.
 */
function RankResult({ output }: { output: JsonObject }) {
  const score = numberValue(output.score)
  const fitScore = numberValue(output.fitScore)
  const coverage = numberValue(output.coverage)
  const lexicalScore = numberValue(output.lexicalScore)
  const title = textValue(output.title)
  const company = textValue(output.companyName)
  const explanation = Array.isArray(output.explanation)
    ? output.explanation.filter((line): line is string => typeof line === "string")
    : []
  const factors = Array.isArray(output.factors)
    ? output.factors.map((factor) => objectValue(factor)).filter((factor) => Object.keys(factor).length > 0)
    : []

  return <div className="space-y-4">
    {(title || company) && <div>
      {title && <p className="font-medium">{title}</p>}
      {company && <p className="text-sm text-muted-foreground">{company}</p>}
    </div>}
    {score !== null && <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border p-3">
      <div><p className="text-xs text-muted-foreground">Overall match</p><p className="text-2xl font-semibold tabular-nums">{score}<span className="text-sm font-normal text-muted-foreground"> /100</span></p></div>
      <dl className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {fitScore !== null && <div><dt>Profile fit</dt><dd className="font-medium tabular-nums text-foreground">{fitScore}/100</dd></div>}
        {coverage !== null && <div><dt>Evidence</dt><dd className="font-medium tabular-nums text-foreground">{Math.round(coverage * 100)}%</dd></div>}
        {lexicalScore !== null && <div><dt>Keyword match</dt><dd className="font-medium tabular-nums text-foreground">{lexicalScore.toFixed(2)}</dd></div>}
      </dl>
    </div>}
    <p className="text-xs text-muted-foreground">Higher is better. This compares the posting with facts you confirmed in your profile; it is a prioritization aid, not a hiring prediction.</p>
    {explanation.length > 0 && <ul className="space-y-1.5 text-sm">{explanation.map((line, index) => <li key={index}>{line}</li>)}</ul>}
    {factors.length > 0 && <details className="rounded-lg border border-border">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-sm font-medium">
        <span>What shaped this score</span><span className="text-xs font-normal text-muted-foreground">{plural(factors.length, "factor")}</span>
      </summary>
      <ul className="divide-y divide-border border-t border-border px-3">
        {factors.map((factor, index) => {
          const label = textValue(factor.label) ?? `Factor ${index + 1}`
          const state = textValue(factor.state)
          const weight = numberValue(factor.weight)
          const reason = textValue(factor.reason)
          const evidence = Array.isArray(factor.evidence)
            ? factor.evidence.filter((item): item is string => typeof item === "string")
            : []
          return <li key={`${label}-${index}`} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">
                {state ? FACTOR_STATES[state] ?? readable(state) : "Not scored"}
                {weight !== null ? ` · weight ${weight}` : ""}
              </span>
            </div>
            {reason && <p className="mt-1 text-sm text-muted-foreground">{reason}</p>}
            {evidence.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Evidence: {evidence.join(" · ")}</p>}
          </li>
        })}
      </ul>
    </details>}
  </div>
}

function Value({ value, field = "", depth = 0 }: { value: JsonValue; field?: string; depth?: number }) {
  if (value === null) return <span className="text-muted-foreground">Not recorded</span>
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>
  if (typeof value === "string" || typeof value === "number") {
    const href = /url/i.test(field) ? safeSourceUrl(value) : null
    return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-brand-400 underline underline-offset-4">{value}</a> : <span className="whitespace-pre-wrap break-words">{String(value)}</span>
  }
  if (depth > 3) return <span className="text-muted-foreground">More details are in the saved record.</span>
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">None recorded</span>
    return <ul className="space-y-2">{value.map((item, index) => <li key={index} className="min-w-0"><Value value={item} depth={depth + 1} /></li>)}</ul>
  }
  return <dl className="space-y-2">{Object.entries(value).filter(([key]) => !OMITTED.has(key)).map(([key, item]) => <div key={key} className="min-w-0"><dt className="text-xs text-muted-foreground">{fieldLabel(key)}</dt><dd className="mt-0.5 min-w-0"><Value value={item} field={key} depth={depth + 1} /></dd></div>)}</dl>
}

function ProfileSummary({ output }: { output: JsonObject }) {
  const checks = [
    { label: "Contact email", done: output.hasContactEmail === true },
    { label: "Phone number", done: output.hasContactPhone === true },
    { label: "Salary range", done: output.salaryConfigured === true },
  ]
  const updatedAt = friendlyDate(output.updatedAt)
  return <div className="space-y-4">
    <Stats items={[
      { label: "Target roles", value: numberValue(output.targetRoles) ?? 0 },
      { label: "Confirmed skills", value: numberValue(output.confirmedCapabilities) ?? 0 },
      { label: "Evidence records", value: numberValue(output.confirmedEvidence) ?? 0 },
    ]} />
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {checks.map((check) => <div key={check.label} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2">
        <dt className="text-muted-foreground">{check.label}</dt>
        <dd><Badge variant={check.done ? "success" : "warning"}>{check.done ? "Ready" : "Add this"}</Badge></dd>
      </div>)}
    </dl>
    {updatedAt && <p className="text-xs text-muted-foreground">Profile last updated {updatedAt}.</p>}
  </div>
}

function DiscoverSummary({ output }: { output: JsonObject }) {
  const queries = objectList(output.queries)
  const links = objectList(output.links)
  return <div className="space-y-4">
    <Stats items={[
      { label: "Search queries", value: queries.length },
      { label: "Job board links", value: links.length },
    ]} />
    {links.length > 0 && <FoldedDetails title="Search links you can open" count={plural(links.length, "link")}>
      <ul className="space-y-3">
        {links.map((link, index) => {
          const href = safeSourceUrl(link.url)
          const label = textValue(link.label) ?? textValue(link.board) ?? "Search link"
          const query = textValue(link.query)
          return <li key={`${label}-${index}`} className="min-w-0 text-sm">
            {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-brand-400 underline underline-offset-4">{label}</a> : <span>{label}</span>}
            {query && <p className="mt-0.5 break-words text-xs text-muted-foreground">{query}</p>}
          </li>
        })}
      </ul>
    </FoldedDetails>}
  </div>
}

function ResearchSummary({ output }: { output: JsonObject }) {
  const flags = stringList(output.requirementFlags)
  const required = stringList(output.required)
  const preferred = stringList(output.preferred)
  const uncertainty = stringList(output.uncertainty)
  const signals = objectList(output.cultureSignals)
  const citations = objectList(output.citations)
  return <div className="space-y-4">
    <Stats items={[
      { label: "Independent sources", value: numberValue(output.independentSources) ?? 0 },
      { label: "Company research", value: confidenceLabel(output.companyConfidence) },
      { label: "Culture research", value: confidenceLabel(output.cultureConfidence) },
    ]} />
    {flags.length > 0 && <div className="flex flex-wrap gap-1.5">
      {flags.map((flag) => <Badge key={flag} variant="neutral">{readable(flag)}</Badge>)}
    </div>}
    {(required.length > 0 || preferred.length > 0) && <FoldedDetails title="What the posting asks for" count={plural(required.length + preferred.length, "item")}>
      <div className="grid gap-4 text-sm sm:grid-cols-2">
        {required.length > 0 && <div><h4 className="font-medium">Must have</h4><ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">{required.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        {preferred.length > 0 && <div><h4 className="font-medium">Nice to have</h4><ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">{preferred.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      </div>
    </FoldedDetails>}
    {signals.length > 0 && <FoldedDetails title="Workplace signals" count={plural(signals.length, "signal")}>
      <dl className="space-y-2 text-sm">{signals.map((signal, index) => {
        const label = textValue(signal.label) ?? `Signal ${index + 1}`
        const value = textValue(signal.value) ?? (numberValue(signal.value) !== null ? String(numberValue(signal.value)) : "Not stated")
        const state = textValue(signal.state)
        return <div key={`${label}-${index}`} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"><dt className="text-muted-foreground">{label}</dt><dd>{value}{state && state !== "KNOWN" ? <span className="ml-2 text-xs text-muted-foreground">({state === "UNKNOWN" ? "not stated" : readable(state)})</span> : null}</dd></div>
      })}</dl>
    </FoldedDetails>}
    {citations.length > 0 && <FoldedDetails title="Sources checked" count={plural(citations.length, "source")}>
      <ul className="space-y-2 text-sm">{citations.map((citation, index) => {
        const href = safeSourceUrl(citation.url)
        const title = textValue(citation.title) ?? textValue(citation.url) ?? `Source ${index + 1}`
        const sourceType = textValue(citation.sourceType)
        return <li key={`${title}-${index}`} className="min-w-0">
          {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-brand-400 underline underline-offset-4">{title}</a> : <span>{title}</span>}
          {sourceType && <p className="text-xs text-muted-foreground">{readable(sourceType)}</p>}
        </li>
      })}</ul>
    </FoldedDetails>}
    {uncertainty.length > 0 && <FoldedDetails title="What is still uncertain" count={plural(uncertainty.length, "note")}>
      <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">{uncertainty.map((note) => <li key={note}>{note}</li>)}</ul>
    </FoldedDetails>}
  </div>
}

function DraftSummary({ output }: { output: JsonObject }) {
  const status = textValue(output.validationStatus)
  const badgeVariant = status === "PASS" ? "success" : status === "FAIL" ? "error" : "warning"
  const changes = numberValue(output.claimCount) ?? numberValue(output.claims) ?? numberValue(output.suggestionCount) ?? 0
  const evidence = numberValue(output.evidenceReferenceCount) ?? numberValue(output.evidenceReferences) ?? 0
  const issues = objectList(output.issues)
  const coverage = objectValue(output.requirementCoverage)
  const coverageTotal = numberValue(coverage.total) ?? 0
  const needsReview = output.needsReview === true
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={badgeVariant}>{validationLabel(output.validationStatus)}</Badge>
      <span className="text-sm text-muted-foreground">A draft only — nothing is selected or submitted.</span>
    </div>
    {needsReview && <p className="rounded-md border border-warning/40 p-3 text-sm">Some checks need a person. Open the draft, review the flagged wording, then choose whether to use it.</p>}
    <Stats items={[
      { label: "Changes made", value: changes },
      { label: "Evidence references", value: evidence },
      { label: "Validation notes", value: issues.length },
    ]} />
    {coverageTotal > 0 && <FoldedDetails title="Requirement coverage" count={plural(coverageTotal, "requirement")}>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-muted-foreground">Supported</dt><dd className="font-medium tabular-nums">{numberValue(coverage.supported) ?? 0}</dd></div>
        <div><dt className="text-muted-foreground">Partial</dt><dd className="font-medium tabular-nums">{numberValue(coverage.partial) ?? 0}</dd></div>
        <div><dt className="text-muted-foreground">Not supported</dt><dd className="font-medium tabular-nums">{numberValue(coverage.unsupported) ?? 0}</dd></div>
      </dl>
    </FoldedDetails>}
    {issues.length > 0 && <FoldedDetails title="Validation notes" count={plural(issues.length, "note")}>
      <ul className="space-y-2 text-sm">{issues.map((issue, index) => {
        const severity = textValue(issue.severity)
        return <li key={index}><Badge variant={severity === "error" ? "error" : "warning"}>{readable(severity ?? "note")}</Badge><p className="mt-1">{textValue(issue.message) ?? textValue(issue.code) ?? "Review this note."}</p></li>
      })}</ul>
    </FoldedDetails>}
  </div>
}

function AtsSummary({ output }: { output: JsonObject }) {
  const fields = objectValue(output.fields)
  const missing = stringList(output.missingFields)
  const questions = objectList(output.needsUserAnswer)
  const flags = stringList(output.requirementFlags)
  return <div className="space-y-4">
    <Stats items={[
      { label: "Known facts", value: Object.keys(fields).length },
      { label: "Missing details", value: missing.length },
      { label: "Questions for you", value: questions.length },
    ]} />
    {missing.length > 0 && <p className="rounded-md border border-warning/40 p-3 text-sm">Add these in your Career Profile before filling a form: {missing.map(applicationFieldLabel).join(", ")}.</p>}
    {questions.length > 0 && <FoldedDetails title="Questions only you can answer" count={plural(questions.length, "question")}>
      <ul className="space-y-3 text-sm">{questions.map((item, index) => {
        const question = textValue(item.question) ?? "This question needs your answer."
        const reason = textValue(item.reason)
        return <li key={index}><p className="font-medium">{question}</p>{reason && <p className="mt-0.5 text-muted-foreground">{reason}</p>}</li>
      })}</ul>
    </FoldedDetails>}
    {Object.keys(fields).length > 0 && <FoldedDetails title="Facts ready to fill" count={plural(Object.keys(fields).length, "field")}>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{Object.entries(fields).map(([key, value]) => <div key={key} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/60 pb-2"><dt className="shrink-0 text-muted-foreground">{applicationFieldLabel(key)}</dt><dd className="min-w-0 break-all text-right">{typeof value === "string" || typeof value === "number" ? String(value) : "Recorded"}</dd></div>)}</dl>
    </FoldedDetails>}
    {flags.length > 0 && <div className="flex flex-wrap gap-1.5">{flags.map((flag) => <Badge key={flag} variant="neutral">{readable(flag)}</Badge>)}</div>}
  </div>
}

function HumanReviewSummary({ output }: { output: JsonObject }) {
  const approved = output.approved === true
  const approvedAt = friendlyDate(output.approvedAt)
  if (output.manual === true) return <div className="space-y-3">
    <Badge variant="neutral">Recorded by you</Badge>
    <p className="text-sm text-muted-foreground">You marked this checkpoint done. It did not run the agent, approve the draft, or submit anything.</p>
  </div>
  return <div className="space-y-3">
    <Badge variant={approved ? "success" : "warning"}>{approved ? "Approved by you" : "Waiting for your decision"}</Badge>
    <p className="text-sm text-muted-foreground">{approved ? "Your approval let the package be staged. It did not submit an application." : "Review the prepared package, then answer this checkpoint. The agent cannot approve it for you."}</p>
    {approvedAt && <p className="text-xs text-muted-foreground">Approved {approvedAt}.</p>}
  </div>
}

function StagingSummary({ output }: { output: JsonObject }) {
  const job = objectValue(output.job)
  const evidence = objectValue(output.evidence)
  const submitted = output.submitted === true
  const approvedAt = friendlyDate(output.approvedAt)
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={submitted ? "warning" : "success"}>{submitted ? "Submitted" : "Staged · nothing submitted"}</Badge>
      <span className="text-sm text-muted-foreground">{textValue(job.title) ?? "Application package"}{textValue(job.companyName) ? ` · ${textValue(job.companyName)}` : ""}</span>
    </div>
    <Stats items={[
      { label: "Rank score", value: numberValue(evidence.rankScore) ?? "Not scored" },
      { label: "Research confidence", value: confidenceLabel(evidence.researchConfidence) },
      { label: "ATS fields ready", value: numberValue(evidence.atsFields) ?? 0 },
      { label: "Questions for you", value: numberValue(evidence.blockedQuestions) ?? 0 },
    ]} />
    <FoldedDetails title="Evidence attached to the package" count={textValue(output.submissionAttemptStatus) ?? "STAGED"}>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3 border-b border-border/60 pb-2"><dt className="text-muted-foreground">Resume checks</dt><dd>{validationLabel(evidence.validationStatus)}</dd></div>
        <div className="flex justify-between gap-3 border-b border-border/60 pb-2"><dt className="text-muted-foreground">Tailoring changes</dt><dd className="tabular-nums">{numberValue(evidence.tailoringSuggestionCount) ?? 0}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Approved</dt><dd>{approvedAt ?? "Not recorded"}</dd></div>
      </dl>
    </FoldedDetails>
    <p className="text-xs text-muted-foreground">The package is ready for you to open at the employer and submit. The agent has not sent anything.</p>
  </div>
}

function TrackingSummary({ output }: { output: JsonObject }) {
  const nextAction = textValue(output.nextAction)
  return <div className="space-y-4">
    <Stats items={[
      { label: "Application status", value: readable(textValue(output.applicationStatus) ?? "unknown") },
      { label: "Date applied", value: friendlyDate(output.dateApplied) ?? "Not yet" },
      { label: "Status changes", value: numberValue(output.statusEventCount) ?? 0 },
    ]} />
    {nextAction && <p className="rounded-md bg-muted p-3 text-sm">{nextAction}</p>}
    <p className="text-xs text-muted-foreground">This is what the tracker records. A preparation run never marks an application as applied or submitted.</p>
  </div>
}

function FollowUpSummary({ output }: { output: JsonObject }) {
  const rationale = textValue(output.rationale)
  const scheduled = output.scheduled === true || output.alreadyScheduled === true
  const tasks = objectList(output.followUpTasks)
  return <div className="space-y-4">
    <Stats items={[
      { label: "Suggested email", value: friendlyDate(output.recommendedDate) ?? "Not set" },
      { label: "Suggested LinkedIn", value: friendlyDate(output.recommendedLinkedInDate) ?? "Not set" },
      { label: "Channel", value: readable(textValue(output.recommendedChannel) ?? "email") },
    ]} />
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={scheduled ? "success" : "neutral"}>{scheduled ? "Reminder saved" : "No reminder saved"}</Badge>
      <span className="text-sm text-muted-foreground">{output.sent === true ? "Marked sent." : "Nothing has been sent for you."}</span>
    </div>
    {rationale && <p className="text-sm">{rationale}</p>}
    {tasks.length > 0 && <FoldedDetails title="Saved reminders" count={plural(tasks.length, "reminder")}>
      <ul className="space-y-2 text-sm">{tasks.map((task, index) => <li key={index} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"><span>{readable(textValue(task.channel) ?? "follow-up")}</span><span className="text-muted-foreground">{friendlyDate(task.dueAt) ?? "No date"} · {readable(textValue(task.status) ?? "pending")}</span></li>)}</ul>
    </FoldedDetails>}
  </div>
}

function StepOutput({ step, output }: { step: WorkflowStepDTO; output: JsonObject }) {
  switch (step.name) {
    case "PROFILE": return <ProfileSummary output={output} />
    case "DISCOVER": return <DiscoverSummary output={output} />
    case "RANK": return Array.isArray(output.factors) ? <RankResult output={output} /> : <div className="text-sm"><Value value={output} /></div>
    case "RESEARCH": return <ResearchSummary output={output} />
    case "TAILOR":
    case "VALIDATE": return <DraftSummary output={output} />
    case "PREPARE_ATS": return <AtsSummary output={output} />
    case "HUMAN_REVIEW": return <HumanReviewSummary output={output} />
    case "SUBMISSION_STAGING": return <StagingSummary output={output} />
    case "TRACKING": return <TrackingSummary output={output} />
    case "FOLLOW_UP": return <FollowUpSummary output={output} />
    default: return <div className="text-sm"><Value value={output} /></div>
  }
}

export function WorkflowOutput({ step, applicationId }: { step: WorkflowStepDTO; applicationId: string | null }) {
  const output = objectValue(step.output)
  const resumeId = typeof output.resumeId === "string" ? output.resumeId : typeof output.tailoredResumeId === "string" ? output.tailoredResumeId : null
  const attemptId = typeof output.submissionAttemptId === "string" ? output.submissionAttemptId : null
  return <div className="min-w-0 space-y-4">
    {output.manual === true && <p className="text-sm">Marked done by you. This checklist action did not run the agent, save a document, or submit an application.</p>}
    {step.name === "PREPARE_ATS" && <p className="rounded-md bg-muted p-3 text-sm">Employer form has not been scanned. These are known profile facts and questions, not filled employer fields or uploaded files.</p>}
    {(step.name === "TAILOR" || step.name === "HUMAN_REVIEW") && resumeId && <p className="text-sm text-muted-foreground">This draft is not automatically selected for your application. Review it before choosing which resume to use.</p>}
    {attemptId && <p className="text-sm"><Badge variant="warning">Nothing submitted</Badge> <Link className="ml-2 text-brand-400 underline underline-offset-4" href={applicationId ? `/jobs/${encodeURIComponent(applicationId)}#track` : "/planner"}>Open saved application</Link></p>}
    {resumeId && <Link className="inline-flex min-h-11 items-center text-sm font-medium text-brand-400 underline underline-offset-4" href={`/resumes/${encodeURIComponent(resumeId)}`}>Review the rewritten resume</Link>}
    {step.output === null ? <p className="text-sm text-muted-foreground">{step.status === "PENDING" ? "Waiting to run. No result yet." : "No result was saved for this step."}</p>
      : <StepOutput step={step} output={objectValue(step.output)} />}
  </div>
}
