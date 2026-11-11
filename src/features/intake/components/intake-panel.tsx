"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  Check,
  Briefcase,
  FileText,
  GitBranch,
  Globe,
  MessageSquare,
  Mic,
  Pencil,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from "lucide-react"

import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Progress } from "@/shared/ui/progress"
import { Select } from "@/shared/ui/select"
import { Textarea } from "@/shared/ui/textarea"

import type {
  ChatExtractionResult,
  ContactField,
  ContactPatchData,
  EvidencePatchData,
  IntakeChatMessage,
  IntakePatchDTO,
  IntakePatchData,
  IntakeRunDTO,
  IntakeRunStatus,
  IntakeSource,
  SkillPatchData,
  TargetRolePatchData,
} from "../types"
import { INTAKE_SOURCE_LABELS } from "../types"

export interface IntakePanelProps {
  initialRuns: IntakeRunDTO[]
  resumes: { id: string; title: string }[]
  githubUrl: string | null
  websiteUrl: string | null
  missingFields: string[]
}

const TERMINAL = new Set<IntakeRunStatus>([
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
])

const SOURCE_ORDER: IntakeSource[] = [
  "RESUME",
  "GITHUB",
  "LINKEDIN",
  "WEB",
  "CHAT",
  "VOICE",
]

const RUN_BADGE: Record<
  IntakeRunStatus,
  "neutral" | "brand" | "success" | "warning" | "error"
> = {
  PENDING: "neutral",
  RUNNING: "brand",
  PARTIAL: "warning",
  COMPLETED: "success",
  FAILED: "error",
  CANCELLED: "neutral",
}

const SOURCE_BADGE: Record<
  string,
  "neutral" | "brand" | "success" | "warning" | "error"
> = {
  PENDING: "neutral",
  RUNNING: "brand",
  SUCCEEDED: "success",
  PARTIAL: "warning",
  FAILED: "error",
  CANCELLED: "neutral",
  SKIPPED: "neutral",
}

const CONTACT_LABELS: Record<ContactField, string> = {
  contactFullName: "Name",
  contactEmail: "Email",
  contactPhone: "Phone",
  contactLocation: "Location",
  linkedinUrl: "LinkedIn",
  githubUrl: "GitHub",
  websiteUrl: "Website",
}

const PATCH_KIND_LABELS: Record<string, string> = {
  CONTACT: "Contact detail",
  EVIDENCE: "Career evidence",
  SKILL: "Skill",
  TARGET_ROLE: "Target role",
}

type Tone = "status" | "error"

interface Notice {
  tone: Tone
  text: string
}

class ApiFailure extends Error {}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown
  }
  if (!response.ok) {
    throw new ApiFailure(
      typeof body.error === "string" ? body.error : `Request failed (${response.status})`
    )
  }
  return body as T
}

function upsertRun(runs: IntakeRunDTO[], run: IntakeRunDTO): IntakeRunDTO[] {
  const next = [run, ...runs.filter((item) => item.id !== run.id)]
  return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10)
}

function formatDate(value: string | null): string {
  if (!value) return ""
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (first) => first.toUpperCase())
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "Not stated"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== null && item !== undefined && item !== "")
      .map(([key, item]) => `${humanize(key)}: ${String(item)}`)
      .join(" · ")
  }
  return String(value)
}

function patchSummary(patch: IntakePatchDTO): string {
  switch (patch.kind) {
    case "CONTACT": {
      const data = patch.data as ContactPatchData
      return `${CONTACT_LABELS[data.field]}: ${data.value}`
    }
    case "EVIDENCE": {
      const data = patch.data as EvidencePatchData
      const dates = [data.startDate, data.endDate].filter(Boolean).join(" – ")
      const org = data.organization ? ` at ${data.organization}` : ""
      return `${data.title}${org}${dates ? ` (${dates})` : ""}`
    }
    case "SKILL": {
      const data = patch.data as SkillPatchData
      return data.category ? `${data.name} · ${data.category}` : data.name
    }
    case "TARGET_ROLE":
      return (patch.data as TargetRolePatchData).title
  }
}

function patchDetail(patch: IntakePatchDTO): string | null {
  if (patch.kind !== "EVIDENCE") return null
  const data = patch.data as EvidencePatchData
  return data.details ?? data.outcome ?? null
}

function confidenceBadge(confidence: number): "success" | "warning" | "neutral" {
  if (confidence >= 80) return "success"
  if (confidence >= 60) return "warning"
  return "neutral"
}

function SourceIcon({ source }: { source: IntakeSource }) {
  const className = "h-4 w-4"
  switch (source) {
    case "RESUME":
      return <FileText className={className} aria-hidden="true" />
    case "GITHUB":
      return <GitBranch className={className} aria-hidden="true" />
    case "LINKEDIN":
      return <Briefcase className={className} aria-hidden="true" />
    case "WEB":
      return <Globe className={className} aria-hidden="true" />
    case "CHAT":
      return <MessageSquare className={className} aria-hidden="true" />
    case "VOICE":
      return <Mic className={className} aria-hidden="true" />
  }
}

interface SpeechRecognitionResultLike {
  readonly length: number
  [index: number]: { transcript: string }
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}

function PatchRow({
  runId,
  patch,
  onChanged,
  onNotice,
}: {
  runId: string
  patch: IntakePatchDTO
  onChanged: () => Promise<void>
  onNotice: (notice: Notice) => void
}) {
  const [pending, setPending] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<IntakePatchData>(patch.data)

  function beginEdit() {
    setDraft(patch.data)
    setEditing(true)
  }

  async function act(label: string, action: () => Promise<{ message?: string }>) {
    setPending(label)
    try {
      const result = await action()
      onNotice({
        tone: "status",
        text: result.message ?? "The intake fact was updated.",
      })
      await onChanged()
    } catch (error) {
      onNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "That action failed.",
      })
    } finally {
      setPending(null)
    }
  }

  function apply(disposition?: "KEEP_EXISTING" | "ACCEPT_INCOMING" | "KEEP_BOTH") {
    return act("apply", () =>
      api<{ status: string; message: string }>(
        `/api/intake/${runId}/patches/${patch.id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(disposition ? { disposition } : {}),
        }
      )
    )
  }

  function reject() {
    return act("reject", () =>
      api<{ status: string; message?: string }>(
        `/api/intake/${runId}/patches/${patch.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "Rejected during review." }),
        }
      )
    )
  }

  function saveCorrection() {
    return act("save", () =>
      api<{ message?: string }>(`/api/intake/${runId}/patches/${patch.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          correction: { kind: patch.kind, data: draft },
        }),
      })
    ).then(() => setEditing(false))
  }

  const conflict = patch.conflict?.status === "OPEN" ? patch.conflict : null
  const canReview = patch.status === "PENDING" || patch.status === "CONFLICT"
  const detail = patchDetail(patch)

  return (
    <li className="rounded-md border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" size="sm">
              {PATCH_KIND_LABELS[patch.kind]}
            </Badge>
            <Badge variant="neutral" size="sm">
              {INTAKE_SOURCE_LABELS[patch.source]}
            </Badge>
            <Badge variant={confidenceBadge(patch.confidence)} size="sm">
              {patch.confidence}% confidence
            </Badge>
            {patch.status === "APPLIED" && (
              <Badge variant="success" size="sm">
                Added to profile
              </Badge>
            )}
            {patch.status === "REJECTED" && (
              <Badge variant="neutral" size="sm">
                Rejected
              </Badge>
            )}
            {patch.status === "CONFLICT" && (
              <Badge variant="warning" size="sm">
                Needs a choice
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium text-foreground">{patchSummary(patch)}</p>
          {detail && (
            <p className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">
              {detail}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {humanize(patch.provenance.adapter)}
            {patch.provenance.fileName ? ` · ${patch.provenance.fileName}` : ""}
            {patch.provenance.locator ? ` · ${patch.provenance.locator}` : ""}
            {patch.provenance.sourceUrl ? (
              <>
                {" · "}
                <a
                  href={patch.provenance.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-400 hover:underline"
                >
                  Source
                </a>
              </>
            ) : null}
          </p>
          {patch.rejectionReason && patch.status === "REJECTED" && (
            <p className="text-xs text-muted-foreground">{patch.rejectionReason}</p>
          )}
        </div>
      </div>

      {conflict && (
        <div className="mt-3 space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            This fact already exists with different details
            {conflict.field ? ` (${humanize(conflict.field)})` : ""}
          </p>
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <p className="font-medium text-foreground">Already on your profile</p>
              <p className="text-muted-foreground">{formatValue(conflict.existing)}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">From this source</p>
              <p className="text-muted-foreground">{formatValue(conflict.incoming)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={pending === "apply"}
              onClick={() => apply("KEEP_EXISTING")}
            >
              Keep existing
            </Button>
            <Button
              type="button"
              size="sm"
              loading={pending === "apply"}
              onClick={() => apply("ACCEPT_INCOMING")}
            >
              Use imported
            </Button>
            {patch.kind === "EVIDENCE" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={pending === "apply"}
                onClick={() => apply("KEEP_BOTH")}
              >
                Keep both
              </Button>
            )}
          </div>
        </div>
      )}

      {editing ? (
        <div className="mt-3 space-y-2 rounded-md border border-border p-3">
          <PatchEditor kind={patch.kind} draft={draft} setDraft={setDraft} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={pending === "save"}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              loading={pending === "save"}
              onClick={() => void saveCorrection()}
            >
              Save correction
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {canReview && !conflict && (
            <Button
              type="button"
              size="sm"
              loading={pending === "apply"}
              onClick={() => void apply()}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Apply to profile
            </Button>
          )}
          {canReview && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={beginEdit}
              disabled={pending !== null}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Correct
            </Button>
          )}
          {canReview && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              loading={pending === "reject"}
              onClick={() => void reject()}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Reject
            </Button>
          )}
          {patch.status === "APPLIED" && (
            <Button type="button" size="sm" variant="secondary" onClick={beginEdit}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Correct applied fact
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function PatchEditor({
  kind,
  draft,
  setDraft,
}: {
  kind: IntakePatchDTO["kind"]
  draft: IntakePatchData
  setDraft: (data: IntakePatchData) => void
}) {
  if (kind === "CONTACT") {
    const data = draft as ContactPatchData
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`correct-${data.field}`}>{CONTACT_LABELS[data.field]}</Label>
        <Input
          id={`correct-${data.field}`}
          value={data.value}
          onChange={(event) => setDraft({ ...data, value: event.target.value })}
        />
      </div>
    )
  }

  if (kind === "EVIDENCE") {
    const data = draft as EvidencePatchData
    return (
      <div className="grid gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="correct-title">Title</Label>
          <Input
            id="correct-title"
            value={data.title}
            onChange={(event) => setDraft({ ...data, title: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="correct-org">Organization</Label>
          <Input
            id="correct-org"
            value={data.organization ?? ""}
            onChange={(event) =>
              setDraft({ ...data, organization: event.target.value || null })
            }
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="correct-start">Start date</Label>
            <Input
              id="correct-start"
              type="date"
              value={data.startDate ?? ""}
              onChange={(event) =>
                setDraft({ ...data, startDate: event.target.value || null })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correct-end">End date</Label>
            <Input
              id="correct-end"
              type="date"
              value={data.endDate ?? ""}
              onChange={(event) =>
                setDraft({ ...data, endDate: event.target.value || null })
              }
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="correct-details">Details</Label>
          <Textarea
            id="correct-details"
            rows={3}
            value={data.details ?? ""}
            onChange={(event) =>
              setDraft({ ...data, details: event.target.value || null })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="correct-outcome">Measured outcome</Label>
          <Input
            id="correct-outcome"
            value={data.outcome ?? ""}
            onChange={(event) =>
              setDraft({ ...data, outcome: event.target.value || null })
            }
          />
        </div>
      </div>
    )
  }

  if (kind === "SKILL") {
    const data = draft as SkillPatchData
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="correct-skill">Skill</Label>
          <Input
            id="correct-skill"
            value={data.name}
            onChange={(event) => setDraft({ ...data, name: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="correct-category">Category</Label>
          <Input
            id="correct-category"
            value={data.category ?? ""}
            onChange={(event) =>
              setDraft({ ...data, category: event.target.value || null })
            }
          />
        </div>
      </div>
    )
  }

  const data = draft as TargetRolePatchData
  return (
    <div className="space-y-1.5">
      <Label htmlFor="correct-role">Target role</Label>
      <Input
        id="correct-role"
        value={data.title}
        onChange={(event) => setDraft({ ...data, title: event.target.value })}
      />
    </div>
  )
}

export function IntakePanel({
  initialRuns,
  resumes,
  githubUrl,
  websiteUrl,
  missingFields,
}: IntakePanelProps) {
  const router = useRouter()
  const [runs, setRuns] = useState(initialRuns)
  const [activeId, setActiveId] = useState<string | null>(
    initialRuns[0]?.id ?? null
  )
  const [tab, setTab] = useState<IntakeSource>("RESUME")
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const [resumeId, setResumeId] = useState(resumes[0]?.id ?? "")
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [githubInput, setGithubInput] = useState(githubUrl ?? "")
  const [githubConsent, setGithubConsent] = useState(false)
  const [webInput, setWebInput] = useState(websiteUrl ?? "")
  const [webConsent, setWebConsent] = useState(false)
  const [linkedinFile, setLinkedinFile] = useState<File | null>(null)
  const [linkedinAi, setLinkedinAi] = useState(false)

  const [chatTurns, setChatTurns] = useState<IntakeChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const [chatPreview, setChatPreview] = useState<ChatExtractionResult | null>(null)
  const [chatAi, setChatAi] = useState(false)
  const [voiceText, setVoiceText] = useState("")
  const [voiceInputMode, setVoiceInputMode] = useState<"MICROPHONE" | "PASTED">(
    "PASTED"
  )
  const [voiceAi, setVoiceAi] = useState(false)
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const runsRef = useRef(runs)
  useEffect(() => {
    runsRef.current = runs
  }, [runs])
  const activeRun = runs.find((run) => run.id === activeId) ?? null

  function updateRun(run: IntakeRunDTO) {
    setRuns((current) => upsertRun(current, run))
  }

  async function refreshRun(runId: string): Promise<void> {
    const result = await api<{ run: IntakeRunDTO }>(`/api/intake/${runId}`)
    updateRun(result.run)
  }

  useEffect(() => {
    if (!activeId) return
    const existing = runsRef.current.find((run) => run.id === activeId)
    if (existing && TERMINAL.has(existing.status)) return

    let stopped = false
    let source: EventSource | null = null
    let poll: ReturnType<typeof setInterval> | null = null

    const handleRun = (run: IntakeRunDTO) => {
      updateRun(run)
      if (TERMINAL.has(run.status)) {
        source?.close()
        if (poll) {
          clearInterval(poll)
          poll = null
        }
      }
    }

    const beginPolling = () => {
      if (poll || stopped) return
      poll = setInterval(() => {
        void api<{ run: IntakeRunDTO }>(`/api/intake/${activeId}`)
          .then((result) => {
            if (!stopped) handleRun(result.run)
          })
          .catch(() => {
            // A transient poll failure is expected; the next tick retries.
          })
      }, 1000)
    }

    source = new EventSource(`/api/intake/${activeId}/stream`)
    const onProgress = (event: MessageEvent) => {
      try {
        handleRun(JSON.parse(event.data) as IntakeRunDTO)
      } catch {
        // Ignore a malformed frame; the next event carries the full run.
      }
    }
    source.addEventListener("progress", onProgress as EventListener)
    source.onerror = () => {
      source?.close()
      if (!stopped) beginPolling()
    }

    return () => {
      stopped = true
      source?.close()
      if (poll) clearInterval(poll)
    }
  }, [activeId])

  useEffect(() => {
    return () => recognitionRef.current?.stop()
  }, [])

  async function startRun(
    source: IntakeSource,
    input: Record<string, unknown>,
    label = "Intake"
  ) {
    setBusy(`start-${source}`)
    setNotice(null)
    try {
      const result = await api<{ run: IntakeRunDTO }>("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requests: [{ source, input }] }),
      })
      updateRun(result.run)
      setActiveId(result.run.id)
      setNotice({
        tone: "status",
        text: `${label} started. Facts will appear below for review.`,
      })
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not start intake.",
      })
    } finally {
      setBusy(null)
    }
  }

  async function uploadSource(
    source: "RESUME" | "LINKEDIN",
    file: File | null,
    useAi = false
  ) {
    if (!file) {
      setNotice({ tone: "error", text: "Choose a file first." })
      return
    }
    setBusy(`upload-${source}`)
    setNotice(null)
    try {
      const body = new FormData()
      body.append("file", file)
      const useAiQuery = source === "LINKEDIN" && useAi ? "&useAi=1" : ""
      const result = await api<{ run: IntakeRunDTO }>(
        `/api/intake/upload?source=${source}${useAiQuery}`,
        { method: "POST", body }
      )
      updateRun(result.run)
      setActiveId(result.run.id)
      setNotice({
        tone: "status",
        text: `${INTAKE_SOURCE_LABELS[source]} upload started.`,
      })
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "The upload failed.",
      })
    } finally {
      setBusy(null)
    }
  }

  async function sendChat() {
    const content = chatInput.trim()
    if (!content) {
      setNotice({ tone: "error", text: "Write a message first." })
      return
    }
    const turns: IntakeChatMessage[] = [
      ...chatTurns,
      { role: "user", content },
    ]
    setChatTurns(turns)
    setChatInput("")
    setBusy("chat-preview")
    setNotice(null)
    try {
      const result = await api<ChatExtractionResult>("/api/intake/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcript: turns,
          missingFields,
          useAi: chatAi,
        }),
      })
      setChatPreview(result)
      if (result.nextQuestion) {
        setChatTurns([
          ...turns,
          { role: "assistant", content: result.nextQuestion },
        ])
      }
    } catch (error) {
      setNotice({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Could not read that message.",
      })
    } finally {
      setBusy(null)
    }
  }

  function startChat() {
    if (chatTurns.length === 0) {
      setNotice({ tone: "error", text: "Send a message first." })
      return
    }
    void startRun(
      "CHAT",
      { transcript: chatTurns, missingFields, useAi: chatAi },
      "Conversation"
    )
  }

  function toggleMicrophone() {
    const speechWindow = window as SpeechWindow
    const Recognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
    if (!Recognition) {
      setNotice({
        tone: "error",
        text: "This browser has no speech recognition. Type or paste the transcript instead.",
      })
      return
    }
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = "en-US"
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim()
      if (!text) return
      setVoiceText((current) => `${current} ${text}`.trim())
      setVoiceInputMode("MICROPHONE")
    }
    recognition.onerror = () => {
      setListening(false)
      setNotice({
        tone: "error",
        text: "Speech recognition stopped. You can keep typing the transcript.",
      })
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
      setNotice(null)
    } catch {
      setListening(false)
      setNotice({
        tone: "error",
        text: "The microphone could not start. Type or paste the transcript instead.",
      })
    }
  }

  const canRetry =
    activeRun?.sources.some(
      (source) => source.status === "FAILED" || source.status === "CANCELLED"
    ) ?? false

  const patchGroups = activeRun
    ? [
        {
          key: "conflict",
          title: "Needs a choice",
          patches: activeRun.patches.filter((patch) => patch.status === "CONFLICT"),
        },
        {
          key: "pending",
          title: "Ready for review",
          patches: activeRun.patches.filter((patch) => patch.status === "PENDING"),
        },
        {
          key: "applied",
          title: "Added to your profile",
          patches: activeRun.patches.filter((patch) => patch.status === "APPLIED"),
        },
        {
          key: "rejected",
          title: "Not added",
          patches: activeRun.patches.filter((patch) => patch.status === "REJECTED"),
        },
      ].filter((group) => group.patches.length > 0)
    : []

  async function handleReviewChange() {
    if (!activeId) return
    try {
      await refreshRun(activeId)
      router.refresh()
    } catch (error) {
      setNotice({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "The run could not be refreshed.",
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-400" aria-hidden="true" />
          Unified intake
        </CardTitle>
        <CardDescription>
          Bring in what you already have from a resume, GitHub, a LinkedIn export,
          your website, a conversation or a voice transcript. Every source produces
          the same reviewable facts. Nothing is confirmed or submitted automatically,
          and manual profile editing still works without any of this.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          role="tablist"
          aria-label="Intake source"
          className="flex flex-wrap gap-1 rounded-md border border-border bg-muted/40 p-1"
        >
          {SOURCE_ORDER.map((source) => (
            <button
              key={source}
              type="button"
              role="tab"
              aria-selected={tab === source}
              onClick={() => {
                setTab(source)
                setNotice(null)
              }}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                tab === source
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <SourceIcon source={source} />
              {INTAKE_SOURCE_LABELS[source]}
            </button>
          ))}
        </div>

        {tab === "RESUME" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="intake-resume-select">Use an existing resume</Label>
              {resumes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No resumes yet. Upload one below, or add career facts manually.
                </p>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    id="intake-resume-select"
                    value={resumeId}
                    onChange={(event) => setResumeId(event.target.value)}
                  >
                    {resumes.map((resume) => (
                      <option key={resume.id} value={resume.id}>
                        {resume.title}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    loading={busy === "start-RESUME"}
                    disabled={!resumeId || busy !== null}
                    onClick={() =>
                      void startRun(
                        "RESUME",
                        { resumeId },
                        "Resume intake"
                      )
                    }
                  >
                    Start from resume
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2 border-t border-border pt-4">
              <Label htmlFor="intake-resume-file">Or upload a PDF or DOCX</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="intake-resume-file"
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) =>
                    setResumeFile(event.target.files?.[0] ?? null)
                  }
                />
                <Button
                  type="button"
                  loading={busy === "upload-RESUME"}
                  disabled={!resumeFile || busy !== null}
                  onClick={() => void uploadSource("RESUME", resumeFile)}
                >
                  Upload and start
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Text is extracted server-side with a deterministic parser. No AI
                provider is called unless you explicitly opt in elsewhere.
              </p>
            </div>
          </div>
        )}

        {tab === "GITHUB" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="intake-github-url">Public GitHub profile</Label>
              <Input
                id="intake-github-url"
                type="url"
                inputMode="url"
                placeholder="https://github.com/your-handle"
                value={githubInput}
                onChange={(event) => setGithubInput(event.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={githubConsent}
                onChange={(event) => setGithubConsent(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-brand-500"
              />
              <span>
                I own this account. RoleSpec may read its public profile and
                repositories through the GitHub API.
              </span>
            </label>
            <div className="flex justify-end">
              <Button
                type="button"
                loading={busy === "start-GITHUB"}
                disabled={!githubInput.trim() || !githubConsent || busy !== null}
                onClick={() =>
                  void startRun(
                    "GITHUB",
                    { url: githubInput.trim(), consent: true },
                    "GitHub intake"
                  )
                }
              >
                Start GitHub intake
              </Button>
            </div>
          </div>
        )}

        {tab === "LINKEDIN" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="intake-linkedin-file">
                LinkedIn &ldquo;Save to PDF&rdquo; export
              </Label>
              <Input
                id="intake-linkedin-file"
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) =>
                  setLinkedinFile(event.target.files?.[0] ?? null)
                }
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={linkedinAi}
                onChange={(event) => setLinkedinAi(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-brand-500"
              />
              <span>
                Use AI structuring for this export. If no provider is configured,
                the deterministic parse is used instead. Facts stay unconfirmed.
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              Use an export you downloaded yourself. RoleSpec does not sign in to
              LinkedIn or scrape a profile URL.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <a
                href="#linkedin-import"
                className="inline-flex h-9 items-center px-2 text-xs text-brand-400 hover:underline"
              >
                Use the older manual import instead
              </a>
              <Button
                type="button"
                loading={busy === "upload-LINKEDIN"}
                disabled={!linkedinFile || busy !== null}
                onClick={() =>
                  void uploadSource("LINKEDIN", linkedinFile, linkedinAi)
                }
              >
                Upload and start
              </Button>
            </div>
          </div>
        )}

        {tab === "WEB" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="intake-web-url">Public portfolio or site</Label>
              <Input
                id="intake-web-url"
                type="url"
                inputMode="url"
                placeholder="https://your-name.dev"
                value={webInput}
                onChange={(event) => setWebInput(event.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={webConsent}
                onChange={(event) => setWebConsent(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-brand-500"
              />
              <span>
                I own this site. RoleSpec may fetch this one public page and turn
                what it says into unconfirmed facts.
              </span>
            </label>
            <div className="flex justify-end">
              <Button
                type="button"
                loading={busy === "start-WEB"}
                disabled={!webInput.trim() || !webConsent || busy !== null}
                onClick={() =>
                  void startRun(
                    "WEB",
                    { url: webInput.trim(), consent: true },
                    "Website intake"
                  )
                }
              >
                Start website intake
              </Button>
            </div>
          </div>
        )}

        {tab === "CHAT" && (
          <div className="space-y-3">
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border bg-background/40 p-3">
              {chatTurns.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Tell me what you have done, the tools you use and the role you
                  want next. I will only propose facts you actually state.
                </p>
              ) : (
                chatTurns.map((turn, index) => (
                  <p
                    key={`${turn.role}-${index}`}
                    className={`text-sm ${
                      turn.role === "assistant"
                        ? "text-muted-foreground"
                        : "text-foreground"
                    }`}
                  >
                    <span className="mr-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {turn.role === "assistant" ? "Question" : "You"}
                    </span>
                    {turn.content}
                  </p>
                ))
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake-chat-message">Your message</Label>
              <Textarea
                id="intake-chat-message"
                rows={3}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="I worked at Acme as a backend engineer from 2021 to 2023. I use TypeScript and PostgreSQL."
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={chatAi}
                onChange={(event) => setChatAi(event.target.checked)}
                className="h-3.5 w-3.5 accent-brand-500"
              />
              Use optional AI structuring
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                loading={busy === "chat-preview"}
                disabled={!chatInput.trim() || busy !== null}
                onClick={() => void sendChat()}
              >
                Preview facts
              </Button>
              <Button
                type="button"
                loading={busy === "start-CHAT"}
                disabled={chatTurns.length === 0 || busy !== null}
                onClick={startChat}
              >
                Start chat intake
              </Button>
            </div>
            {chatPreview && (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs font-medium text-foreground">
                  {chatPreview.patches.length} proposed fact
                  {chatPreview.patches.length === 1 ? "" : "s"} ·{" "}
                  {chatPreview.mode === "ai" ? "AI structured" : "deterministic"}
                </p>
                <ul className="space-y-1">
                  {chatPreview.patches.slice(0, 8).map((patch, index) => (
                    <li key={`${patch.kind}-${index}`} className="text-xs text-muted-foreground">
                      {PATCH_KIND_LABELS[patch.kind]}:{" "}
                      {patch.kind === "CONTACT"
                        ? `${CONTACT_LABELS[(patch.data as ContactPatchData).field]}: ${
                            (patch.data as ContactPatchData).value
                          }`
                        : patch.kind === "EVIDENCE"
                          ? (patch.data as EvidencePatchData).title
                          : patch.kind === "SKILL"
                            ? (patch.data as SkillPatchData).name
                            : (patch.data as TargetRolePatchData).title}
                    </li>
                  ))}
                </ul>
                {chatPreview.patches.length > 8 && (
                  <p className="text-xs text-muted-foreground">
                    {chatPreview.patches.length - 8} more will appear after the run.
                  </p>
                )}
                {chatPreview.warnings.map((warning) => (
                  <p key={warning} className="text-xs text-muted-foreground">
                    {warning}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "VOICE" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="intake-voice-text">Transcript</Label>
              <Textarea
                id="intake-voice-text"
                rows={5}
                value={voiceText}
                onChange={(event) => {
                  setVoiceText(event.target.value)
                  setVoiceInputMode("PASTED")
                }}
                placeholder="Speak using the microphone button, or paste a transcript here."
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={listening ? "destructive" : "secondary"}
                onClick={toggleMicrophone}
              >
                {listening ? (
                  <Square className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {listening ? "Stop recording" : "Use microphone"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {voiceInputMode === "MICROPHONE"
                  ? "Microphone transcript"
                  : "Typed or pasted transcript"}
              </span>
              <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={voiceAi}
                  onChange={(event) => setVoiceAi(event.target.checked)}
                  className="h-3.5 w-3.5 accent-brand-500"
                />
                Optional AI structuring
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Audio stays in your browser. Only the transcript is sent to RoleSpec,
              and it is read for facts you explicitly state.
            </p>
            <div className="flex justify-end">
              <Button
                type="button"
                loading={busy === "start-VOICE"}
                disabled={!voiceText.trim() || busy !== null}
                onClick={() =>
                  void startRun(
                    "VOICE",
                    {
                      transcript: voiceText.trim(),
                      inputMode: voiceInputMode,
                      useAi: voiceAi,
                    },
                    "Voice intake"
                  )
                }
              >
                Start voice intake
              </Button>
            </div>
          </div>
        )}

        {notice && (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            aria-live="polite"
            className={
              notice.tone === "error"
                ? "flex items-start gap-1.5 text-sm text-destructive"
                : "flex items-start gap-1.5 text-sm text-muted-foreground"
            }
          >
            {notice.tone === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            {notice.text}
          </p>
        )}

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-foreground">Intake runs</h3>
            {runs.length > 0 && (
              <Select
                aria-label="Choose an intake run"
                className="h-8 max-w-[18rem] text-xs"
                value={activeId ?? ""}
                onChange={(event) => setActiveId(event.target.value || null)}
              >
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {formatDate(run.createdAt)} · {run.status.toLowerCase()} ·{" "}
                    {run.requestedSources
                      .map((source) => INTAKE_SOURCE_LABELS[source])
                      .join(", ")}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {!activeRun ? (
            <p className="text-xs text-muted-foreground">
              No intake runs yet. Start one above; you can review every proposed
              fact before it touches your profile.
            </p>
          ) : (
            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={RUN_BADGE[activeRun.status]} size="sm">
                    {activeRun.status.toLowerCase()}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(activeRun.createdAt)}
                  </span>
                  {activeRun.finishedAt && (
                    <span className="text-xs text-muted-foreground">
                      · finished {formatDate(activeRun.finishedAt)}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {(activeRun.status === "PENDING" ||
                    activeRun.status === "RUNNING") && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        try {
                          const result = await api<{ run: IntakeRunDTO }>(
                            `/api/intake/${activeRun.id}/cancel`,
                            { method: "POST" }
                          )
                          updateRun(result.run)
                          setNotice({
                            tone: "status",
                            text: "Intake run cancelled.",
                          })
                        } catch (error) {
                          setNotice({
                            tone: "error",
                            text:
                              error instanceof Error
                                ? error.message
                                : "Could not cancel the run.",
                          })
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  {canRetry &&
                    (activeRun.status === "FAILED" ||
                      activeRun.status === "PARTIAL" ||
                      activeRun.status === "CANCELLED") && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        try {
                          const result = await api<{ run: IntakeRunDTO }>(
                            `/api/intake/${activeRun.id}/retry`,
                            { method: "POST" }
                          )
                          updateRun(result.run)
                          setActiveId(result.run.id)
                          setNotice({
                            tone: "status",
                            text: "Retrying failed sources.",
                          })
                        } catch (error) {
                          setNotice({
                            tone: "error",
                            text:
                              error instanceof Error
                                ? error.message
                                : "Could not retry the run.",
                          })
                        }
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Retry failed sources
                    </Button>
                  )}
                </div>
              </div>

              <ul className="space-y-2">
                {activeRun.sources.map((source) => (
                  <li key={source.id} className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        <SourceIcon source={source.source} />
                        {INTAKE_SOURCE_LABELS[source.source]}
                      </span>
                      <Badge variant={SOURCE_BADGE[source.status] ?? "neutral"} size="sm">
                        {source.status.toLowerCase()}
                      </Badge>
                    </div>
                    <Progress
                      value={source.progress}
                      size="sm"
                      color={
                        source.status === "FAILED"
                          ? "error"
                          : source.status === "CANCELLED"
                            ? "neutral"
                            : source.status === "PARTIAL"
                              ? "warning"
                              : "brand"
                      }
                      label={`${INTAKE_SOURCE_LABELS[source.source]} progress`}
                    />
                    {(source.message || source.error) && (
                      <p
                        className={
                          source.error
                            ? "text-xs text-destructive"
                            : "text-xs text-muted-foreground"
                        }
                      >
                        {source.error ?? source.message}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              {activeRun.error && (
                <p role="alert" className="text-xs text-destructive">
                  {activeRun.error}
                </p>
              )}
              {activeRun.warnings.length > 0 && (
                <ul className="space-y-1">
                  {activeRun.warnings.map((warning) => (
                    <li key={warning} className="text-xs text-muted-foreground">
                      {warning}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{activeRun.counts.pending} ready</span>
                <span>· {activeRun.counts.conflicts} need a choice</span>
                <span>· {activeRun.counts.applied} added</span>
                <span>· {activeRun.counts.rejected} not added</span>
              </div>

              {patchGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No facts from this run yet. Sources that find nothing leave the
                  manual profile forms untouched.
                </p>
              ) : (
                patchGroups.map((group) => (
                  <section key={group.key} className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.title} ({group.patches.length})
                    </h4>
                    <ul className="space-y-2">
                      {group.patches.map((patch) => (
                        <PatchRow
                          key={patch.id}
                          runId={activeRun.id}
                          patch={patch}
                          onChanged={handleReviewChange}
                          onNotice={setNotice}
                        />
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
