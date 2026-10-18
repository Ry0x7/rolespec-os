"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Link2, Link2Off, Plus, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { SuggestInput } from "@/shared/ui/suggest-input"
import { Pagination } from "@/shared/ui/pagination"
import { SegmentedControl } from "@/shared/ui/segmented-control"
import { usePagedList } from "@/shared/hooks/use-paged-list"
import { usePreservedScroll } from "@/shared/hooks/use-preserved-scroll"
import { formatDate } from "@/shared/lib/utils"
import {
  createCapabilities,
  deleteCapability,
  linkEvidenceToCapability,
  setCapabilityConfirmed,
  unlinkEvidenceFromCapability,
} from "../actions/career-capability.actions"
import {
  CAPABILITY_DEPTH_LABELS,
  CAPABILITY_SELF_RATING_LABELS,
  EVIDENCE_KIND_LABELS,
  summarizeCapabilitiesAdded,
} from "../constants/labels"
import {
  CAPABILITY_CATEGORY_SUGGESTIONS,
  CAPABILITY_NAME_SUGGESTIONS,
  mergeSuggestions,
} from "../constants/suggestions"
import type { CapabilityRow, EvidenceOption } from "../types"

const SELF_RATING_VALUES = ["LEARNING", "COMPETENT", "STRONG", "EXPERT"] as const
const DEPTH_VALUES = ["EXPOSURE", "WORKING", "DEEP"] as const

export const CAPABILITIES_PAGE_SIZE = 10

type CapabilityFilter = "unconfirmed" | "confirmed" | "all"

const FILTER_LABELS: Record<CapabilityFilter, string> = {
  unconfirmed: "Unconfirmed",
  confirmed: "Confirmed",
  all: "All",
}

const FILTER_EMPTY_LABELS: Record<CapabilityFilter, string> = {
  unconfirmed: "No unconfirmed capabilities",
  confirmed: "No confirmed capabilities",
  all: "No capabilities",
}

/**
 * A confirm toggle shown before the server round-trip finishes. `base` is the
 * server value it was made against: once the props carry a different value the
 * server has caught up, so the override stops applying on its own.
 */
interface ConfirmOverride {
  value: boolean
  base: boolean
}

interface CapabilitiesCardProps {
  capabilities: CapabilityRow[]
  /** Confirmed evidence only — see the note at the call site in the page. */
  evidenceOptions: EvidenceOption[]
}

export function CapabilitiesCard({ capabilities, evidenceOptions }: CapabilitiesCardProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [busy, setBusy] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, ConfirmOverride>>({})
  const [filter, setFilter] = useState<CapabilityFilter>(() =>
    capabilities.some((capability) => !capability.confirmed) ? "unconfirmed" : "all"
  )
  // A refresh re-renders the list; the container is put back where the user
  // left it so a confirm or delete never throws them back to the top.
  const {
    ref: scrollerRef,
    onScroll: onScrollerScroll,
    resetScroll,
  } = usePreservedScroll<HTMLDivElement>()

  // Apply pending confirm toggles, and keep a stable name order: the server
  // lists confirmed rows first, which would move a row the moment it is
  // confirmed.
  const rows = capabilities
    .map((capability) => {
      const override = overrides[capability.id]
      return override && override.base === capability.confirmed
        ? { ...capability, confirmed: override.value }
        : capability
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
  const counts: Record<CapabilityFilter, number> = {
    unconfirmed: rows.filter((capability) => !capability.confirmed).length,
    confirmed: rows.filter((capability) => capability.confirmed).length,
    all: rows.length,
  }
  const filtered =
    filter === "all"
      ? rows
      : rows.filter((capability) => capability.confirmed === (filter === "confirmed"))
  // Clamped, so confirming the last row on the last page lands on the previous
  // page instead of an empty one; a filter change goes back to page 1.
  const paged = usePagedList(filtered, {
    pageSize: CAPABILITIES_PAGE_SIZE,
    resetKey: filter,
  })

  function changeFilter(next: CapabilityFilter) {
    setFilter(next)
    resetScroll()
  }

  function changePage(next: number) {
    paged.setPage(next)
    resetScroll()
  }

  async function toggleConfirmed(capability: CapabilityRow, next: boolean) {
    // Keyed to the props value, not the overridden one, so a server refresh
    // that already carries `next` supersedes the override.
    const base = capabilities.find((row) => row.id === capability.id)?.confirmed ?? !next
    setOverrides((current) => ({ ...current, [capability.id]: { value: next, base } }))
    const ok = await run(
      capability.id,
      () => setCapabilityConfirmed(capability.id, next),
      next ? "Capability confirmed" : "Confirmation removed"
    )
    if (!ok) {
      setOverrides((current) => {
        const rest = { ...current }
        delete rest[capability.id]
        return rest
      })
    }
  }

  // Own categories first so the datalist keeps existing spellings consistent.
  const categorySuggestions = mergeSuggestions(
    capabilities.map((capability) => capability.category),
    CAPABILITY_CATEGORY_SUGGESTIONS
  )

  async function handleAdd(formData: FormData) {
    setBusy(true)
    const result = await createCapabilities(formData)
    setBusy(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    formRef.current?.reset()
    toast.success(summarizeCapabilitiesAdded(result.created, result.skipped))
    router.refresh()
  }

  async function handleLink(formData: FormData) {
    setBusy(true)
    const result = await linkEvidenceToCapability(formData)
    setBusy(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    setLinkingId(null)
    toast.success("Evidence linked")
    router.refresh()
  }

  async function run(id: string, fn: () => Promise<{ error?: string }>, ok: string) {
    setPendingId(id)
    const result = await fn()
    setPendingId(null)
    if (result?.error) {
      toast.error(result.error)
      return false
    }
    toast.success(ok)
    router.refresh()
    return true
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Capabilities</CardTitle>
        <CardDescription>
          Strength is never a single score. It is your explicit confirmation plus the
          evidence you link — its depth, repetition, outcomes and recency.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form ref={formRef} action={handleAdd} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="capability-name">Capability</Label>
              <SuggestInput
                id="capability-name"
                name="names"
                multiple
                required
                maxLength={2000}
                placeholder="e.g. React, TypeScript"
                suggestions={CAPABILITY_NAME_SUGGESTIONS}
              />
              <p className="text-xs text-muted-foreground">
                Separate multiple skills with commas
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="capability-category">Category</Label>
              <SuggestInput
                id="capability-category"
                name="category"
                maxLength={120}
                placeholder="e.g. Frontend"
                suggestions={categorySuggestions}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="capability-selfAssessment">Self-assessment</Label>
              <Select id="capability-selfAssessment" name="selfAssessment" defaultValue="">
                <option value="">— not set —</option>
                {SELF_RATING_VALUES.map((rating) => (
                  <option key={rating} value={rating}>
                    {CAPABILITY_SELF_RATING_LABELS[rating]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              <Plus className="h-4 w-4" />
              Add capability
            </Button>
          </div>
        </form>

        {capabilities.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            variant="bare"
            title="No capabilities yet"
            description="Add a skill, then link the evidence that proves it."
          />
        ) : (
          <div className="space-y-3">
            <SegmentedControl
              label="Filter capabilities"
              value={filter}
              onChange={changeFilter}
              options={(Object.keys(FILTER_LABELS) as CapabilityFilter[]).map((option) => ({
                value: option,
                label: FILTER_LABELS[option],
                count: counts[option],
              }))}
            />
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {FILTER_EMPTY_LABELS[filter]}
              </p>
            ) : (
              /*
                The list scrolls on its own so a long skill set can't stretch the
                page. overflow-y-auto (never hidden) keeps the inline "link
                evidence" form reachable when it expands in place.
              */
              <div
                ref={scrollerRef}
                onScroll={onScrollerScroll}
                className="max-h-[min(60vh,520px)] space-y-3 overflow-y-auto overscroll-contain pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar]:w-1.5"
              >
                {paged.pageItems.map((capability) => (
                  <div
                    key={capability.id}
                    className="rounded-lg border border-border bg-card p-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{capability.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge
                            variant={capability.confirmed ? "success" : "neutral"}
                            size="sm"
                          >
                            {capability.confirmed ? "Confirmed" : "Unconfirmed"}
                          </Badge>
                          {capability.category && (
                            <Badge variant="outline" size="sm">
                              {capability.category}
                            </Badge>
                          )}
                          {capability.selfAssessment && (
                            <span>
                              Self: {CAPABILITY_SELF_RATING_LABELS[capability.selfAssessment]}
                            </span>
                          )}
                          <span>
                            {capability.links.length}{" "}
                            {capability.links.length === 1 ? "evidence link" : "evidence links"}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pendingId === capability.id}
                        onClick={() => toggleConfirmed(capability, !capability.confirmed)}
                      >
                        {capability.confirmed ? "Unconfirm" : "Confirm"}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        aria-label={`Delete capability ${capability.name}`}
                        disabled={pendingId === capability.id}
                        onClick={() =>
                          run(
                            capability.id,
                            () => deleteCapability(capability.id),
                            "Capability deleted"
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {capability.links.length > 0 && (
                      <ul className="mt-3 space-y-1 border-t border-border/60 pt-3">
                        {capability.links.map((link) => (
                          <li
                            key={link.id}
                            className="flex items-center gap-2 text-xs text-muted-foreground"
                          >
                            <Link2 className="h-3 w-3 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                              {link.evidenceTitle} · {CAPABILITY_DEPTH_LABELS[link.depth]}
                              {link.hasMeasuredOutcome && " · measured outcome"}
                              {link.lastUsedAt && ` · last used ${formatDate(link.lastUsedAt)}`}
                            </span>
                            <button
                              type="button"
                              aria-label={`Unlink ${link.evidenceTitle}`}
                              disabled={pendingId === link.id}
                              onClick={() =>
                                run(
                                  link.id,
                                  () => unlinkEvidenceFromCapability(link.id),
                                  "Evidence unlinked"
                                )
                              }
                              className="text-destructive hover:opacity-80 disabled:opacity-50"
                            >
                              <Link2Off className="h-3 w-3" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {evidenceOptions.length === 0 ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Add and confirm evidence above before linking it to this
                        capability.
                      </p>
                    ) : linkingId === capability.id ? (
                      <form action={handleLink} className="mt-3 space-y-3 border-t border-border/60 pt-3">
                        <input type="hidden" name="capabilityId" value={capability.id} />
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="space-y-2 sm:col-span-2">
                            <Label htmlFor={`link-evidence-${capability.id}`}>Evidence</Label>
                            <Select
                              id={`link-evidence-${capability.id}`}
                              name="evidenceId"
                              required
                              defaultValue=""
                            >
                              <option value="" disabled>
                                — choose —
                              </option>
                              {evidenceOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {EVIDENCE_KIND_LABELS[option.kind]}: {option.title}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`link-depth-${capability.id}`}>Depth</Label>
                            <Select
                              id={`link-depth-${capability.id}`}
                              name="depth"
                              defaultValue="WORKING"
                            >
                              {DEPTH_VALUES.map((depth) => (
                                <option key={depth} value={depth}>
                                  {CAPABILITY_DEPTH_LABELS[depth]}
                                </option>
                              ))}
                            </Select>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor={`link-lastUsed-${capability.id}`}>Last used</Label>
                            <Input
                              id={`link-lastUsed-${capability.id}`}
                              name="lastUsedAt"
                              type="date"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`link-outcome-${capability.id}`}>Outcome note</Label>
                            <Input
                              id={`link-outcome-${capability.id}`}
                              name="outcomeNote"
                              maxLength={2000}
                              placeholder="e.g. shipped the migration"
                            />
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="hasMeasuredOutcome"
                            value="true"
                            className="h-4 w-4 rounded border-border bg-muted accent-brand-600"
                          />
                          This evidence has a measured outcome for this capability
                        </label>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setLinkingId(null)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" size="sm" disabled={busy}>
                            Link evidence
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2"
                        onClick={() => setLinkingId(capability.id)}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        Link evidence
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Pagination
              label="Capabilities pages"
              page={paged.page}
              pageCount={paged.pageCount}
              onPageChange={changePage}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
