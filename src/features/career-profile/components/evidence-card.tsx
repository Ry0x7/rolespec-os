"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BadgeCheck, FileStack, Pencil, Plus, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import { EmptyState } from "@/shared/components/empty-state"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Select } from "@/shared/ui/select"
import { Textarea } from "@/shared/ui/textarea"
import { Pagination } from "@/shared/ui/pagination"
import { SegmentedControl } from "@/shared/ui/segmented-control"
import { usePagedList } from "@/shared/hooks/use-paged-list"
import { usePreservedScroll } from "@/shared/hooks/use-preserved-scroll"
import { formatDate } from "@/shared/lib/utils"
import {
  confirmEvidence,
  createEvidence,
  deleteEvidence,
  updateEvidence,
} from "../actions/career-evidence.actions"
import { enhanceEvidence } from "../actions/enhance"
import {
  EVIDENCE_KIND_LABELS,
  EVIDENCE_KIND_ORDER,
  EVIDENCE_SOURCE_LABELS,
  EVIDENCE_STATUS_LABELS,
} from "../constants/labels"
import type { EvidenceRow } from "../types"

export const EVIDENCE_PAGE_SIZE = 10

type EvidenceFilter = "all" | EvidenceRow["kind"]

/**
 * `<input type="date">` wants `yyyy-MM-dd`. The columns are `@db.Date` and are
 * written at UTC midnight, so the parts are read back in UTC — using the local
 * parts would show the previous day west of Greenwich.
 */
function toDateInputValue(date: EvidenceRow["startDate"]): string {
  if (!date) return ""
  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10)
}

export function EvidenceCard({ evidence }: { evidence: EvidenceRow[] }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [busy, setBusy] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  /** The row whose details the last enhance run rewrote, for the inline note. */
  const [enhancedId, setEnhancedId] = useState<string | null>(null)
  /** One row at a time, like the "link evidence" form in the capabilities card. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<EvidenceFilter>("all")
  const {
    ref: scrollerRef,
    onScroll: onScrollerScroll,
    resetScroll,
  } = usePreservedScroll<HTMLDivElement>()

  const presentKinds = EVIDENCE_KIND_ORDER.filter((kind) =>
    evidence.some((item) => item.kind === kind)
  )
  // Deleting the last item of the selected kind removes its option, so fall
  // back to All rather than showing an empty, unselectable filter.
  const activeFilter: EvidenceFilter =
    filter !== "all" && !presentKinds.includes(filter) ? "all" : filter
  // With a single kind, All and that kind show the same rows, so no filter.
  const showKindFilter = presentKinds.length >= 2
  // Group order first, so a page of All reads as consecutive groups.
  const ordered = presentKinds.flatMap((kind) =>
    evidence.filter((item) => item.kind === kind)
  )
  const filtered =
    activeFilter === "all" ? ordered : ordered.filter((item) => item.kind === activeFilter)
  const paged = usePagedList(filtered, { pageSize: EVIDENCE_PAGE_SIZE, resetKey: activeFilter })
  const groups = presentKinds
    .map((kind) => ({ kind, items: paged.pageItems.filter((item) => item.kind === kind) }))
    .filter((group) => group.items.length > 0)

  function changeFilter(next: EvidenceFilter) {
    setFilter(next)
    resetScroll()
  }

  function changePage(next: number) {
    paged.setPage(next)
    resetScroll()
  }

  async function handleAdd(formData: FormData) {
    setBusy(true)
    const result = await createEvidence(formData)
    setBusy(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    formRef.current?.reset()
    toast.success("Evidence added")
    router.refresh()
  }

  async function handleUpdate(formData: FormData) {
    setBusy(true)
    const result = await updateEvidence(formData)
    setBusy(false)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    setEditingId(null)
    toast.success("Evidence updated")
    router.refresh()
  }

  /*
    Enhance applies straight away — the click is the consent, and the rewrite is
    only allowed to reword what is already stored. The note below the row says
    so, and the details stay editable.
  */
  async function handleEnhance(id: string) {
    setPendingId(id)
    const result = await enhanceEvidence(id)
    setPendingId(null)
    if ("error" in result) {
      toast.error(result.error)
      return
    }
    if (result.unchanged) {
      setEnhancedId(null)
      toast.success("Those details already read clearly")
      return
    }
    setEnhancedId(id)
    toast.success("Details enhanced")
    router.refresh()
  }

  async function run(id: string, fn: () => Promise<{ error?: string }>, ok: string) {
    setPendingId(id)
    const result = await fn()
    setPendingId(null)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    toast.success(ok)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence</CardTitle>
        <CardDescription>
          Durable facts about what you have actually done. Nothing here is ever
          taken from a job description.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form ref={formRef} action={handleAdd} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="evidence-kind">Type</Label>
              <Select id="evidence-kind" name="kind" defaultValue="EXPERIENCE">
                {EVIDENCE_KIND_ORDER.map((kind) => (
                  <option key={kind} value={kind}>
                    {EVIDENCE_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-title">Title</Label>
              <Input
                id="evidence-title"
                name="title"
                required
                maxLength={200}
                placeholder="e.g. Frontend Engineer"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-organization">Organization</Label>
              <Input
                id="evidence-organization"
                name="organization"
                maxLength={200}
                placeholder="e.g. Acme Inc."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="evidence-startDate">Start date</Label>
              <Input id="evidence-startDate" name="startDate" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="evidence-endDate">End date</Label>
              <Input id="evidence-endDate" name="endDate" type="date" />
              <p className="text-xs text-muted-foreground">Leave empty if ongoing.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="evidence-details">Details</Label>
            <Textarea
              id="evidence-details"
              name="details"
              rows={3}
              maxLength={5000}
              placeholder="What you did, in your own words."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="evidence-outcome">Measurable outcome</Label>
            <Textarea
              id="evidence-outcome"
              name="outcome"
              rows={2}
              maxLength={2000}
              placeholder="e.g. cut checkout drop-off by 18% over two quarters"
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              <Plus className="h-4 w-4" />
              Add evidence
            </Button>
          </div>
        </form>

        {evidence.length === 0 ? (
          <EmptyState
            icon={FileStack}
            variant="bare"
            title="No evidence yet"
            description="Add experience, achievements, projects, education or certifications."
          />
        ) : (
          <div className="space-y-3">
            {showKindFilter && (
              <SegmentedControl
                label="Filter evidence by type"
                value={activeFilter}
                onChange={changeFilter}
                options={[
                  { value: "all" as EvidenceFilter, label: "All", count: evidence.length },
                  ...presentKinds.map((kind) => ({
                    value: kind as EvidenceFilter,
                    label: EVIDENCE_KIND_LABELS[kind],
                    count: evidence.filter((item) => item.kind === kind).length,
                  })),
                ]}
              />
            )}
            {/*
              All groups scroll together inside one container so a long history
              can't stretch the page. Same pattern as the kanban column.
            */}
            <div
              ref={scrollerRef}
              onScroll={onScrollerScroll}
              className="max-h-[min(60vh,520px)] space-y-5 overflow-y-auto overscroll-contain pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar]:w-1.5"
            >
              {groups.map(({ kind, items }) => (
                <div key={kind} className="space-y-2">
                  {activeFilter === "all" && (
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {EVIDENCE_KIND_LABELS[kind]}
                    </p>
                  )}
                  {items
                    .map((item) =>
                      editingId === item.id ? (
                        <form
                          key={item.id}
                          action={handleUpdate}
                          className="space-y-3 rounded-lg border border-border bg-card p-3"
                        >
                          <input type="hidden" name="id" value={item.id} />
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="space-y-2">
                              <Label htmlFor={`edit-kind-${item.id}`}>Type</Label>
                              <Select
                                id={`edit-kind-${item.id}`}
                                name="kind"
                                defaultValue={item.kind}
                              >
                                {EVIDENCE_KIND_ORDER.map((kindOption) => (
                                  <option key={kindOption} value={kindOption}>
                                    {EVIDENCE_KIND_LABELS[kindOption]}
                                  </option>
                                ))}
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`edit-title-${item.id}`}>Title</Label>
                              <Input
                                id={`edit-title-${item.id}`}
                                name="title"
                                required
                                maxLength={200}
                                defaultValue={item.title}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`edit-organization-${item.id}`}>
                                Organization
                              </Label>
                              <Input
                                id={`edit-organization-${item.id}`}
                                name="organization"
                                maxLength={200}
                                defaultValue={item.organization ?? ""}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor={`edit-startDate-${item.id}`}>Start date</Label>
                              <Input
                                id={`edit-startDate-${item.id}`}
                                name="startDate"
                                type="date"
                                defaultValue={toDateInputValue(item.startDate)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`edit-endDate-${item.id}`}>End date</Label>
                              <Input
                                id={`edit-endDate-${item.id}`}
                                name="endDate"
                                type="date"
                                defaultValue={toDateInputValue(item.endDate)}
                              />
                              <p className="text-xs text-muted-foreground">
                                Leave empty if ongoing.
                              </p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`edit-details-${item.id}`}>Details</Label>
                            <Textarea
                              id={`edit-details-${item.id}`}
                              name="details"
                              rows={3}
                              maxLength={5000}
                              defaultValue={item.details ?? ""}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`edit-outcome-${item.id}`}>
                              Measurable outcome
                            </Label>
                            <Textarea
                              id={`edit-outcome-${item.id}`}
                              name="outcome"
                              rows={2}
                              maxLength={2000}
                              defaultValue={item.outcome ?? ""}
                            />
                          </div>

                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </Button>
                            <Button type="submit" size="sm" disabled={busy}>
                              Save
                            </Button>
                          </div>
                        </form>
                      ) : (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {item.title}
                            {item.organization && (
                              <span className="text-muted-foreground"> — {item.organization}</span>
                            )}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge
                              variant={item.status === "CONFIRMED" ? "success" : "warning"}
                              size="sm"
                            >
                              {EVIDENCE_STATUS_LABELS[item.status]}
                            </Badge>
                            <Badge variant="outline" size="sm">
                              {EVIDENCE_SOURCE_LABELS[item.source]}
                            </Badge>
                            {item.startDate && (
                              <span>
                                {formatDate(item.startDate)}
                                {" – "}
                                {item.endDate ? formatDate(item.endDate) : "present"}
                              </span>
                            )}
                          </div>
                          {item.details && (
                            <>
                              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                                {item.details}
                              </p>
                              {enhancedId === item.id && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Enhanced and saved. Edit it if it lost your meaning.
                                </p>
                              )}
                            </>
                          )}
                          {item.outcome && (
                            <p className="mt-1 text-sm text-foreground">
                              <span className="text-muted-foreground">Outcome: </span>
                              {item.outcome}
                            </p>
                          )}
                        </div>
                        {item.status === "CANDIDATE" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={pendingId === item.id}
                            onClick={() =>
                              run(item.id, () => confirmEvidence(item.id), "Evidence confirmed")
                            }
                          >
                            <BadgeCheck className="h-3.5 w-3.5" />
                            Confirm
                          </Button>
                        )}
                        {item.details && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            aria-label={`Enhance details for ${item.title}`}
                            title="Sharpen this wording. Nothing new is added."
                            disabled={pendingId === item.id}
                            onClick={() => handleEnhance(item.id)}
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={`Edit evidence ${item.title}`}
                          disabled={pendingId === item.id}
                          onClick={() => setEditingId(item.id)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          aria-label={`Delete evidence ${item.title}`}
                          disabled={pendingId === item.id}
                          onClick={() =>
                            run(item.id, () => deleteEvidence(item.id), "Evidence deleted")
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      )
                    )}
                </div>
              ))}
            </div>
            <Pagination
              label="Evidence pages"
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
