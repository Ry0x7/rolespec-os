"use client"

import { useEffect, useState, useTransition } from "react"
import {
  GitCompare,
  RotateCcw,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Drawer, DrawerHeader, DrawerBody, DrawerFooter } from "@/shared/ui/drawer"
import { ConfirmDialog } from "@/shared/ui/confirm-dialog"
import { skillsDiffStatus, type ResumeComparison } from "../services/resume-diff.service"
import { getTailoredResumeDiff, rollbackTailoredResume } from "../actions/rollback"

interface Props {
  resumeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ResumeComparisonDrawer({ resumeId, open, onOpenChange }: Props) {
  const [diff, setDiff] = useState<ResumeComparison | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isRollingBack, startRollback] = useTransition()

  useEffect(() => {
    let active = true
    if (open && !diff) {
      const timer = setTimeout(() => {
        if (!active) return
        setIsLoading(true)
        void getTailoredResumeDiff(resumeId).then((res) => {
          if (!active) return
          setIsLoading(false)
          if (res.success) {
            setDiff(res.diff)
          } else {
            toast.error(res.error)
            onOpenChange(false)
          }
        })
      }, 0)
      return () => {
        active = false
        clearTimeout(timer)
      }
    }
  }, [open, diff, resumeId, onOpenChange])

  const handleRollback = () => {
    setShowConfirm(false)
    startRollback(async () => {
      const res = await rollbackTailoredResume(resumeId)
      if (res.success) {
        toast.success(
          res.restoredFrom === "snapshot"
            ? "Restored the captured source revision"
            : "Restored the live source resume (no snapshot existed)"
        )
        onOpenChange(false)
        if (typeof window !== "undefined") {
          window.location.reload()
        }
      } else {
        toast.error(res.error)
      }
    })
  }

  const badgeVariantFor = (status: string) => {
    switch (status) {
      case "rewritten":
        return "info"
      case "removed":
        return "warning"
      case "added":
        return "success"
      default:
        return "neutral"
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={() => onOpenChange(false)}
        width="max-w-xl"
        aria-label="Tailoring Changes & Rollback"
      >
        <DrawerHeader>
          <div className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Tailoring Changes & Rollback</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Review how this tailored resume was customized from your verified source resume. Unsupported claims are rejected and originals are preserved.
          </p>
        </DrawerHeader>

        <DrawerBody className="space-y-5 text-sm">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !diff ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              Could not load comparison data.
            </div>
          ) : (
            <div className="space-y-5 text-sm">
              {/* Stats Overview */}
              <div className="grid grid-cols-4 gap-2 rounded-lg border bg-muted/40 p-3 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Rewritten</p>
                  <p className="text-base font-bold text-sky-600 dark:text-sky-400">
                    {diff.stats.rewrittenCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Removed</p>
                  <p className="text-base font-bold text-amber-600 dark:text-amber-400">
                    {diff.stats.removedCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Added</p>
                  <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                    {diff.stats.addedCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Unchanged</p>
                  <p className="text-base font-bold text-muted-foreground">
                    {diff.stats.unchangedCount}
                  </p>
                </div>
              </div>

              {/* Source info */}
              <div className="text-xs text-muted-foreground flex items-center justify-between rounded-md bg-muted/20 px-3 py-2 border">
                <span>Source: <strong className="text-foreground">{diff.sourceTitle}</strong></span>
                <span>Tailored: <strong className="text-foreground">{diff.tailoredTitle}</strong></span>
              </div>

              {/* Summary Diff */}
              {diff.summaryDiff && (
                <div className="rounded-lg border p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Professional Summary
                    </span>
                    <Badge variant={badgeVariantFor(diff.summaryDiff.status)} className="text-[10px]">
                      {diff.summaryDiff.status}
                    </Badge>
                  </div>
                  {diff.summaryDiff.original && (
                    <div className="text-xs rounded bg-muted/40 p-2 text-muted-foreground line-through">
                      {diff.summaryDiff.original}
                    </div>
                  )}
                  {diff.summaryDiff.tailored && (
                    <div className="text-xs rounded bg-primary/5 border border-primary/20 p-2 text-foreground font-medium">
                      {diff.summaryDiff.tailored}
                    </div>
                  )}
                </div>
              )}

              {/* Skills: the tailoring pass only reorders, but the editor can edit later. */}
              {diff.skillsDiff && (
                <div className="rounded-lg border p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Skills
                    </span>
                    <Badge variant="neutral" className="text-[10px]">
                      {skillsDiffStatus(diff.skillsDiff.original, diff.skillsDiff.tailored)}
                    </Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded bg-muted/40 p-2 text-xs text-muted-foreground">
                      <p className="mb-1 text-[10px] uppercase tracking-wide">Source</p>
                      {diff.skillsDiff.original.join(", ") || "—"}
                    </div>
                    <div className="rounded border border-primary/20 bg-primary/5 p-2 text-xs text-foreground">
                      <p className="mb-1 text-[10px] uppercase tracking-wide">Tailored</p>
                      {diff.skillsDiff.tailored.join(", ") || "—"}
                    </div>
                  </div>
                </div>
              )}

              {/* Experience & Projects Sections */}
              {diff.sections.map((section, sIdx) => (
                <div key={sIdx} className="rounded-lg border p-3.5 space-y-3">
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    {section.title}
                  </p>
                  <div className="space-y-3">
                    {section.changes.map((item, cIdx) => (
                      <div key={cIdx} className="rounded-md border p-2.5 text-xs space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">{item.roleAndCompany}</span>
                          <Badge
                            variant={badgeVariantFor(item.status)}
                            className="text-[10px] uppercase h-4 px-1.5"
                          >
                            {item.status}
                          </Badge>
                        </div>

                        {item.status === "rewritten" && (
                          <div className="space-y-1">
                            <p className="line-through text-muted-foreground text-[11px] bg-muted/40 p-1.5 rounded">
                              {item.original}
                            </p>
                            <p className="text-foreground font-medium bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 p-1.5 rounded border border-emerald-500/20">
                              {item.tailored}
                            </p>
                          </div>
                        )}

                        {item.status === "removed" && (
                          <p className="line-through text-muted-foreground bg-amber-500/10 text-amber-900 dark:text-amber-300 p-1.5 rounded">
                            {item.original}
                          </p>
                        )}

                        {item.status === "unchanged" && (
                          <p className="text-muted-foreground bg-muted/20 p-1.5 rounded">
                            {item.original}
                          </p>
                        )}

                        {item.status === "added" && (
                          <p className="text-emerald-800 dark:text-emerald-300 bg-emerald-500/10 p-1.5 rounded">
                            {item.tailored}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DrawerBody>

        {diff && (
          <DrawerFooter className="justify-between border-t border-border pt-4">
            <div className="text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Want to start over?</p>
              <p className="text-[11px]">Reverts all edits back to verified source resume.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfirm(true)}
              disabled={isRollingBack}
              className="gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Rollback to Source
            </Button>
          </DrawerFooter>
        )}
      </Drawer>

      <ConfirmDialog
        open={showConfirm}
        title="Roll back to original source resume?"
        description={
          diff ? (
            <>
              This will replace the tailored resume content with a clean copy of your verified source resume (<strong>{diff.sourceTitle}</strong>). Any tailored bullet rewrites will be safely reverted.
            </>
          ) : "Are you sure you want to revert to the source resume?"
        }
        confirmLabel={isRollingBack ? "Rolling back…" : "Yes, Rollback"}
        cancelLabel="Cancel"
        destructive={true}
        onConfirm={handleRollback}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  )
}
