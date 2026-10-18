"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { Mail, Copy, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/shared/lib/utils"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { Textarea } from "@/shared/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { GroundingNotice } from "@/shared/components/grounding-notice"
import { SignatureNotice } from "@/shared/components/signature-notice"
import type { KeywordEvidence } from "@/shared/lib/evidence-grounding"
import type {
  SignatureCheck,
  SubjectNameCheck,
} from "@/shared/lib/prompts/signature-check"
import { generateApplicationEmail } from "../actions/application-email.actions"
import { generateColdEmail } from "../actions/cold-email.actions"
import { generateReplyEmail } from "../actions/reply-email.actions"
import type { JobMatchResumeOption } from "./job-match-panel"

type EmailType = "application" | "cold" | "reply"
type ReplyTone = "professional" | "warm" | "direct"
type ReplyLength = "brief" | "standard" | "detailed"

/** Mirrors the `receivedEmail` cap in `reply-email.actions`. */
const RECEIVED_EMAIL_MAX_LENGTH = 8000

/** Mirrors the `priorThread` cap in `reply-email.actions`. */
const PRIOR_THREAD_MAX_LENGTH = 6000

/** Mirrors the `previousDraft` cap in `reply-email.actions`. */
const PREVIOUS_DRAFT_MAX_LENGTH = 4000

/**
 * The subject-line name check exists on the application-email result only — a
 * cold-email subject bars the name and a reply subject echoes the sender's, so
 * neither generator runs it. The three action results are a union here, and a
 * bare `"subjectName" in result` widens the field to `unknown` on the two
 * members that never declare it, so the read is spelled out instead.
 */
function readSubjectName(result: object): SubjectNameCheck | null {
  const withSubject = result as { subjectName?: SubjectNameCheck | null }
  return withSubject.subjectName ?? null
}

const REPLY_TONES: { value: ReplyTone; label: string }[] = [
  { value: "professional", label: "Professional" },
  { value: "warm", label: "Warm" },
  { value: "direct", label: "Direct" },
]

const REPLY_LENGTHS: { value: ReplyLength; label: string }[] = [
  { value: "brief", label: "Brief" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
]

const EMAIL_TYPES: { value: EmailType; label: string; helper: string }[] = [
  {
    value: "application",
    label: "Application email",
    helper: "The email you send when applying to this role, with your resume attached.",
  },
  {
    value: "cold",
    label: "Cold email",
    helper: "Outreach before — or without — a formal application.",
  },
  {
    value: "reply",
    label: "Reply assist",
    helper: "Draft your answer to an email you got back about this role.",
  },
]

const OPTION_BUTTON =
  "flex-1 rounded-md border border-transparent px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

const OPTION_BUTTON_ACTIVE = "border-border bg-background text-foreground shadow-sm"

interface Props {
  jobApplicationId: string
  resumeOptions: JobMatchResumeOption[]
  /** The resume chosen for this application, if one has been. */
  chosenResumeId?: string | null
}

export function JobEmailPanel({ jobApplicationId, resumeOptions, chosenResumeId }: Props) {
  const [isPending, startTransition] = useTransition()
  const [emailType, setEmailType] = useState<EmailType>("application")
  // The resume the application already went with wins the default, so the page
  // does not offer three selects that quietly disagree about which one this
  // job uses. A resume since deleted falls back to the first option.
  const chosenResumeOptionId = resumeOptions.find(
    (option) => option.id === chosenResumeId
  )?.id
  const [resumeId, setResumeId] = useState(
    chosenResumeOptionId ?? resumeOptions[0]?.id ?? ""
  )

  // Changing the application's resume upstream re-renders this panel without
  // remounting it, so the initial state above would go stale and the two selects
  // would disagree again. Keyed on the chosen id alone, so a local override the
  // user made survives every other re-render.
  const [lastChosenResumeId, setLastChosenResumeId] = useState(chosenResumeOptionId)
  if (chosenResumeOptionId && chosenResumeOptionId !== lastChosenResumeId) {
    // Adjusting state during render, the documented alternative to an effect:
    // it re-runs this render before the DOM is touched, with no extra pass.
    setLastChosenResumeId(chosenResumeOptionId)
    setResumeId(chosenResumeOptionId)
  }
  const [instructions, setInstructions] = useState("")
  const [receivedEmail, setReceivedEmail] = useState("")
  const [priorThread, setPriorThread] = useState("")
  const [tone, setTone] = useState<ReplyTone>("professional")
  const [length, setLength] = useState<ReplyLength>("standard")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [hasResult, setHasResult] = useState(false)
  /** Which type produced the visible result — a cold-email body is not a reply draft. */
  const [resultType, setResultType] = useState<EmailType | null>(null)
  /**
   * Requirements the draft mentions that the resume does not back, from the
   * server-side evidence check. Empty is the normal case.
   */
  const [claimed, setClaimed] = useState<KeywordEvidence[]>([])
  /**
   * The quiet half of the same check: requirements the draft names as things the
   * user has not done. Reported, not warned about.
   */
  const [namedAsGap, setNamedAsGap] = useState<KeywordEvidence[]>([])
  /**
   * The sign-off name check. Already filtered server-side — `missing_name` never
   * arrives — and `SignatureNotice` filters again, so neither layer can drift.
   */
  const [signature, setSignature] = useState<SignatureCheck | null>(null)
  /** The subject-line name check. Application emails only; null everywhere else. */
  const [subjectName, setSubjectName] = useState<SubjectNameCheck | null>(null)
  /** The result only lives in state — warn before a reload throws it away. */
  const [uncopied, setUncopied] = useState(false)

  const selectedType = EMAIL_TYPES.find((type) => type.value === emailType) ?? EMAIL_TYPES[0]

  useEffect(() => {
    if (!uncopied) return
    function warn(e: BeforeUnloadEvent) {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [uncopied])

  function handleGenerate() {
    if (emailType === "reply" && !receivedEmail.trim()) {
      toast.error("Paste the email you received first")
      return
    }

    const formData = new FormData()
    formData.set("jobApplicationId", jobApplicationId)
    if (resumeId) formData.set("resumeId", resumeId)
    if (instructions.trim()) formData.set("instructions", instructions.trim())
    if (emailType === "reply") {
      formData.set("receivedEmail", receivedEmail.trim())
      formData.set("tone", tone)
      formData.set("length", length)
      if (priorThread.trim()) formData.set("priorThread", priorThread.trim())
      // Only a regenerate has a draft to move away from; the first pass sends none.
      if (resultType === "reply" && body.trim()) {
        formData.set("previousDraft", body.trim().slice(0, PREVIOUS_DRAFT_MAX_LENGTH))
      }
    }

    startTransition(async () => {
      const result =
        emailType === "application"
          ? await generateApplicationEmail(formData)
          : emailType === "cold"
            ? await generateColdEmail(formData)
            : await generateReplyEmail(formData)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      setSubject(result.subject)
      setBody(result.body)
      setClaimed(result.grounding?.claimed ?? [])
      setNamedAsGap(result.grounding?.namedAsGap ?? [])
      // Reset on every generation, exactly like the grounding state above: a
      // warning left over from the previous draft is worse than none.
      setSignature(result.signature ?? null)
      setSubjectName(readSubjectName(result))
      setHasResult(true)
      setResultType(emailType)
      // A regenerate replaces the previous email, so the guard starts over.
      setUncopied(true)
    })
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
      setUncopied(false)
    } catch {
      toast.error("Couldn't copy to clipboard")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Email
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {resumeOptions.length === 0 ? (
          <EmptyState
            variant="bare"
            icon={Mail}
            title="No resume to write from"
            description="Create a resume first — every email here is drafted off one."
            action={
              <Link
                href="/resumes"
                className={buttonVariants({ variant: "outline" })}
              >
                Go to resumes
              </Link>
            }
          />
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Email type</p>
              <div
                className="flex gap-1 rounded-lg bg-muted p-0.5"
                role="group"
                aria-label="Email type"
              >
                {EMAIL_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    aria-pressed={emailType === type.value}
                    onClick={() => setEmailType(type.value)}
                    disabled={isPending}
                    className={cn(
                      OPTION_BUTTON,
                      emailType === type.value && OPTION_BUTTON_ACTIVE,
                    )}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{selectedType.helper}</p>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="job-email-resume"
                className="text-xs text-muted-foreground"
              >
                Resume
              </Label>
              <Select
                id="job-email-resume"
                value={resumeId}
                onChange={(e) => setResumeId(e.target.value)}
                disabled={isPending}
              >
                {resumeOptions.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.atsScore == null
                      ? resume.title
                      : `${resume.title} — ATS ${resume.atsScore}`}
                  </option>
                ))}
              </Select>
            </div>

            {emailType === "reply" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor="job-email-received"
                      className="text-xs text-muted-foreground"
                    >
                      Paste the email you received
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {receivedEmail.length}/{RECEIVED_EMAIL_MAX_LENGTH}
                    </span>
                  </div>
                  <Textarea
                    id="job-email-received"
                    value={receivedEmail}
                    onChange={(e) => setReceivedEmail(e.target.value)}
                    disabled={isPending}
                    placeholder="Paste the recruiter's email here"
                    maxLength={RECEIVED_EMAIL_MAX_LENGTH}
                    rows={6}
                    required
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p
                      id="job-email-tone-label"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Tone
                    </p>
                    <div
                      className="flex gap-1 rounded-lg bg-muted p-0.5"
                      role="group"
                      aria-labelledby="job-email-tone-label"
                    >
                      {REPLY_TONES.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={tone === option.value}
                          onClick={() => setTone(option.value)}
                          disabled={isPending}
                          className={cn(
                            OPTION_BUTTON,
                            tone === option.value && OPTION_BUTTON_ACTIVE,
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p
                      id="job-email-length-label"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Length
                    </p>
                    <div
                      className="flex gap-1 rounded-lg bg-muted p-0.5"
                      role="group"
                      aria-labelledby="job-email-length-label"
                    >
                      {REPLY_LENGTHS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={length === option.value}
                          onClick={() => setLength(option.value)}
                          disabled={isPending}
                          className={cn(
                            OPTION_BUTTON,
                            length === option.value && OPTION_BUTTON_ACTIVE,
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor="job-email-thread"
                      className="text-xs text-muted-foreground"
                    >
                      Earlier messages in this thread (optional)
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {priorThread.length}/{PRIOR_THREAD_MAX_LENGTH}
                    </span>
                  </div>
                  <Textarea
                    id="job-email-thread"
                    value={priorThread}
                    onChange={(e) => setPriorThread(e.target.value)}
                    disabled={isPending}
                    placeholder="Paste the earlier messages, oldest first"
                    maxLength={PRIOR_THREAD_MAX_LENGTH}
                    rows={4}
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label
                htmlFor="job-email-instructions"
                className="text-xs text-muted-foreground"
              >
                Instructions (optional)
              </Label>
              <Input
                id="job-email-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={isPending}
                placeholder="e.g. mention my volunteer experience"
                maxLength={1000}
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button type="button" onClick={handleGenerate} disabled={isPending}>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {isPending ? "Generating…" : hasResult ? "Regenerate" : "Generate"}
              </Button>
            </div>
          </>
        )}

        {hasResult && (
          <div className="space-y-4 border-t border-border pt-4">
            <p className="text-xs text-warning">
              Copy it — this email isn&apos;t saved and is lost on reload.
            </p>
            {/* Above the draft on purpose: the point is to be read before the
                user copies, not discovered afterwards. */}
            <GroundingNotice
              claimed={claimed}
              namedAsGap={namedAsGap}
              label="email"
            />
            <SignatureNotice
              signature={signature}
              subjectName={subjectName}
              label="email"
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label
                  htmlFor="job-email-subject"
                  className="text-xs text-muted-foreground"
                >
                  Subject
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => copy(subject, "Subject")}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy subject
                </Button>
              </div>
              <Input
                id="job-email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="job-email-body" className="text-xs text-muted-foreground">
                  Email
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => copy(body, "Email")}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy email
                </Button>
              </div>
              <Textarea
                id="job-email-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
